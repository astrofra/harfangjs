"""Validate the full experiment, native/Web API contract, assets and browser lifecycle."""
import argparse
import base64
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import shutil
import statistics
import struct
import subprocess
import sys
import tempfile
import threading
import zlib

from build import build, digest, ROOT, NATIVE, WORK, DIST, EXPERIMENT

REPORTS = WORK / 'reports'


def browser_path(explicit):
    if explicit:
        return explicit
    candidates = [Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
                  Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe']
    return next((str(p) for p in candidates if p.is_file()), None)


def compiler_checks():
    compiler = ROOT / 'build/assetc-web' / ('Release/assetc-web.exe' if sys.platform == 'win32' else 'assetc-web')
    checks = []
    with tempfile.TemporaryDirectory(prefix='hg-web-program-') as tmp:
        source = Path(tmp) / 'source with spaces é'; output = Path(tmp) / 'compiled é'
        shutil.copytree(WORK / 'asset-input', source)

        def run(*args, ok=True):
            result = subprocess.run([str(compiler), *map(str, args)], capture_output=True, text=True, encoding='utf-8', errors='replace')
            assert (result.returncode == 0) == ok, result.stdout + result.stderr
            return result

        run(source, output, '-j', '2', '-q')
        manifest = json.loads((output / 'manifest.json').read_text())
        asset = manifest['assets']['core/shader/default.hps']; payload = output / asset['uri']
        assert asset['sha256'] == digest(payload) and asset['byteLength'] == payload.stat().st_size
        program = json.loads(payload.read_text())
        assert program['sourceHashes'] == {p.relative_to(source).as_posix(): digest(p) for p in source.rglob('*') if p.is_file()}
        checks += ['spaces/unicode paths', 'SHA256 and size verified independently', 'source dependency provenance']
        before = (output / 'manifest.json').read_bytes()
        run('-v', source, output); assert before == (output / 'manifest.json').read_bytes()
        checks.append('deterministic repeat build')
        shader = source / 'core/shader/default_fs.sc'; original = shader.read_bytes()
        shader.write_bytes(original + b'\n// unreviewed change\n')
        run(source, output, ok=False); assert before == (output / 'manifest.json').read_bytes()
        shader.write_bytes(original); checks.append('changed shader rejected, previous manifest preserved')
        extra = source / 'unsupported.png'; extra.write_bytes(b'unsupported')
        run(source, output, ok=False); extra.unlink(); checks.append('unsupported content rejected')
        shader.unlink(); run(source, output, ok=False); shader.write_bytes(original)
        checks.append('missing dependency rejected')
        for args in [(source, source), (source, source / 'compiled'), (source, Path(tmp)), ('-api', 'GL', source, output)]:
            run(*args, ok=False)
        if sys.platform == 'win32':
            run(source, str(source).upper(), ok=False)
        checks.append('overlapping paths and unsupported CLI options rejected')
        unrelated = Path(tmp) / 'unmarked'; unrelated.mkdir(); (unrelated / 'keep.txt').write_text('keep')
        run(source, unrelated, ok=False); assert (unrelated / 'keep.txt').read_text() == 'keep'
        checks.append('unmarked output protected')
        compiled = payload.read_bytes(); payload.write_bytes(b'corrupt')
        run(source, output, ok=False); assert before == (output / 'manifest.json').read_bytes()
        payload.write_bytes(compiled); checks.append('corrupt cached object rejected')
        run(source); assert Path(str(source) + '_compiled/manifest.json').is_file()
        checks.append('default output directory')
    return checks


def tga_to_png(source, target):
    data = source.read_bytes(); id_length, color_map, kind = data[:3]
    width, height, bits, flags = struct.unpack_from('<HHBB', data, 12)
    assert kind == 2 and color_map == 0 and bits in (24, 32), 'Expected uncompressed bgfx RGB(A) capture'
    size = bits // 8; pixels = data[18 + id_length:]; rows = []
    for y in range(height):
        row = y if flags & 32 else height - y - 1
        rgb = bytearray()
        for x in range(width):
            offset = (row * width + x) * size; b, g, r = pixels[offset:offset + 3]; rgb.extend((r, g, b))
        rows.append(b'\0' + rgb)
    def chunk(name, body):
        return struct.pack('>I', len(body)) + name + body + struct.pack('>I', zlib.crc32(name + body))
    target.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)) +
                       chunk(b'IDAT', zlib.compress(b''.join(rows))) + chunk(b'IEND', b''))


