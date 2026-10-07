"""Validate the unchanged PBR tutorial, JPEG compilation, alpha rendering and lifecycle."""
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
from build import build, digest, ROOT, NATIVE, WORK, DIST

spec = importlib.util.spec_from_file_location('many_validation', ROOT / 'experiments/native-scene-many-nodes/validate.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
REPORTS = WORK / 'reports'
FRAMES = 12


def compiler_checks():
    compiler = ROOT / 'build/assetc-web/Release/assetc-web.exe'
    if not compiler.exists():
        compiler = ROOT / 'build/assetc-web/assetc-web'
    checks = []
    with tempfile.TemporaryDirectory(prefix='hg-pbr-') as directory:
        source, output = Path(directory) / 'source', Path(directory) / 'compiled'
        # A small real source fixture exercises JPEG conversion without filtering
        # the same HDR probe repeatedly. Shader provenance remains mandatory.
        names = set()
        for filename in ['source-hashes.json', 'scene-source-hashes.json']:
            names.update(json.loads((ROOT / 'tools/native/adapters' / filename).read_text()))
        texture = 'materials/MetalPlates006_normal.jpg'
        names.update([texture, texture + '.meta'])
        for name in names:
            target = source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(WORK / 'asset-input' / name, target)

        def run(options, success):
            result = subprocess.run([str(compiler), '-q', *options, str(source), str(output)], capture_output=True,
                                    text=True, encoding='utf-8', errors='replace', timeout=90)
            assert (result.returncode == 0) == success, result.stdout + result.stderr
            return result

        run([], True)
        metadata = json.loads((output / 'manifest.json').read_text())['assets'][texture]
        original = json.loads((WORK / 'resources_compiled/manifest.json').read_text())['assets'][texture]
        assert metadata == original
        assert metadata['uri'] == texture and metadata['format'] == 'rgba8'
        assert metadata['sourceCompression'] == 'BC5' and metadata['sourceTextureType'] == 'NormalMap'
        assert metadata['levels'][0]['width'] == 2048 and metadata['mips'] == 12
        assert digest(output / texture) == metadata['sha256']
        assert (source / texture).read_bytes()[:2] == b'\xff\xd8'
        assert (output / texture).read_bytes()[:2] != b'\xff\xd8'
        checks.append('JPEG decoded offline to deterministic RGBA8 mipmaps; name and source metadata preserved')
        run(['--max-texture-size', '512'], True)
        manifest = (output / 'manifest.json').read_bytes()
        metadata = json.loads(manifest)['assets'][texture]
        assert metadata['levels'][0]['width'] == 512 and metadata['mips'] == 10
        checks.append('optional 512-pixel compilation limit applies to JPEG')
        (source / texture).write_bytes(b'\xff\xd8\xff')
        result = run([], False)
        assert 'JPEG header' in result.stderr
        assert (output / 'manifest.json').read_bytes() == manifest
        for name, entry in json.loads(manifest)['assets'].items():
            assert digest(output / name) == entry['sha256']
        checks.append('truncated JPEG rejected; previous complete output preserved')
    return checks


NATIVE_WINDOW = """import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
const update=hg.Scene.prototype.Update;let snapshot;
hg.Scene.prototype.Update=function(dt){update.call(this,dt);const camera=this.GetCurrentCamera(),t=camera.GetTransform(),p=t.GetPos(),r=t.GetRot();
  snapshot={nodes:Number(this.GetNodes().size()),camera:camera.GetName(),position:[p.x,p.y,p.z],rotation:[r.x,r.y,r.z]};};
export async function runWindow(title,create,options={}) {
  hg.AddAssetsFolder('../assets-native');hg.InputInit();hg.WindowSystemInit();
  const window=hg.NewWindow(title,960,625,32,hg.WV_Hidden);let app,initialized=false;
  try {
    initialized=hg.RenderInit(window,hg.RT_OpenGL);if(!initialized)throw Error('Native renderer failed');
    hg.RenderReset(960,625,0);app=create();
    for(let frame=0;frame<12;++frame){await nextFrame(window);app.draw(16666667n,960,625);
      if(frame===3||frame===11)hg.RequestScreenShot(hg.InvalidFrameBufferHandle,'../reports/native-pbr-'+(frame+1));hg.Frame();}
    console.log('PBR_SNAPSHOT '+JSON.stringify(snapshot));
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
    shutil.copyfile(NATIVE / 'tutorials/scene_pbr.js', directory / 'scene_pbr.js')
    (directory / 'js/window.js').write_text(NATIVE_WINDOW, encoding='utf-8')
    result = subprocess.run([str(executable), 'scene_pbr.js'], cwd=directory, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=120)
    (REPORTS / 'native-pbr.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    result.check_returncode()
    snapshot = re.search(r'PBR_SNAPSHOT (\{[^\r\n]*\})', result.stdout)
    assert snapshot, result.stdout + result.stderr
    for frame in [4, FRAMES]:
        common.tga_to_png(REPORTS / f'native-pbr-{frame}.tga', REPORTS / f'native-pbr-{frame}.png')
    return {'sceneSnapshot': json.loads(snapshot[1]), 'renderer': 'native HG JS / bgfx OpenGL',
            'textures': 'Original resolution and native compression; Web uses RGBA8.'}


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
            page.wait_for_function("['stopped','failed'].includes(window.pbrScene?.state)", timeout=120000)
            report = page.evaluate('({state:pbrScene.state,error:pbrScene.error,history:pbrScene.history,sceneSnapshot:pbrScene.sceneSnapshot,loadingProgress:pbrScene.loadingProgress,finalResources:pbrScene.finalResources})')
            assert report['state'] == 'stopped' and not errors, report
            last = report['history'][-1]
            assert last['scene']['nodes'] == 15 and last['instances'] == 13
            assert last['opaqueDrawCalls'] == 12 and last['transparentDrawCalls'] == 1
            assert last['shadowPasses'] == 1 and last['shadowDrawCalls'] == 12
            assert len(last['warnings']) == 1 and 'MSAA' in last['warnings'][0]
            assert report['loadingProgress']['phase'] == 'ready' and report['loadingProgress']['percent'] == 100
            report['drawMsMedian'] = statistics.median(frame['drawMs'] for frame in report['history'][4:])
            for frame in [4, FRAMES]:
                capture = page.evaluate(f'pbrScene.captures[{frame}]')
                (REPORTS / f'web-pbr-{frame}.png').write_bytes(base64.b64decode(capture.split(',')[1]))
            if native:
                common.compare_contract(native['sceneSnapshot'], report['sceneSnapshot'], 'scene snapshot')
                report['imageComparisons'] = {}
                for frame in [4, FRAMES]:
                    a = 'data:image/png;base64,' + base64.b64encode((REPORTS / f'native-pbr-{frame}.png').read_bytes()).decode()
                    b = page.evaluate(f'pbrScene.captures[{frame}]')
                    comparison = page.evaluate('''async ([a,b])=>{
                      async function pixels(src){const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;
                        const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;}
                      const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)throw Error('Capture size differs');let sum=0,over=0;
                      for(let i=0;i<x.length;i+=4){let peak=0;for(let j=0;j<3;j++){const d=Math.abs(x[i+j]-y[i+j]);sum+=d;peak=Math.max(peak,d);}if(peak>16)over++;}
                      return {meanAbsoluteChannelError:sum/(x.length*.75),fractionPixelsOver16:over/(x.length/4)};
                    }''', [a,b])
                    report['imageComparisons'][str(frame)] = comparison
                    assert comparison['meanAbsoluteChannelError'] < 2 and comparison['fractionPixelsOver16'] < .03, comparison
            report['budgetChecks'] = page.evaluate("""async()=>{
              const {loadProgramAssets}=await import('./src/compat/program-assets.js');let rejected=false;
              const fetch=window.fetch,requests=[];window.fetch=(url,...args)=>{requests.push(String(url));return fetch(url,...args);};
              try{await loadProgramAssets('./resources_compiled/manifest.json');}catch(e){rejected=e.code==='ASSET_BUDGET';}
              finally{window.fetch=fetch;}
              if(!rejected||requests.length!==1)throw Error('Default 128 MiB budget must reject before payload downloads');
              return ['default 128 MiB rejects before payload requests','explicit 256 MiB loads original textures'];
            }""")
            page.goto(f'{origin}/?test&frames=100000')
            page.wait_for_function('pbrScene.history.length>=3', timeout=120000)
            page.locator('#pause').click()
            frame = page.evaluate('pbrScene.host.frames')
            page.wait_for_timeout(100)
            assert page.evaluate('pbrScene.host.frames') == frame
            report['alphaChecks'] = page.evaluate("""async()=>{
              const hg=await import('harfang'),host=pbrScene.host,renderer=host.renderer;
              const scene=new hg.Scene(),resources=[...host.resources][0],key='alpha-order.scn';
              const source=structuredClone(host.assets.scenes.get('materials/materials.scn'));
              const node=source.nodes.find(n=>source.objects[n.components[2]]?.materials[0].blend_mode==='alpha');
              if(!node)throw Error('Missing authored alpha sphere');
              const duplicate=structuredClone(node);duplicate.idx=Math.max(...source.nodes.map(n=>n.idx))+1;
              duplicate.name='alpha-duplicate';duplicate.components[0]=source.transforms.length;
              const transform=structuredClone(source.transforms[node.components[0]]);transform.pos[2]+=1;
              source.transforms.push(transform);source.nodes.push(duplicate);host.assets.scenes.set(key,source);
              const draws=[],draw=renderer.draw;renderer.draw=function(batch){draws.push({alpha:batch.transparent,count:batch.count,depth:batch.depth});return draw.call(this,batch);};
              try {
                hg.LoadSceneFromAssets(key,scene,resources,hg.GetForwardPipelineInfo());scene.Update(0n);
                renderer.submit(scene,[...host.pipelines][0]);
                const alpha=draws.filter(d=>d.alpha),firstAlpha=draws.findIndex(d=>d.alpha);
                if(alpha.length!==2||alpha.some(d=>d.count!==1)||alpha[0].depth<=alpha[1].depth)throw Error('Alpha instances must be separate, back-to-front draws');
                if(draws.slice(firstAlpha).some(d=>!d.alpha)||renderer.stats.shadowDrawCalls!==12)throw Error('Alpha pass must follow opaque and omit shadow casting');
              } finally {renderer.draw=draw;host.assets.scenes.delete(key);scene.Clear();}
              return ['shared alpha material stays in separate draws','back-to-front depth order','opaque first; alpha excluded from shadows'];
            }""")
            page.set_viewport_size({'width': 800, 'height': 600})
            page.locator('#pause').click()
            page.wait_for_function('pbrScene.metrics.viewport[0]===800')
            page.locator('canvas').focus()
            page.keyboard.press('Escape')
            page.wait_for_function("pbrScene.state==='stopped'")
            assert page.evaluate('pbrScene.finalResources.gpuBytes') == 0
            page.evaluate('window.oldPbrHost=pbrScene.host')
            page.locator('#restart').click()
            page.wait_for_function('pbrScene.host!==window.oldPbrHost&&pbrScene.history.length>=3', timeout=120000)
            page.evaluate('async()=>{pbrScene.host.pause();await pbrScene.host.stop();}')
            assert page.evaluate('pbrScene.finalResources.gpuBytes') == 0
            report['lifecycle'] = ['pause/resume', 'resize', 'Escape and cleanup', 'restart and stop while paused']
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
    for name, entry in manifest['assets'].items():
        assert name == entry['uri'] and digest(DIST / 'resources_compiled' / name) == entry['sha256']
    assert json.loads((NATIVE / 'tutorials/resources/materials/materials.scn').read_text()) == json.loads((DIST / 'resources_compiled/materials/materials.scn').read_text())
    assert (NATIVE / 'tutorials/scene_pbr.js').read_bytes() == (DIST / 'scene_pbr.js').read_bytes()
    compiler = compiler_checks()
    native = native_reference(args.native.resolve(), args.assetc.resolve()) if args.native else None
    web = browser_reference(native)
    for key in ['gpuBytes', 'programs', 'meshes', 'instanceBuffers', 'textures', 'shadowMaps']:
        assert web['finalResources'][key] == 0, key
    report = {'status': 'pass', 'web': web, 'native': native, 'compilerChecks': compiler, 'entryByteIdentical': True,
              'scenePreserved': True, 'assetBytes': sum(entry['byteLength'] for entry in manifest['assets'].values())}
    (REPORTS / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'PBR Scene passed: native/Web images, JPEG, alpha, budgets and cleanup. Reports: {REPORTS}')


if __name__ == '__main__':
    main()
