"""Run conformance, real input/resize and network audit in an installed Chromium browser."""
import argparse
import base64
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import threading

from build import ROOT, audit, build
from serve import server


def browser_path(explicit):
    if explicit:
        return str(Path(explicit).resolve())
    candidates = [
        Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
        Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe',
    ]
    for name in ['chromium', 'chromium-browser', 'google-chrome']:
        found = shutil.which(name)
        if found:
            return found
    return next((str(p) for p in candidates if p.is_file()), None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', help='Path to Chrome, Edge or Chromium executable')
    parser.add_argument('--source', action='store_true', help='Test source instead of building/testing dist')
    parser.add_argument('--assets', type=Path, help='Use existing compiled web assets for the package')
    parser.add_argument('--native-render', action='store_true', help='Also compare room, material gallery, fog and PBR through hidden native OpenGL')
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise SystemExit('Install test tooling: python -m pip install -r requirements-dev.txt') from error
    directory = ROOT if args.source else build(args.assets)
    compiler_tests = subprocess.run([sys.executable, str(ROOT / 'tools/test_assets.py')], capture_output=True, text=True)
    print(compiler_tests.stdout + compiler_tests.stderr)
    if compiler_tests.returncode:
        raise SystemExit(compiler_tests.returncode)
    audit(directory)
    destination = ROOT / 'build/reports'
    destination.mkdir(parents=True, exist_ok=True)
    if args.native_render:
        capture = subprocess.run([str(ROOT / 'build/native/Release/harfang_web_asset_bridge.exe'), 'capture-room',
                                  str(ROOT / 'build/assets-native'), str(destination / 'native-room')], capture_output=True, text=True)
        (destination / 'native-render.log').write_text(capture.stdout + capture.stderr, encoding='utf-8')
        capture.check_returncode()
        capture = subprocess.run([str(ROOT / 'build/native/Release/harfang_web_asset_bridge.exe'), 'capture-lighting',
                                  str(ROOT / 'build/assets-native'), str(destination / 'native-w2')], capture_output=True, text=True)
        (destination / 'native-lighting-render.log').write_text(capture.stdout + capture.stderr, encoding='utf-8')
        capture.check_returncode()
    httpd = server(directory, 0)
    worker = threading.Thread(target=httpd.serve_forever, daemon=True)
    worker.start()
    origin = f'http://127.0.0.1:{httpd.server_port}'
    report = {}
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=browser_path(args.browser), headless=True,
                args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
            context = browser.new_context(viewport={'width': 1200, 'height': 900}, device_scale_factor=1)
            errors, requests = [], []
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append(request.url))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.add_init_script("Object.defineProperty(globalThis, 'WebAssembly', {get() { throw new Error('Forbidden Wasm access'); }});")
            page.goto(f'{origin}/tests/')
            page.wait_for_function('window.testResults !== undefined', timeout=30000)
            report = page.evaluate('window.testResults')
            compiler_count = int(re.search(r'Ran (\d+) tests',compiler_tests.stdout + compiler_tests.stderr).group(1))
            report['offlineCompiler'] = {'status':'pass','cases':compiler_count}
            if args.native_render:
                comparisons = {}
                for camera, case in [('Perspective','scene_static_room'), ('Orthographic','scene_static_room.orthographic'),
                                     ('lighting','material_lighting'),('lighting-fog','material_lighting.fog'),('pbr-ambient','scene_pbr.materials')]:
                    prefix = 'native-room' if camera in ('Perspective','Orthographic') else 'native-w2'
                    native_png = base64.b64encode((destination / f'{prefix}-{camera}.png').read_bytes()).decode()
                    comparisons[camera] = page.evaluate('''async ({native, caseId}) => {
                      async function pixels(src) {
                        const img = new Image(); img.src = src; await img.decode();
                        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
                        const ctx = c.getContext('2d'); ctx.drawImage(img,0,0); return ctx.getImageData(0,0,c.width,c.height).data;
                      }
                      const a = await pixels(native), b = await pixels(window.tutorialCaptures[caseId]);
                      if (a.length !== b.length) throw new Error('Native/browser capture dimensions differ');
                      let sum = 0, different = 0;
                      for (let i=0; i<a.length; i+=4) {
                        let peak = 0;
                        for (let j=0; j<3; ++j) { const delta = Math.abs(a[i+j]-b[i+j]); sum += delta; peak = Math.max(peak,delta); }
                        if (peak > 16) ++different;
                      }
                      return {meanAbsoluteChannelError:sum/(a.length*.75), fractionPixelsOver16:different/(a.length/4)};
                    }''', {'native':'data:image/png;base64,' + native_png, 'caseId':case})
                    print(f'Native comparison {camera}: {comparisons[camera]}')
                report['nativeRoomRendering'] = {'status':'pass', 'backend':'Native C++ HARFANG / bgfx OpenGL',
                    'comparisons':{k:v for k,v in comparisons.items() if k in ('Perspective','Orthographic')},
                    'tolerance':{'meanAbsoluteChannelError':2,'fractionPixelsOver16':.03}, 'nativeJS':'pending-slice-N'}
                report['nativeLightingRendering'] = {'status':'pass','backend':'Native C++ HARFANG / bgfx OpenGL',
                    'comparisons':{k:v for k,v in comparisons.items() if k not in ('Perspective','Orthographic')},
                    'tolerance':{'meanAbsoluteChannelError':2,'fractionPixelsOver16':.03},'nativeJS':'pending-slice-N',
                    'adaptations':['No shadows or environment probes.','PBR tutorial RAW base-level bilinear sampling matches the W2 web profile.','Native PBR descriptor exposes its existing alpha-cut shader branch.']}
                assert all(v['meanAbsoluteChannelError'] < 2 and v['fractionPixelsOver16'] < .03 for v in comparisons.values()), comparisons
            report['lightingMetrics'] = page.evaluate('window.lightingMetrics')
            report['lightingStartup'] = page.evaluate('window.lightingStartup')
            for name, data in page.evaluate('window.tutorialCaptures ?? {}').items():
                (destination / f'{name}.png').write_bytes(base64.b64decode(data.split(',', 1)[1]))
            for result in report['results']:
                print(f'{result["status"].upper()}: {result["name"]}')
                if result['status'] == 'fail': print(result['error'])
            page.goto(f'{origin}/examples/tutorials/?case=draw_lines')
            page.wait_for_function('window.harfangDemo?.application.stats.steps > 3')
            page.locator('canvas').click(position={'x': 100, 'y': 100})
            page.keyboard.down('a')
            page.wait_for_function("window.harfangDemo.application.stats.input.keys.includes('KeyA')")
            page.locator('#pause').focus()
            page.wait_for_function("!window.harfangDemo.application.stats.input.keys.includes('KeyA')")
            page.keyboard.up('a')
            page.locator('canvas').click(position={'x': 140, 'y': 80})
            page.mouse.down()
            page.wait_for_function('window.harfangDemo.application.stats.input.buttons.includes(0)')
            page.mouse.up()
            page.wait_for_function('!window.harfangDemo.application.stats.input.buttons.includes(0)')
            page.set_viewport_size({'width': 980, 'height': 700})
            page.wait_for_function('window.harfangDemo.runner.context.canvas.height === 455')
            page.locator('#pause').click()
            assert page.evaluate('window.harfangDemo.runner.state') == 'suspended'
            page.locator('#pause').click()
            page.wait_for_function("window.harfangDemo.runner.state === 'running'")
            for _ in range(3):
                page.locator('#restart').click()
                page.wait_for_function('window.harfangDemo.application.stats.steps > 1')
            page.locator('canvas').focus()
            page.keyboard.press('Escape')
            page.wait_for_function("window.harfangDemo.runner.state === 'stopped'")
            stats = page.evaluate('({resources: window.harfangDemo.runner.context.assets.stats, renderer: window.harfangDemo.runner.context.renderer.stats, disposed: window.harfangDemo.application.stats.disposed})')
            assert stats['disposed'] and stats['renderer']['programs'] == 0 and stats['resources']['handles'] == 0
            report['browserIntegration'] = {'status': 'pass', 'checks': ['keyboard', 'focus reset', 'mouse', 'resize', 'pause/resume', 'restart x3', 'Escape/cleanup']}
            page.goto(f'{origin}/examples/tutorials/?case=scene_static_room')
            page.wait_for_function('window.harfangDemo?.application.stats.steps > 1')
            page.locator('canvas').focus(); page.keyboard.press('Space')
            page.wait_for_function("window.harfangDemo.application.stats.camera === 'Orthographic'")
            page.set_viewport_size({'width':1100,'height':800})
            page.wait_for_function('window.harfangDemo.runner.context.canvas.height === 520')
            for _ in range(3):
                page.locator('#restart').click(); page.wait_for_function('window.harfangDemo.application.stats.steps > 1')
            await_stop = page.evaluate('async () => { await window.harfangDemo.runner.stop(); return window.harfangDemo.runner.context.assets.stats; }')
            assert all(count == 0 for count in await_stop.values())
            assert page.evaluate('window.harfangDemo.runner.context.renderer.stats.gpuStaticBytes') == 0
            report['browserIntegration']['checks'] += ['room camera switch', 'room resize', 'room restart x3', 'room CPU/GPU cleanup']
            page.goto(f'{origin}/examples/tutorials/?case=material_lighting')
            page.wait_for_function('window.harfangDemo?.application.stats.steps > 1')
            page.locator('canvas').focus(); page.keyboard.press('Space')
            page.wait_for_function('window.harfangDemo.runner.context.renderer.stats.activeLights === 1')
            for key, flag in [('f','fog'),('n','normalDisabled'),('r','rough')]:
                page.keyboard.press(key); page.wait_for_function(f'window.harfangDemo.application.stats.{flag} === true')
            for _ in range(3):
                page.locator('#restart').click(); page.wait_for_function('window.harfangDemo.application.stats.steps > 1')
            before = page.evaluate('window.harfangDemo.runner.context.renderer.stats')
            assert before['forwardPrograms'] == 2 and before['activeLights'] == 4
            await_stop = page.evaluate('async () => { await window.harfangDemo.runner.stop(); return window.harfangDemo.runner.context.assets.stats; }')
            assert all(count == 0 for count in await_stop.values())
            after = page.evaluate('window.harfangDemo.runner.context.renderer.stats')
            assert after['gpuStaticBytes'] == 0 and after['forwardPrograms'] == 0
            report['browserIntegration']['checks'] += ['W2 light rig', 'W2 fog/normal/roughness controls', 'W2 restart x3', 'W2 CPU/GPU/program cleanup']
            report['browserVersion'] = browser.version
            report['renderBackend'] = 'Chromium WebGL2 / ANGLE SwiftShader (software validation)'
            report['network'] = sorted(set(requests))
            assert all(url.startswith(origin) and '.wasm' not in url.lower() for url in requests)
            assert not any('/resources/' in url or '/fixtures/source/' in url or '/assets-native/' in url for url in requests)
            report['compiledAssetBoundary'] = 'pass: runtime assets requested only from assets-web'
            report['wasmAudit'] = {'staticPackage': 'pass', 'runtimeAccessTrap': 'pass', 'localNetworkOnly': True}
            report['pageErrors'] = errors
            browser.close()
    finally:
        httpd.shutdown(); httpd.server_close()
        (destination / 'validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Report: {destination / "validation.json"}')
    if report.get('failed', 1) or report.get('pageErrors'):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
