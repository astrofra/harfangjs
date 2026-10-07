"""Run deterministic browser animation contract checks without a renderer."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from playwright.sync_api import sync_playwright
from demos import ROOT


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    candidates = [Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
                  Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe']
    executable = next((str(p) for p in candidates if p.is_file()), None)
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True);thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=executable, headless=True)
            page = browser.new_page();page.goto(f'http://127.0.0.1:{server.server_port}/')
            checks = page.evaluate('async()=>(await import("/tools/tests/scene-animation.js")).run()')
            browser.close()
    finally:
        server.shutdown();server.server_close();thread.join(timeout=5)
    report = ROOT / 'build/reports/animation.json';report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({'status': 'pass', 'checks': checks}, indent=2) + '\n')
    print(f'Animation contracts passed: {checks}')


if __name__ == '__main__':
    main()