NATIVE_WINDOW = """import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
export async function runWindow(title,create,options={}) {
  hg.AddAssetsFolder('../assets-native'); hg.InputInit(); hg.WindowSystemInit();
  const window=hg.NewWindow(title,960,625,32,hg.WV_Hidden);let app,initialized=false;
  try {
    initialized=hg.RenderInit(window,hg.RT_OpenGL);if(!initialized)throw Error('Native renderer failed');
    hg.RenderReset(960,625,0);app=create();
    for(let i=0;i<(options.frameLimit??8);++i) {
      await nextFrame(window);app.draw(16666667n,960,625);
      if(i===3)hg.RequestScreenShot(hg.InvalidFrameBufferHandle,'../reports/native-many-nodes');
      hg.Frame();
    }
  } finally {
    try {app?.dispose();}finally {
      if(initialized)hg.RenderShutdown();hg.DestroyWindow(window);hg.WindowSystemShutdown();hg.InputShutdown();
    }
  }
}
"""


def native_reference(executable, assetc):
    native_assets = WORK / 'assets-native'
    result = subprocess.run([str(assetc), '-api', 'GL', str(WORK / 'asset-input'), str(native_assets)],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=120)
    (REPORTS / 'native-assetc.log').write_text(result.stdout + result.stderr, encoding='utf-8'); result.check_returncode()
    assert not re.search(r'[1-9][0-9]* task\(s\) failed', result.stdout + result.stderr)
    directory = WORK / 'native-reference'; (directory / 'js').mkdir(parents=True, exist_ok=True)
    shutil.copyfile(NATIVE / 'tutorials/scene_many_nodes.js', directory / 'scene_many_nodes.js')
    shutil.copyfile(EXPERIMENT / 'contract.js', directory / 'contract.js')
    (directory / 'js/window.js').write_text(NATIVE_WINDOW, encoding='utf-8')
    capture = REPORTS / 'native-many-nodes.tga'
    capture.unlink(missing_ok=True)
    contract = None
    for entry in ['scene_many_nodes.js', 'contract.js']:
        result = subprocess.run([str(executable), entry], cwd=directory, capture_output=True, text=True,
                                encoding='utf-8', errors='replace', timeout=120)
        (REPORTS / f'native-{entry}.log').write_text(result.stdout + result.stderr, encoding='utf-8')
        result.check_returncode()
        if entry == 'contract.js':
            match = re.search(r'MANY_NODES_CONTRACT (\{[^\r\n]*\})', result.stdout)
            assert match, result.stdout + result.stderr
            contract = json.loads(match[1])
    assert capture.is_file(), 'Native capture was not produced'
    tga_to_png(capture, REPORTS / 'native-many-nodes.png')
    return {'executableSHA256': digest(executable), 'assetcSHA256': digest(assetc), 'contract': contract,
            'renderer': 'native HG JS / bgfx OpenGL', 'captureFrame': 4, 'dtNs': '16666667', 'antialias': False}


