"""Compare the copied tutorial, inputs, transforms, assets and rendering on native/Web."""
import argparse
import base64
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import re
import shutil
import statistics
import sys
import tempfile
import subprocess
import threading
from build import build, digest, ROOT, NATIVE, WORK, DIST, EXPERIMENT
from asset_validation import read_asset

spec = importlib.util.spec_from_file_location('many_nodes_validation', ROOT / 'experiments/native-scene-many-nodes/validate.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
REPORTS = WORK / 'reports'
INPUTS = [[480, 312]] * 4 + [[640, 420]] * 20 + [[300, 220]] * 20 + [[480, 312]] * 16


def compiler_checks():
    compiler=ROOT/'build/assetc-web'/('Release/assetc-web.exe' if sys.platform=='win32' else 'assetc-web')
    checks=[]
    with tempfile.TemporaryDirectory(prefix='hg-flight-') as directory:
        source=Path(directory)/'source with spaces é';output=Path(directory)/'compiled é'
        shutil.copytree(WORK/'asset-input',source)
        def run(ok=True):
            result=subprocess.run([str(compiler),str(source),str(output),'-q'],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
            assert (result.returncode==0)==ok,result.stdout+result.stderr
        run();manifest=(output/'manifest.json').read_bytes();run();assert manifest==(output/'manifest.json').read_bytes()
        checks+=['native standalone scene compiler, Unicode paths','deterministic image/HDR/geometry compilation']
        for logical_id,entry in json.loads(manifest)['assets'].items():
            assert entry['uri']==logical_id+'.lz4'
            read_asset(output/entry['uri'],entry)
        checks.append('all compiled payload sizes and hashes')
        assert not (output/'objects').exists()
        checks.append('native logical paths with binary .lz4 storage')
        scene=source/'playground/playground.scn';original=scene.read_bytes()
        updated=json.loads(original);updated['transforms'][0]['pos'][1]+=1
        scene.write_text(json.dumps(updated),encoding='utf-8');run()
        changed=json.loads((output/'manifest.json').read_bytes())['assets']['playground/playground.scn']
        assert json.loads(read_asset(output/changed['uri'],changed))['transforms'][0]['pos']==updated['transforms'][0]['pos']
        assert changed['uri']=='playground/playground.scn.lz4' and changed['sha256']!=json.loads(manifest)['assets']['playground/playground.scn']['sha256']
        scene.write_bytes(original);run();assert (output/'manifest.json').read_bytes()==manifest
        checks.append('changed scene recompiles at the same path and restores deterministically')
        def reject(name,alter,label):
            path=source/name;old=path.read_bytes();new=alter(old)
            if new is None:path.unlink()
            else:path.write_bytes(new)
            try:
                run(False);assert manifest==(output/'manifest.json').read_bytes()
                for entry in json.loads(manifest)['assets'].values():read_asset(output/entry['uri'],entry)
            finally:path.write_bytes(old)
            checks.append(label)
        reject('paper_plane/Shape.geo',lambda _:b'HGFF','truncated geometry fails before publication')
        reject('playground/grid_baseColor.png',lambda _:None,'missing scene texture fails before publication')
        reject('core/pbr/brdf.dds',lambda b:b[:128],'truncated DDS fails before publication')
        reject('core/shader/pbr_fs.sc',lambda b:b+b'\n// changed\n','unreviewed PBR source rejected')
        reject('core/pbr/probe.hdr.meta',lambda _:b'{"profiles":{"default":{"generate-probe":true,"max-probe-size":8192}}}','oversized probe rejected')
        reject('playground/grid_baseColor.png.meta',lambda _:b'{"profiles":{"default":{"min-filter":"Nearest"}}}','unsupported sampler metadata rejected')
    return checks

NATIVE_WINDOW = """import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
const inputs=INPUTS_JSON;
let frame=0;const samples=[];
const vector=v=>[v.x,v.y,v.z];
const update=hg.Scene.prototype.Update;
hg.Scene.prototype.Update=function(dt) {
  update.call(this,dt);
  if(globalThis.flightContract)return;
  const plane=this.GetNode('paper_plane/paper_plane.scn').GetTransform(),camera=this.GetCurrentCamera().GetTransform();
  samples.push({plane:{pos:vector(plane.GetPos()),rot:vector(plane.GetRot())},camera:{pos:vector(camera.GetPos()),rot:vector(camera.GetRot())},mouse:inputs[frame]});
};
const mouseX=hg.Mouse.prototype.X,mouseY=hg.Mouse.prototype.Y;
hg.Mouse.prototype.X=function(){return globalThis.flightContract?mouseX.call(this):inputs[frame][0];};
hg.Mouse.prototype.Y=function(){return globalThis.flightContract?mouseY.call(this):inputs[frame][1];};
export async function runWindow(title,create,options={}) {
  hg.AddAssetsFolder('../assets-native');hg.InputInit();hg.WindowSystemInit();
  const window=hg.NewWindow(title,960,625,32,hg.WV_Hidden);let app,initialized=false;
  try {
    initialized=hg.RenderInit(window,hg.RT_OpenGL);if(!initialized)throw Error('Native renderer failed');
    hg.RenderReset(960,625,0);app=create();
    for(frame=0;frame<(options.frameLimit??inputs.length);++frame) {
      await nextFrame(window);app.draw(16666667n,960,625);
      if(frame===3||frame===inputs.length-1)hg.RequestScreenShot(hg.InvalidFrameBufferHandle,'../reports/native-flight-'+(frame+1));
      hg.Frame();
    }
    console.log('FLIGHT_SAMPLES '+JSON.stringify(samples));
  } finally {
    try{app?.dispose();}finally{if(initialized)hg.RenderShutdown();hg.DestroyWindow(window);hg.WindowSystemShutdown();hg.InputShutdown();}
  }
}
"""


def native_reference(executable, assetc):
    result = subprocess.run([str(assetc), '-api', 'GL', str(WORK / 'asset-input'), str(WORK / 'assets-native')],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=180)
    (REPORTS / 'native-assetc.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    result.check_returncode()
    assert not re.search(r'[1-9][0-9]* task\(s\) failed', result.stdout + result.stderr)
    directory = WORK / 'native-reference'
    (directory / 'js').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(NATIVE / 'tutorials/game_mouse_flight.js', directory / 'game_mouse_flight.js')
    (directory / 'js/window.js').write_text(NATIVE_WINDOW.replace('INPUTS_JSON', json.dumps(INPUTS)), encoding='utf-8')
    for frame in [4, len(INPUTS)]:
        (REPORTS / f'native-flight-{frame}.tga').unlink(missing_ok=True)
    result = subprocess.run([str(executable), 'game_mouse_flight.js'], cwd=directory, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=120)
    (REPORTS / 'native-flight.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    result.check_returncode()
    match = re.search(r'FLIGHT_SAMPLES (\[[^\r\n]*\])', result.stdout)
    assert match, result.stdout[-3000:] + result.stderr[-1000:]
    for frame in [4, len(INPUTS)]:
        common.tga_to_png(REPORTS / f'native-flight-{frame}.tga', REPORTS / f'native-flight-{frame}.png')
    samples=json.loads(match[1])
    shutil.copyfile(EXPERIMENT / 'contract.js', directory / 'contract.js')
    result=subprocess.run([str(executable),'contract.js'],cwd=directory,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
    (REPORTS / 'native-contract.log').write_text(result.stdout+result.stderr,encoding='utf-8')
    result.check_returncode()
    match=re.search(r'FLIGHT_CONTRACT (\{[^\r\n]*\})',result.stdout)
    assert match,result.stdout[-3000:]+result.stderr[-1000:]
    return {'samples':samples,'contract':json.loads(match[1]),'executableSHA256':digest(executable),'assetcSHA256':digest(assetc)}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass
    def copyfile(self, source, outputfile):
        try:
            super().copyfile(source,outputfile)
        except (BrokenPipeError,ConnectionResetError):
            pass  # The integrity-failure test deliberately aborts concurrent fetches.


def browser_reference(executable, native):
    from playwright.sync_api import sync_playwright
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(DIST)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=common.browser_path(executable), headless=True)
            page = browser.new_page(viewport={'width': 960, 'height': 720}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.add_init_script('window.flightInputFrames=' + json.dumps(INPUTS) + ';Object.defineProperty(window,"WebAssembly",{get(){throw Error("Wasm is forbidden");}});')
            page.goto(f'http://127.0.0.1:{server.server_port}/?test&frames={len(INPUTS)}')
            page.wait_for_function("['stopped','failed'].includes(window.mouseFlight?.state)", timeout=60000)
            report = page.evaluate('({state:mouseFlight.state,error:mouseFlight.error,history:mouseFlight.history,samples:mouseFlight.samples,finalResources:mouseFlight.finalResources})')
            assert report['state'] == 'stopped', report
            assert not errors, errors
            for frame in [4, len(INPUTS)]:
                capture = page.evaluate(f'mouseFlight.captures[{frame}]')
                (REPORTS / f'web-flight-{frame}.png').write_bytes(base64.b64decode(capture.split(',')[1]))
            report['gpu']=page.evaluate("(()=>{const gl=mouseFlight.host.renderer.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()")
            report['drawMsMedian']=statistics.median(frame['drawMs'] for frame in report['history'][4:])
            if native:
                report['imageComparisons']={}
                for frame in [4,len(INPUTS)]:
                    a='data:image/png;base64,'+base64.b64encode((REPORTS / f'native-flight-{frame}.png').read_bytes()).decode()
                    b=page.evaluate(f'mouseFlight.captures[{frame}]')
                    comparison=page.evaluate('''async ([a,b])=>{
                      async function pixels(src){const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;
                        const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;}
                      const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)throw Error('Capture size differs');let sum=0,over=0;
                      for(let i=0;i<x.length;i+=4){let peak=0;for(let j=0;j<3;j++){const d=Math.abs(x[i+j]-y[i+j]);sum+=d;peak=Math.max(peak,d);}if(peak>16)over++;}
                      return {meanAbsoluteChannelError:sum/(x.length*.75),fractionPixelsOver16:over/(x.length/4)};
                    }''',[a,b])
                    report['imageComparisons'][str(frame)]=comparison
                    assert comparison['meanAbsoluteChannelError']<2 and comparison['fractionPixelsOver16']<.03,comparison
            page.route('**/contract.js',lambda route:route.fulfill(path=EXPERIMENT/'contract.js',content_type='text/javascript'))
            report['contract']=page.evaluate('''async()=>{
              const {createNativeBrowserApplication}=await import('harfang/browser'),{main}=await import('./contract.js');
              const host=await createNativeBrowserApplication({canvas:document.querySelector('canvas'),manifestURL:'./resources_compiled/manifest.json',fixedDeltaNs:16666667n});
              await host.run(main);return JSON.parse(JSON.stringify(globalThis.flightContract,(_,v)=>typeof v==='bigint'?{bigint:String(v)}:v));
            }''')
            report['lifecycle']=[]
            page.goto(f'http://127.0.0.1:{server.server_port}/?test&frames=100000')
            page.wait_for_function('mouseFlight.history.length>=3')
            page.locator('#pause').click()
            paused=page.evaluate('mouseFlight.host.frames')
            page.wait_for_timeout(100)
            assert page.evaluate('mouseFlight.host.frames')==paused
            page.evaluate('delete window.flightInputFrames')
            page.mouse.move(300,300)
            page.locator('#pause').click()
            page.wait_for_function('mouseFlight.host.frames>='+str(paused+2))
            input_contract=page.evaluate('''async()=>{
              const hg=await import('harfang'),m=new hg.Mouse();m.Update();const copy=m.GetState();
              const first=[m.X(),m.Y(),m.DtX(),m.DtY()];m.Update();const rect=document.querySelector('canvas').getBoundingClientRect();
              return {first,second:[m.DtX(),m.DtY()],copy:[copy.X(),copy.Y()],expected:[300,Math.trunc(rect.bottom-300)]};
            }''')
            assert input_contract['first'][:2]==input_contract['expected']==input_contract['copy'],input_contract
            assert input_contract['second']==[0,0]
            report['lifecycle']+=['pause/resume','real pointer coordinates use bottom-left drawing-buffer pixels','Mouse state copies and repeated Update deltas']
            page.set_viewport_size({'width':800,'height':600})
            page.wait_for_function('mouseFlight.metrics.viewport[0]===800')
            report['lifecycle'].append('browser resize drives viewport')
            for _ in range(2):
                page.evaluate('window.previousFlightHost=mouseFlight.host;true')
                page.locator('#restart').click();page.wait_for_function("mouseFlight.host!==window.previousFlightHost&&(mouseFlight.state==='failed'||mouseFlight.state==='running'&&mouseFlight.history.length>=3)")
                assert page.evaluate('mouseFlight.state')=='running',page.evaluate('({state:mouseFlight.state,error:mouseFlight.error})')
                assert page.evaluate('mouseFlight.metrics.programs')==2
                assert page.evaluate('mouseFlight.metrics.lines.programs')==1
            report['lifecycle'].append('two restarts keep PBR and line program counts bounded')
            page.locator('canvas').focus();page.keyboard.press('Escape');page.wait_for_function("['stopped','failed'].includes(mouseFlight.state)")
            assert page.evaluate('mouseFlight.state')=='stopped',page.evaluate('mouseFlight.error')
            assert page.evaluate('mouseFlight.finalResources.gpuBytes+mouseFlight.finalResources.lineBufferBytes')==0
            report['lifecycle'].append('Escape stops and releases GPU resources')
            assert not errors,errors
            page.locator('#restart').click();page.wait_for_function("mouseFlight.state==='running'&&mouseFlight.history.length>=3")
            context_loss=page.evaluate("(()=>{const e=mouseFlight.host.renderer.gl.getExtension('WEBGL_lose_context');if(e)e.loseContext();return !!e;})()")
            if context_loss:
                page.wait_for_function("mouseFlight.state==='failed'")
                assert page.evaluate('mouseFlight.host.finalResources.gpuBytes+mouseFlight.host.finalResources.lineBufferBytes')==0
                report['lifecycle'].append('context loss stops and releases tracked resources')
            # Integrity failures must happen before creating a WebGL context.
            bad=browser.new_page()
            bad.add_init_script("window.contextCalls=0;const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(...a){window.contextCalls++;return original.apply(this,a)};")
            manifest=json.loads((DIST/'resources_compiled/manifest.json').read_text())
            image=manifest['assets']['playground/grid_baseColor.png']['uri']
            bad.route('**/'+image,lambda route:route.fulfill(body=b'corrupt',content_type='application/octet-stream'))
            bad.goto(f'http://127.0.0.1:{server.server_port}/?test')
            bad.wait_for_function("mouseFlight.state==='failed'")
            assert bad.evaluate('contextCalls')==0
            assert 'Corrupt texture' in bad.evaluate('mouseFlight.error')
            report['lifecycle'].append('corrupt texture rejected before WebGL allocation')
            bad.close()
            report['browserVersion'] = browser.version
            browser.close()
            return report
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--native', type=Path)
    parser.add_argument('--assetc', type=Path, default=ROOT.parent / 'install/assetc/assetc.exe')
    parser.add_argument('--browser')
    args = parser.parse_args()
    if not args.skip_build:
        build()
    REPORTS.mkdir(parents=True, exist_ok=True)
    compiler=compiler_checks()
    native = native_reference(args.native.resolve(), args.assetc.resolve()) if args.native else None
    web = browser_reference(args.browser,native)
    report = {'web': web, 'native': native, 'compilerChecks':compiler,'entryByteIdentical': (NATIVE / 'tutorials/game_mouse_flight.js').read_bytes() == (DIST / 'game_mouse_flight.js').read_bytes()}
    (REPORTS / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    if native:
        common.compare_contract(native['samples'], web['samples'], 'flight')
        common.compare_contract(native['contract'],web['contract'],'contract')
    assert report['entryByteIdentical']
    for key in ['gpuBytes', 'programs', 'meshes', 'instanceBuffers', 'textures', 'shadowMaps', 'linePrograms', 'lineBufferBytes']:
        assert web['finalResources'][key] == 0, key
    print(f'Mouse Flight passed: {len(INPUTS)} frames; copied entry, replayed inputs and resource cleanup. Reports: {REPORTS}')


if __name__ == '__main__':
    main()
