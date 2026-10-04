"""Run conformance, real input/resize and network audit in an installed Chromium browser."""
import argparse
import base64
import json
import os
from pathlib import Path
import shutil
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
    args = parser.parse_args()
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        raise SystemExit('Install test tooling: python -m pip install -r requirements-dev.txt') from error
    directory = ROOT if args.source else build()
    audit(directory)
    destination = ROOT / 'build/reports'
    destination.mkdir(parents=True, exist_ok=True)
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
            report['browserVersion'] = browser.version
            report['renderBackend'] = 'Chromium WebGL2 / ANGLE SwiftShader (software validation)'
            report['network'] = sorted(set(requests))
            assert all(url.startswith(origin) and '.wasm' not in url.lower() for url in requests)
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
