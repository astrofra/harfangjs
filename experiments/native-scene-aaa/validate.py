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
        options = ['--max-texture-size', '1024']
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
        assert metadata['animationPlayback'] == 'scene-trs/1'
        checks.append('rigid node animation playback enabled by default')
        run(['--max-texture-size', '123'], False)
        checks.append('invalid resize limit rejected')
        path = source / 'car_engine/engine.scn'
        scene = json.loads(path.read_text())
        original = path.read_bytes()
        scene['anims'][0]['anim']['quat'][0]['keys'][0]['v'] = [0, 0, 0, 0]
        path.write_text(json.dumps(scene), encoding='utf-8')
        assert 'quaternion' in run(options, False).stderr
        assert (output / 'manifest.json').read_bytes() == manifest
        path.write_bytes(original)
        scene = json.loads(original)
        checks.append('invalid animation fails before publication')
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
let frame=0;const samples=[],animationSamples=[],names=ANIMATED_NODE_NAMES;const update=hg.Scene.prototype.Update;
hg.Scene.prototype.Update=function(dt){update.call(this,dt);const v=this.GetNode('engine_master').GetTransform().GetRot();samples.push([v.x,v.y,v.z]);
  animationSamples.push({playing:this.GetPlayingAnimRefs().length,worlds:names.map(name=>{
    const m=this.GetNode(name).GetTransform().GetWorld();return [hg.GetX(m),hg.GetY(m),hg.GetZ(m),hg.GetT(m)].flatMap(v=>[v.x,v.y,v.z]);})});};
