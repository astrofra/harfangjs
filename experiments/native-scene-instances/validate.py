"""Validate the unchanged tutorial, actor animation, S/D lifecycle and WebGL cleanup."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
from build import build, ROOT, NATIVE, WORK, DIST
from asset_validation import read_asset


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def validate():
    reports = WORK / 'reports'
    reports.mkdir(parents=True, exist_ok=True)
    assert (DIST / 'scene_instances.js').read_bytes() == (NATIVE / 'tutorials/scene_instances.js').read_bytes()
    manifest = json.loads((DIST / 'resources_compiled/manifest.json').read_text())
    for entry in manifest['assets'].values():
        read_asset(DIST / 'resources_compiled' / entry['uri'], entry)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(DIST)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    candidates = [Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
                  Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe']
    executable = next((str(p) for p in candidates if p.is_file()), None)
    report = {'entryByteIdentical': True, 'assets': len(manifest['assets']), 'checks': []}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=executable, headless=True)
            page = browser.new_page(viewport={'width': 960, 'height': 720})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
            page.add_init_script('WebAssembly.instantiate=()=>{throw Error("Unexpected WASM")};WebAssembly.instantiateStreaming=WebAssembly.instantiate;')
            origin = f'http://127.0.0.1:{server.server_port}'
            page.goto(origin + '/?test&frames=100000')
            page.wait_for_function("instancesScene.state==='failed'||instancesScene.host?.frames>=4", timeout=120000)
            assert page.evaluate('instancesScene.state') == 'running', errors
            page.locator('#pause').click()
            initial = page.evaluate('instancesScene.metrics')
            report['initial'] = initial
            assert initial['scene']['nodes'] == 3778, initial
            assert initial['instances'] == 1637, initial
            report['checks'] += page.evaluate('''async()=>{
              const hg=await import('harfang'),host=instancesScene.host,scene=host.currentScene;
              const check=(ok,message)=>{if(!ok)throw Error(message);};
              const nodes=scene.GetNodes(),roots=[];
              for(let i=0;i<nodes.length;i++){const n=nodes.get(i);if(n.GetInstance().IsValid())roots.push(n);}
              check(roots.length===20&&scene.GetPlayingAnimRefs().length===20,'Twenty independent actors');
              const playing=scene.GetPlayingAnimNames();
              check(new Set(Array.from({length:playing.length},(_,i)=>playing.get(i))).size===3,'Idle, walk and run coexist');
              check(!scene.GetSceneAnims().length,'Instance animations remain private');
              const a=roots[0],b=roots[1],ra=a.GetInstanceSceneAnim('walk'),rb=b.GetInstanceSceneAnim('walk');
              check(!ra.equals(rb)&&hg.GetSceneAnimInfo(scene,ra).valid,'Instance clip remapping');
              check(a.GetInstanceSceneView().GetNodes().length===187,'Complete instance view');
              const child=a.GetInstanceSceneView().GetNode(scene,'Bip001');
              scene.StopAllAnims();const p=scene.PlayAnim(ra,hg.ALM_Loop);
              scene.Update(0n);const first=[...child.GetTransform().GetWorld().data];
              const untouched=[...b.GetInstanceSceneView().GetNode(scene,'Bip001').GetTransform().GetWorld().data];
              scene.Update(500000000n);
              check(first.some((v,i)=>Math.abs(v-child.GetTransform().GetWorld().data[i])>1e-5),'Authored walk changes pose');
              check(untouched.every((v,i)=>v===b.GetInstanceSceneView().GetNode(scene,'Bip001').GetTransform().GetWorld().data[i]),'Other actor pose unchanged');
              scene.Update(3500000000n);
              check(first.every((v,i)=>Math.abs(v-child.GetTransform().GetWorld().data[i])<1e-5)&&scene.IsPlaying(p),'Walk wraps four-second loop');
              a.DestroyInstance();check(!child.IsValid()&&!scene.IsPlaying(p)&&!hg.GetSceneAnimInfo(scene,ra).valid,'DestroyInstance invalidates nodes and clips');
              check(a.IsValid()&&a.GetInstance().IsValid()&&a.GetInstanceSceneView().GetNodes().length===0,'DestroyInstance keeps root/component');
              a.DestroyInstance();scene.DestroyNode(a);check(scene.GarbageCollect()>0n,'Collect orphan components');
              check(hg.GetSceneAnimInfo(scene,rb).valid,'Neighbour clip survives destruction');
              const shared=scene.CreateTransform(),n1=scene.CreateNode(),n2=scene.CreateNode();n1.SetTransform(shared);n2.SetTransform(shared);
              scene.DestroyNode(n1);scene.GarbageCollect();check(shared.IsValid(),'Shared component retained');
              scene.DestroyNode(n2);scene.GarbageCollect();check(!shared.IsValid(),'Unreferenced shared component collected');
              const orphan=b.GetInstanceSceneView().GetNode(scene,'Bip001');
              scene.DestroyNode(b);check(orphan.IsValid(),'DestroyNode defers instance child cleanup');
              scene.GarbageCollect();check(!orphan.IsValid(),'Garbage collection removes orphan instance content');
              return ['20 actors, 187 child nodes each','independent instance clip bindings','authored walk motion and exact loop',
                'DestroyInstance invalidates content, clips and players','idempotent instance teardown','garbage collection preserves shared components',
                'DestroyNode defers child cleanup until garbage collection'];
            }''')
            # Reload the unchanged tutorial after destructive contract checks.
            page.reload()
            page.wait_for_function('instancesScene.host?.frames>=4', timeout=120000)
            original = page.evaluate('instancesScene.metrics.scene')
            page.evaluate('window.initialPlayers=instancesScene.host.currentScene.GetPlayingAnimRefs()')
            page.wait_for_function('instancesScene.host.frames>=370', timeout=60000)
            assert page.evaluate('''()=>{
              const scene=instancesScene.host.currentScene;
              return scene.GetPlayingAnimRefs().length===20&&Array.from({length:initialPlayers.length},(_,i)=>
                !scene.IsPlaying(initialPlayers.get(i))).every(Boolean);
            }''')
            report['checks'].append('idle/walk/run coexist and all actors switch state after six seconds')

            def key(code, actors):
                page.locator('canvas').focus()
                page.keyboard.down(code)
                page.wait_for_function('(n)=>instancesScene.host.currentScene.GetPlayingAnimRefs().length===n', arg=actors)
                page.keyboard.up(code)
                frame = page.evaluate('instancesScene.host.frames')
                page.wait_for_function('(f)=>instancesScene.host.frames>f+1', arg=frame)

            key('s', 21)
            assert page.evaluate('instancesScene.metrics.scene.nodes') == original['nodes'] + 188
            key('d', 20)
            assert page.evaluate('instancesScene.metrics.scene') == original
            for actors in range(19, -1, -1):
                key('d', actors)
            empty = page.evaluate('instancesScene.metrics.scene')
            assert empty == {'nodes': 18, 'transforms': 18, 'objects': 17, 'cameras': 0, 'lights': 1}, empty
            key('d', 0)
            key('s', 1)
            key('d', 0)
            assert page.evaluate('instancesScene.metrics.scene') == empty
            report['checks'] += ['S/D adds/removes exactly 188 nodes', 'remove all actors and spawn again', 'component counts return to baseline']
            page.locator('#restart').click()
            page.wait_for_function('instancesScene.host?.frames>=4&&instancesScene.host.currentScene?.GetPlayingAnimRefs().length===20', timeout=120000)
            page.locator('#pause').click()
            frame = page.evaluate('instancesScene.host.frames')
            page.wait_for_timeout(100)
            assert page.evaluate('instancesScene.host.frames') == frame
            page.set_viewport_size({'width': 800, 'height': 600})
            page.locator('#pause').click()
            page.wait_for_function('instancesScene.metrics.viewport[0]===800')
            page.screenshot(path=str(reports / 'web-instances.png'))
            report['checks'] += ['restart restores 20 actors', 'pause/resume', 'explicit camera resizes']
            page.evaluate('instancesScene.host.stop()')
            page.wait_for_function("instancesScene.state==='stopped'")
            final = page.evaluate('instancesScene.finalResources')
            for key in ['gpuBytes', 'meshes', 'instanceBuffers', 'textures', 'programs', 'shadowMaps']:
                assert final[key] == 0, final
            report['finalResources'] = final
            report['checks'].append('GPU resources released on stop')
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
    report['status'] = 'pass'
    (reports / 'validation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true')
    args = parser.parse_args()
    if not args.skip_build:
        build()
    validate()