def compare_contract(a, b, path='contract'):
    if isinstance(a, dict):
        assert a.keys() == b.keys(), path
        for key in a:
            compare_contract(a[key], b[key], path + '.' + key)
    elif isinstance(a, list):
        assert len(a) == len(b), path
        for i, (x, y) in enumerate(zip(a, b)):
            compare_contract(x, y, f'{path}[{i}]')
    elif isinstance(a, (float, int)) and not isinstance(a, bool):
        assert abs(a - b) <= 1e-5, (path, a, b)
    else:
        assert a == b, (path, a, b)


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--browser')
    parser.add_argument('--software', action='store_true', help='SwiftShader smoke test; visual parity requires hardware GPU')
    parser.add_argument('--native', type=Path, help='Also compare native HG JS APIs and capture')
    parser.add_argument('--native-assetc', type=Path, default=ROOT.parent / 'install/assetc/assetc.exe')
    args = parser.parse_args()
    if not args.skip_build:
        build()
    REPORTS.mkdir(parents=True, exist_ok=True)
    report = {'compiler': compiler_checks(), 'entryByteIdentical': (NATIVE / 'tutorials/scene_many_nodes.js').read_bytes() == (DIST / 'scene_many_nodes.js').read_bytes()}
    assert report['entryByteIdentical']
    if args.native:
        report['native'] = native_reference(args.native.resolve(), args.native_assetc.resolve())
    release = json.loads((DIST / 'release.json').read_text())
    for name, expected in release['files'].items():
        assert digest(DIST / name) == expected, name
        assert Path(name).suffix not in ('.wasm', '.exe', '.dll', '.py', '.sc', '.sh', '.hps'), name
    from playwright.sync_api import sync_playwright
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(DIST)))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{httpd.server_port}'
    try:
        with sync_playwright() as playwright:
            launch_args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] if args.software else []
            browser = playwright.chromium.launch(executable_path=browser_path(args.browser), headless=True, args=launch_args)
            context = browser.new_context(viewport={'width': 960, 'height': 720}, device_scale_factor=1)
            page = context.new_page(); errors = []; requests = []
            page.set_default_timeout(60000)
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.on('request', lambda request: requests.append(request.url))
            page.add_init_script("Object.defineProperty(globalThis,'WebAssembly',{get(){throw Error('Forbidden Wasm access');}})")
            frames = 8 if args.software else 60
            page.goto(f'{origin}/?test&frames={frames}')
            page.wait_for_function("['stopped','failed'].includes(window.manyNodes?.state)")
            assert page.evaluate('window.manyNodes.state') == 'stopped', page.evaluate('window.manyNodes.error')
            history = page.evaluate('window.manyNodes.history'); last = history[-1]
            assert last['scene'] == {'nodes': 10204, 'transforms': 10204, 'cameras': 1, 'objects': 10202, 'lights': 1}
            assert [last[k] for k in ['instances', 'drawCalls', 'shadowDrawCalls', 'shadowResolution']] == [10202, 2, 2, 4096]
            assert last['triangles'] == last['shadowTriangles'] == 2937900
            assert len(last['warnings']) == 1 and 'MSAA' in last['warnings'][0]
            assert last['presentation']['effectiveSize'] == [960, 625] and not last['presentation']['antialias']
            for key in ['gpuBytes', 'programs', 'meshes', 'instanceBuffers', 'shadowMaps']:
                assert page.evaluate(f'window.manyNodes.finalResources.{key}') == 0, key
            samples = page.evaluate('window.manyNodes.samples')
            for i, j, sample in [(0, 0, samples[0]), (50, 50, samples[1]), (100, 100, samples[2])]:
                angle = frames * 16666667 / 1e9
                y = .1 * (math.cos(angle + (j + 1) * .1) * math.sin(angle + (i + 1) * .1) * 6 + 6.5)
                assert max(abs(x - y) for x, y in zip(sample, [(-100 + j * 2) * .1, y, (-100 + i * 2) * .1])) < 1e-5
            capture = page.evaluate('window.manyNodes.captures[4]')
            (REPORTS / ('software-browser.png' if args.software else 'hardware-browser.png')).write_bytes(base64.b64decode(capture.split(',')[1]))
            timings = [frame['drawMs'] for frame in history[4:]]
            report['browser'] = {'version': browser.version, 'software': args.software, 'frames': frames, 'lastFrame': last,
                                 'drawMsMedian': statistics.median(timings), 'drawMsP95': sorted(timings)[math.ceil(.95 * len(timings)) - 1],
                                 'samples': samples, 'cleanup': page.evaluate('window.manyNodes.finalResources'),
                                 'gpu': page.evaluate("(() => {const gl=window.manyNodes.host.renderer.gl,e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()")}
            if args.native:
                native = 'data:image/png;base64,' + base64.b64encode((REPORTS / 'native-many-nodes.png').read_bytes()).decode()
                comparison = page.evaluate('''async ([a,b])=>{
                  async function pixels(src){const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;
                    const g=c.getContext('2d');g.drawImage(i,0,0);return g.getImageData(0,0,c.width,c.height).data;}
                  const x=await pixels(a),y=await pixels(b);if(x.length!==y.length)throw Error('Capture size differs');let sum=0,over=0;
                  for(let i=0;i<x.length;i+=4){let peak=0;for(let j=0;j<3;j++){const d=Math.abs(x[i+j]-y[i+j]);sum+=d;peak=Math.max(peak,d);}if(peak>16)over++;}
                  return {meanAbsoluteChannelError:sum/(x.length*.75),fractionPixelsOver16:over/(x.length/4)};
                }''', [native, capture])
                report['native']['imageComparison'] = comparison
                report['native']['imageTolerance'] = {'meanAbsoluteChannelError': 2, 'fractionPixelsOver16': .03}
                if not args.software:
                    assert comparison['meanAbsoluteChannelError'] < 2 and comparison['fractionPixelsOver16'] < .03, comparison
            page.route('**/contract.js', lambda route: route.fulfill(path=EXPERIMENT / 'contract.js', content_type='text/javascript'))
            contract = page.evaluate('''async()=>{
              const {createNativeBrowserApplication}=await import('harfang/browser'),{main}=await import('./contract.js');
              const host=await createNativeBrowserApplication({canvas:document.querySelector('canvas'),manifestURL:'./resources_compiled/manifest.json',fixedDeltaNs:16666667n});
              await host.run(main);return JSON.parse(JSON.stringify(globalThis.manyNodesContract,(_,value)=>typeof value==='bigint'?{bigint:String(value)}:value));
            }''')
            report['contract'] = contract
            if args.native:
                compare_contract(report['native']['contract'], contract)
            assert contract['submissions'] == [[10, True, 8, 9, 65535, 65535], [10, True, 8, 9, 65535, 65535], [9, True, 7, 8, 65535, 65535]]
            assert not errors, errors
            startup = page.evaluate('''async()=>{
              const {createNativeBrowserApplication}=await import('harfang/browser'),{main}=await import('./scene_many_nodes.js');
              const host=await createNativeBrowserApplication({canvas:document.querySelector('canvas'),manifestURL:'./resources_compiled/manifest.json'});
              host.assets.programs.get('core/shader/default.hps').depth.fragment='invalid shader';
              try {await host.run(main);throw Error('Expected shader failure');}catch(e){return {error:String(e),code:e.code,state:host.state,stats:host.finalResources};}
            }''')
            assert startup['state'] == 'failed' and startup['code'] == 'SHADER_FAILED', startup
            assert all(startup['stats'][k] == 0 for k in ['gpuBytes', 'programs', 'meshes', 'instanceBuffers', 'shadowMaps'])
            # Browser lifecycle, material copy/batching, partial startup and context loss.
            page.goto(origin)
            page.wait_for_function('window.manyNodes?.host?.frames>=4')
            independent = page.evaluate('''async()=>{const hg=await import('harfang'),host=window.manyNodes.host;host.pause();
              const nodes=host.currentScene.GetNodes(),a=nodes.get(3).GetObject().GetMaterial(0),b=nodes.get(4).GetObject().GetMaterial(0);
              hg.SetMaterialValue(a,'uDiffuseColor',new hg.Vec4(0,1,0));
              return a!==b&&hg.GetMaterialValue(b,'uDiffuseColor').x===1&&hg.GetMaterialValue(a,'uDiffuseColor').x===0;}''')
            assert independent
            budget = page.evaluate('''()=>{try{window.manyNodes.host.renderer.ensureShadow({resolution:16384,sixteenBit:true});return 'unexpected success';}catch(e){return e.code;}}''')
            assert budget in ('RESOURCE_BUDGET', 'SHADOW_LIMIT'), budget
            page.evaluate('window.manyNodes.host.resume()'); page.wait_for_function('window.manyNodes.metrics.drawCalls===3')
            page.set_viewport_size({'width': 800, 'height': 600})
            page.wait_for_function('window.manyNodes.metrics.viewport[0]===800&&window.manyNodes.metrics.viewport[1]===505')
            page.locator('#pause').click(); paused = page.evaluate('window.manyNodes.host.frames')
            page.wait_for_timeout(150); assert page.evaluate('window.manyNodes.host.frames') == paused
            page.locator('#pause').click(); page.wait_for_function(f'window.manyNodes.host.frames>{paused}')
            for _ in range(3):
                page.locator('#restart').click(); page.wait_for_function('window.manyNodes?.host?.frames>=3')
            page.locator('canvas').focus(); page.keyboard.press('Escape'); page.wait_for_function("window.manyNodes.state==='stopped'")
            assert page.evaluate('window.manyNodes.finalResources.gpuBytes') == 0
            page.locator('#restart').click(); page.wait_for_function('window.manyNodes?.host?.frames>=3')
            await_stop = page.evaluate('async()=>{const host=window.manyNodes.host;host.pause();await host.stop();return host.finalResources.gpuBytes;}')
            assert await_stop == 0
            assert not errors, errors
            report['integration'] = ['partial shader startup failure cleanup', 'independent material copies and rebatching', 'GPU/device shadow limit rejection', 'resize', 'pause/resume', 'restart x3', 'Escape/cleanup', 'stop while paused']
            # Reject a broken compiler payload before creating any GPU resources.
            page.route('**/*.program.json', lambda route: route.fulfill(body='{}', content_type='application/json'))
            page.goto(origin); page.wait_for_function("window.manyNodes?.state==='failed'")
            assert 'Corrupt program' in page.evaluate('window.manyNodes.error')
            assert not page.evaluate('Boolean(window.manyNodes.host)')
            page.unroute('**/*.program.json'); errors.clear()
            report['integration'].append('corrupt asset fails before application creation')
            page.goto(origin); page.wait_for_function('window.manyNodes?.host?.frames>=3')
            page.evaluate("window.manyNodes.host.renderer.gl.getExtension('WEBGL_lose_context').loseContext()")
            page.wait_for_function("window.manyNodes?.state==='failed'")
            assert page.evaluate('window.manyNodes.host.finalResources.gpuBytes') == 0
            assert 'context lost' in page.evaluate('window.manyNodes.error').lower()
            assert all('context lost' in e.lower() for e in errors), errors
            report['integration'].append('context loss stops and releases resources')
            assert all(url.startswith(origin + '/') for url in requests), requests
            assert not any(re.search(r'\.(wasm|sc|sh|hps|exe|py)(\?|$)', url) for url in requests)
            report['network'] = {'localRequestsOnly': True, 'wasmForbidden': True, 'compiledProgramsOnly': True}
            browser.close()
    finally:
        httpd.shutdown(); httpd.server_close()
    report['status'] = 'pass'
    target = REPORTS / ('validation-software.json' if args.software else 'validation.json')
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'PASS: {target}\nDraw median {report["browser"]["drawMsMedian"]:.2f} ms; {len(report["compiler"])} compiler checks; {len(report["integration"])} lifecycle checks')


if __name__ == '__main__':
    main()