export async function runWindow(title,create,options={}) {
  hg.AddAssetsFolder('../assets-native');hg.InputInit();hg.WindowSystemInit();
  const window=hg.NewWindow(title,960,625,32,hg.WV_Hidden);let app,initialized=false;
  try {
    initialized=hg.RenderInit(window,hg.RT_OpenGL);if(!initialized)throw Error('Native renderer failed');
    hg.RenderReset(960,625,0);app=create();
    for(frame=0;frame<60;++frame){await nextFrame(window);app.draw(16666667n,960,625);
      if(frame===3||frame===59)hg.RequestScreenShot(hg.InvalidFrameBufferHandle,'../reports/native-engine-'+(frame+1));hg.Frame();}
    console.log('ENGINE_SAMPLES '+JSON.stringify(samples));
    console.log('ENGINE_ANIMATION_SAMPLES '+JSON.stringify(animationSamples));
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
    source_scene = json.loads((WORK / 'asset-input/car_engine/engine.scn').read_bytes())
    names = [next(n['name'] for n in source_scene['nodes'] if n['idx'] == b['node']) for b in source_scene['scene_anims'][0]['node_anims']]
    (directory / 'js/window.js').write_text(NATIVE_WINDOW.replace('ANIMATED_NODE_NAMES', json.dumps(names)), encoding='utf-8')
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
    animation_samples = re.search(r'ENGINE_ANIMATION_SAMPLES (\[[^\r\n]*\])', (REPORTS / 'native-engine.log').read_text())
    assert animation_samples, 'Missing native animation samples'
    return {'samples': json.loads(match[1]), 'animationSamples': json.loads(animation_samples[1]), 'contract': json.loads(contract[1]), 'mode': 'forward, aaa:false',
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
            report = page.evaluate('({state:engineScene.state,error:engineScene.error,history:engineScene.history,samples:engineScene.samples,animationSamples:engineScene.animationSamples,finalResources:engineScene.finalResources})')
            assert report['state'] == 'stopped', report
            assert not errors, errors
            assert len(report['samples']) == FRAMES
            assert report['history'][-1]['scene']['nodes'] == 126
            assert report['history'][-1]['shadowPasses'] == 5
            assert report['history'][-1]['shadowMaps'] == 2
            assert len(report['history'][-1]['warnings']) == 2
            assert all(s['playing'] == 1 and len(s['worlds']) == 29 for s in report['animationSamples'])
            assert report['animationSamples'][0]['worlds'] != report['animationSamples'][-1]['worlds']
            report['drawMsMedian'] = statistics.median(frame['drawMs'] for frame in report['history'][4:])
            for frame in [4, FRAMES]:
                capture = page.evaluate(f'engineScene.captures[{frame}]')
                (REPORTS / f'web-engine-{frame}.png').write_bytes(base64.b64decode(capture.split(',')[1]))
            page.route('**/contract.js', lambda route: route.fulfill(path=EXPERIMENT / 'contract.js', content_type='text/javascript'))
            report['contract'] = page.evaluate("async()=>{const {main}=await import('./contract.js');return main();}")
            if native:
                common.compare_contract(native['samples'], report['samples'], 'engine rotation')
                differences = [abs(a-b) for x,y in zip(native['animationSamples'],report['animationSamples'])
                               for m,n in zip(x['worlds'],y['worlds']) for a,b in zip(m,n)]
                report['animationMaxMatrixError'] = max(differences)
                assert report['animationMaxMatrixError'] < 1e-4, report['animationMaxMatrixError']
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
              if(scene.IsPlaying(play)||scene.GetPlayingAnimRefs().size()!==0n)throw Error('Missing clip claims playback');
              return ['AAA allocation-free invalid handle','idempotent AAA destruction','invalid animation handles reject playback'];
            }""")
            report['lifecycle'] = []
            page.goto(f'{origin}/?test&frames=100000')
            page.wait_for_function('engineScene.history.length>=3')
            page.locator('#pause').click()
            frame = page.evaluate('engineScene.host.frames')
            paused_pose = page.evaluate('engineScene.animationSamples.at(-1)')
            page.wait_for_timeout(100)
            assert page.evaluate('engineScene.host.frames') == frame
            assert page.evaluate('engineScene.animationSamples.at(-1)') == paused_pose
            report['animationChecks'] = page.evaluate("""async()=>{
              const hg=await import('harfang'),host=engineScene.host,scene=host.currentScene;
              const clip=scene.GetSceneAnim('Take 001'),info=hg.GetSceneAnimInfo(scene,clip);
              if(!info.valid||info.t_end-info.t_start!==10000000000n)throw Error('Missing ten-second clip');
              scene.StopAllAnims();const play=scene.PlayAnim(clip,hg.ALM_Loop);scene.Update(0n);
              const names=host.assets.scenes.get('car_engine/engine.scn').scene_anims[0].node_anims.map(b=>
                host.assets.scenes.get('car_engine/engine.scn').nodes.find(n=>n.idx===b.node).name);
              const pose=()=>names.map(n=>[...scene.GetNode(n).GetTransform().GetWorld().data]);
              const first=JSON.stringify(pose());scene.Update(10000000000n);
              if(JSON.stringify(pose())!==first||!scene.IsPlaying(play))throw Error('Ten-second loop mismatch');
              scene.StopAllAnims();const once=scene.PlayAnim(clip);scene.Update(10000000000n);
              if(scene.IsPlaying(once))throw Error('Once failed to stop');
              scene.PlayAnim(clip,hg.ALM_Loop);
              return ['29 authored node tracks','exact ten-second loop','once endpoint stops','UI pause freezes animation'];
            }""")
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
              fresh.Clear();
              const child='animated-child.scn',parent='animated-parent.scn';
              const trs=x=>({pos:[x,0,0],rot:[0,0,0],scl:[1,1,1],parent:null});
              const childBody={nodes:[{idx:7,name:'moving',components:[0,null,null,null,null]}],transforms:[trs(0)],
                anims:[{idx:3,anim:{t_start:0,t_end:1000000000,flags:[],vec3:[{target:'Position',keys:[
                  {t:0,v:[0,0,0],tension:0,bias:0},{t:1000000000,v:[10,0,0],tension:0,bias:0}]}]}}],
                scene_anims:[{name:'walk',t_start:0,t_end:1000000000,anim:null,node_anims:[{node:7,anim:3}]}]};
              const parentBody={nodes:[0,1].map(i=>({idx:i,name:'instance'+i,components:[i,null,null,null,null],instance:0})),
                transforms:[trs(0),trs(100)],instances:[{name:child,anim:'walk',loop_mode:hg.ALM_Loop}]};
              host.assets.scenes.set(child,childBody);host.assets.scenes.set(parent,parentBody);
              try {
                hg.LoadSceneFromAssets(parent,fresh,resources,hg.GetForwardPipelineInfo());fresh.Update(500000000n);
                const roots=[fresh.GetNode('instance0'),fresh.GetNode('instance1')];
                const refs=roots.map(n=>n.GetInstanceSceneAnim('walk'));
                if(refs[0].equals(refs[1])||fresh.GetSceneAnims().length||fresh.GetPlayingAnimRefs().length!==2)throw Error('Instance clip scope');
                roots.forEach((n,i)=>{
                  const moving=n.GetInstanceSceneView().GetNode(fresh,'moving');
                  if(Math.abs(hg.GetT(moving.GetTransform().GetWorld()).x-(5+i*100))>1e-5)throw Error('Instance track remapping');
                });
                fresh.DestroyNode(roots[0]);if(fresh.GetPlayingAnimRefs().length!==1)throw Error('Instance player cleanup');fresh.Clear();
                parentBody.instances.push({name:parent});parentBody.nodes[1].instance=1;
                let rolledBack=false;try{hg.LoadSceneFromAssets(parent,fresh,resources,hg.GetForwardPipelineInfo());}
                catch(e){rolledBack=e.code==='INVALID_SCENE';}
                if(!rolledBack||fresh.GetPlayingAnimRefs().length||Object.values(fresh.stats).some(n=>n!==0))throw Error('Animated instance rollback');
              } finally {fresh.Clear();host.assets.scenes.delete(child);host.assets.scenes.delete(parent);}
              return ['native node lists exclude instance children','three instance scene views','cyclic instances reject and roll back',
                'two animated instances have independent bindings','instance autoplay and destruction','animated load rollback'];
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
            assert page.evaluate('engineScene.metrics.warnings.length') == 2
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
    assert manifest['animationPlayback'] == 'scene-trs/1'
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
