"""Validate copied entry, forward rendering, explicit stubs, instances and cleanup."""
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
import subprocess
import tempfile
import threading
from build import build, digest, ROOT, NATIVE, WORK, DIST, EXPERIMENT
from asset_validation import read_asset

spec = importlib.util.spec_from_file_location('many_validation', ROOT / 'experiments/native-scene-many-nodes/validate.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
REPORTS = WORK / 'reports'
FRAMES = 60


def compiler_checks():
    compiler = ROOT / 'build/assetc-web/Release/assetc-web.exe'
    if not compiler.exists():
        compiler = ROOT / 'build/assetc-web/assetc-web'
    checks = []
    with tempfile.TemporaryDirectory(prefix='hg-engine-') as directory:
        source, output = Path(directory) / 'source', Path(directory) / 'compiled'
        shutil.copytree(WORK / 'asset-input', source)
        options = ['--animation-stubs', '--max-texture-size', '1024']
        def run(arguments, success):
            result = subprocess.run([str(compiler), '-q', *arguments, str(source), str(output)], capture_output=True,
                                    text=True, encoding='utf-8', errors='replace', timeout=90)
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            return result
        run(options, True)
        manifest = (output / 'manifest.json').read_bytes()
        assert manifest == (WORK / 'resources_compiled/manifest.json').read_bytes()
        checks.append('deterministic compilation from the original source tree')
        metadata = json.loads(manifest)
        for name, entry in metadata['assets'].items():
            if entry['kind'] == 'texture' and name.endswith('.png'):
                assert max(entry['levels'][0]['width'], entry['levels'][0]['height']) <= 1024
        checks.append('PNG texture limit applied by assetc-web with original logical paths')
        failure = run(['--max-texture-size', '1024'], False)
        assert '--animation-stubs' in failure.stderr
        checks.append('animation tracks require explicit stub opt-in')
        run(['--max-texture-size', '123'], False)
        checks.append('invalid resize limit rejected')
        path = source / 'car_engine/engine.scn'
        scene = json.loads(path.read_text())
        scene['environment']['probe']['parallax'] = 1
        path.write_text(json.dumps(scene), encoding='utf-8')
        failure = run(options, False)
        assert 'Parallax' in failure.stderr
        assert (output / 'manifest.json').read_bytes() == manifest
        for name, entry in metadata['assets'].items():
            read_asset(output / entry['uri'], entry)
        checks.append('unsupported probe rejects and preserves the previous complete output')
    return checks

NATIVE_WINDOW = """import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
let frame=0;const samples=[];const update=hg.Scene.prototype.Update;
hg.Scene.prototype.Update=function(dt){update.call(this,dt);const v=this.GetNode('engine_master').GetTransform().GetRot();samples.push([v.x,v.y,v.z]);};
export async function runWindow(title,create,options={}) {
  hg.AddAssetsFolder('../assets-native');hg.InputInit();hg.WindowSystemInit();
  const window=hg.NewWindow(title,960,625,32,hg.WV_Hidden);let app,initialized=false;
  try {
    initialized=hg.RenderInit(window,hg.RT_OpenGL);if(!initialized)throw Error('Native renderer failed');
    hg.RenderReset(960,625,0);app=create();
    for(frame=0;frame<60;++frame){await nextFrame(window);app.draw(16666667n,960,625);
      if(frame===3||frame===59)hg.RequestScreenShot(hg.InvalidFrameBufferHandle,'../reports/native-engine-'+(frame+1));hg.Frame();}
    console.log('ENGINE_SAMPLES '+JSON.stringify(samples));
  } finally {try{app?.dispose();}finally{if(initialized)hg.RenderShutdown();hg.DestroyWindow(window);hg.WindowSystemShutdown();hg.InputShutdown();}}
}
"""


def native_reference(executable, assetc):
    result = subprocess.run([str(assetc), '-api', 'GL', str(WORK / 'asset-input'), str(WORK / 'assets-native')],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300)
    (REPORTS / 'native-assetc.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    result.check_returncode()
    assert not re.search(r'[1-9][0-9]* task\(s\) failed', result.stdout + result.stderr)
    directory = WORK / 'native-reference'
    (directory / 'js').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(NATIVE / 'tutorials/scene_aaa.js', directory / 'scene_aaa.js')
    shutil.copyfile(EXPERIMENT / 'contract.js', directory / 'contract.js')
    (directory / 'js/window.js').write_text(NATIVE_WINDOW, encoding='utf-8')
    (directory / 'forward.js').write_text("import {main as scene} from './scene_aaa.js';export function main(){return scene({aaa:false});}\n")
    result = subprocess.run([str(executable), 'forward.js'], cwd=directory, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=120)
    (REPORTS / 'native-engine.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    result.check_returncode()
    match = re.search(r'ENGINE_SAMPLES (\[[^\r\n]*\])', result.stdout)
    assert match, result.stdout[-3000:] + result.stderr[-1000:]
    for frame in [4, FRAMES]:
        common.tga_to_png(REPORTS / f'native-engine-{frame}.tga', REPORTS / f'native-engine-{frame}.png')
    result = subprocess.run([str(executable), 'contract.js'], cwd=directory, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=30)
    result.check_returncode()
    contract = re.search(r'ENGINE_CONTRACT (\{[^\r\n]*\})', result.stdout)
    assert contract, result.stdout + result.stderr
    return {'samples': json.loads(match[1]), 'contract': json.loads(contract[1]), 'mode': 'forward, aaa:false',
            'textures': 'Original native resolution/compression; Web texture size is recorded separately.'}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def copyfile(self, source, output):
        try:
            super().copyfile(source, output)
        except (BrokenPipeError, ConnectionResetError):
            pass


def browser_reference(native):
    from playwright.sync_api import sync_playwright
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(DIST)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    origin = f'http://127.0.0.1:{server.server_port}'
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=common.browser_path(None), headless=True)
            page = browser.new_page(viewport={'width': 960, 'height': 720}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.add_init_script('Object.defineProperty(window,"WebAssembly",{get(){throw Error("Wasm is forbidden");}});')
            page.goto(f'{origin}/?test&frames={FRAMES}')
            page.wait_for_function("['stopped','failed'].includes(window.engineScene?.state)", timeout=120000)
            report = page.evaluate('({state:engineScene.state,error:engineScene.error,history:engineScene.history,samples:engineScene.samples,finalResources:engineScene.finalResources})')
            assert report['state'] == 'stopped', report
            assert not errors, errors
            assert len(report['samples']) == FRAMES
            assert report['history'][-1]['scene']['nodes'] == 126
            assert report['history'][-1]['shadowPasses'] == 5
            assert report['history'][-1]['shadowMaps'] == 2
            assert len(report['history'][-1]['warnings']) == 3
            report['drawMsMedian'] = statistics.median(frame['drawMs'] for frame in report['history'][4:])
            for frame in [4, FRAMES]:
                capture = page.evaluate(f'engineScene.captures[{frame}]')
                (REPORTS / f'web-engine-{frame}.png').write_bytes(base64.b64decode(capture.split(',')[1]))
            page.route('**/contract.js', lambda route: route.fulfill(path=EXPERIMENT / 'contract.js', content_type='text/javascript'))
            report['contract'] = page.evaluate("async()=>{const {main}=await import('./contract.js');return main();}")
            if native:
                common.compare_contract(native['samples'], report['samples'], 'engine rotation')
                common.compare_contract(native['contract'], report['contract'], 'stub signatures/defaults')
                report['imageComparisons'] = {}
                for frame in [4, FRAMES]:
                    a = 'data:image/png;base64,' + base64.b64encode((REPORTS / f'native-engine-{frame}.png').read_bytes()).decode()
                    b = page.evaluate(f'engineScene.captures[{frame}]')
                    comparison = page.evaluate('''async ([a,b])=>{
                      async function pixels(src){const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;
                        const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;}
                      const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)throw Error('Capture size differs');let sum=0,over=0;
                      for(let i=0;i<x.length;i+=4){let peak=0;for(let j=0;j<3;j++){const d=Math.abs(x[i+j]-y[i+j]);sum+=d;peak=Math.max(peak,d);}if(peak>16)over++;}
                      return {meanAbsoluteChannelError:sum/(x.length*.75),fractionPixelsOver16:over/(x.length/4)};
                    }''', [a,b])
                    report['imageComparisons'][str(frame)] = comparison
                    assert comparison['meanAbsoluteChannelError'] < 2 and comparison['fractionPixelsOver16'] < .03, comparison
            report['stubChecks'] = page.evaluate("""async()=>{
              const hg=await import('harfang');const config=new hg.ForwardPipelineAAAConfig();
              const aaa=hg.CreateForwardPipelineAAAFromAssets('core',config,hg.BR_Equal,hg.BR_Equal);
              if(hg.IsValid(aaa))throw Error('Stub claims real AAA GPU resources');
              hg.DestroyForwardPipelineAAA(aaa);hg.DestroyForwardPipelineAAA(aaa);
              const scene=new hg.Scene(),ref=scene.GetSceneAnim('Take 001'),play=scene.PlayAnim(ref);
              if(scene.IsPlaying(play)||scene.GetPlayingAnimRefs().size()!==0n)throw Error('Stub claims playback');
              return ['AAA allocation-free invalid handle','idempotent AAA destruction','animation never reports playback'];
            }""")
            report['lifecycle'] = []
            page.goto(f'{origin}/?test&frames=100000')
            page.wait_for_function('engineScene.history.length>=3')
            page.locator('#pause').click()
            frame = page.evaluate('engineScene.host.frames')
            page.wait_for_timeout(100)
            assert page.evaluate('engineScene.host.frames') == frame
            report['instanceChecks'] = page.evaluate("""async()=>{
              const hg=await import('harfang'),host=engineScene.host,scene=host.currentScene;
              if(scene.GetNodes().length!==123||scene.GetAllNodes().length!==126)throw Error('Instance node enumeration mismatch');
              const roots=[];const nodes=scene.GetNodes();for(let i=0;i<nodes.length;++i){const n=nodes.get(i);if(n.GetName()==='cyclo')roots.push(n);}
              if(roots.length!==3||roots.some(n=>n.GetInstanceSceneView().GetNodes().length!==1))throw Error('Scene instance views missing');
              const key='cycle.scn',body={nodes:[{idx:0,name:'cycle',components:[0,null,null,null,null],instance:0}],
                transforms:[{pos:[0,0,0],rot:[0,0,0],scl:[1,1,1],parent:null}],instances:[{name:key}]};
              host.assets.scenes.set(key,body);const fresh=new hg.Scene(),resources=new hg.PipelineResources();let rejected=false;
              try{hg.LoadSceneFromAssets(key,fresh,resources,hg.GetForwardPipelineInfo());}catch(e){rejected=e.code==='INVALID_SCENE';}
              finally{host.assets.scenes.delete(key);}
              if(!rejected||Object.values(fresh.stats).some(n=>n!==0))throw Error('Cyclic instance failed to roll back');
              fresh.Clear();return ['native node lists exclude instance children','three instance scene views','cyclic instances reject and roll back'];
            }""")
            page.set_viewport_size({'width': 800, 'height': 600})
            page.locator('#pause').click()
            page.wait_for_function('engineScene.host.frames>3&&engineScene.metrics.viewport[0]===800')
            report['lifecycle'] += ['pause/resume', 'resize']
            page.locator('canvas').focus()
            page.keyboard.press('Escape')
            page.wait_for_function("engineScene.state==='stopped'")
            assert page.evaluate('engineScene.finalResources.gpuBytes') == 0
            report['lifecycle'].append('Escape and cleanup')
            page.evaluate('window.oldEngineHost=engineScene.host')
            page.locator('#restart').click()
            page.wait_for_function('engineScene.host!==window.oldEngineHost&&engineScene.history.length>=3')
            assert page.evaluate('engineScene.metrics.warnings.length') == 3
            page.evaluate('async()=>{engineScene.host.pause();await engineScene.host.stop();}')
            assert page.evaluate('engineScene.finalResources.gpuBytes') == 0
            report['lifecycle'].append('restart and stop while paused')
            assert not errors, errors
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
    args = parser.parse_args()
    if not args.skip_build:
        build()
    REPORTS.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((DIST / 'resources_compiled/manifest.json').read_text())
    assert manifest['animationPlayback'] == 'stub'
    for name, entry in manifest['assets'].items():
        assert entry['uri'] == name + '.lz4'
        read_asset(DIST / 'resources_compiled' / entry['uri'], entry)
    original = json.loads((NATIVE / 'tutorials/resources/car_engine/engine.scn').read_text())
    compiled = json.loads(read_asset(DIST / 'resources_compiled' / manifest['assets']['car_engine/engine.scn']['uri'], manifest['assets']['car_engine/engine.scn']))
    assert original == compiled, 'Scene content must survive compilation, including animation tracks'
    assert (NATIVE / 'tutorials/scene_aaa.js').read_bytes() == (DIST / 'scene_aaa.js').read_bytes()
    compiler = compiler_checks()
    native = native_reference(args.native.resolve(), args.assetc.resolve()) if args.native else None
    web = browser_reference(native)
    for key in ['gpuBytes', 'programs', 'meshes', 'instanceBuffers', 'textures', 'shadowMaps']:
        assert web['finalResources'][key] == 0, key
    report = {'status': 'pass', 'web': web, 'native': native, 'compilerChecks': compiler, 'entryByteIdentical': True, 'scenePreserved': True,
              'assetBytes': sum(entry['byteLength'] for entry in manifest['assets'].values()), 'maxTextureSize': manifest['maxTextureSize']}
    (REPORTS / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Engine Scene passed: {FRAMES} frames, stubs, rotation, instances, shadows and cleanup. Reports: {REPORTS}')


if __name__ == '__main__':
    main()
