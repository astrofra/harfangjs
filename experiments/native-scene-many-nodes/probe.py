"""Stage exact native tutorial sources and inspect today's Web API (not a port).

Run with the repository's Playwright-enabled development Python. Generated files
stay in build/experiments/native-scene-many-nodes; neither runtime is modified.
"""
import argparse
from functools import partial
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT.parent / 'harfang3d'
OUTPUT = ROOT / 'build/experiments/native-scene-many-nodes'
FILES = ('scene_many_nodes.js', 'js/window.js')


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def revision(root):
    return subprocess.check_output(
        ['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True).strip()


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, help='Installed Chrome/Edge/Chromium')
    parser.add_argument('--native', type=Path, help='Optional hgjs executable for a non-rendering value probe')
    args = parser.parse_args()
    report = {'kind': 'feasibility-probe', 'rendersTutorial': False,
              'revisions': {'harfang3d': revision(NATIVE), 'harfangjs': revision(ROOT)},
              'sources': {}, 'scope': 'Export presence, selected semantics and allocation limit only'}
    symbols = set()
    for name in FILES:
        source = NATIVE / 'tutorials' / name
        target = OUTPUT / 'source' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        assert source.read_bytes() == target.read_bytes()
        report['sources'][name] = {'sha256': sha256(source), 'byteIdentical': True}
        symbols.update(re.findall(r'\bhg\.([A-Za-z_$][\w$]*)', source.read_text(encoding='utf-8')))

    from playwright.sync_api import sync_playwright
    candidates = [args.browser,
                  Path(os.environ.get('PROGRAMFILES', 'C:/Program Files')) / 'Google/Chrome/Application/chrome.exe',
                  Path(os.environ.get('PROGRAMFILES(X86)', 'C:/Program Files (x86)')) / 'Microsoft/Edge/Application/msedge.exe']
    candidates += [Path(found) for name in ('chromium', 'chromium-browser', 'google-chrome')
                   if (found := shutil.which(name))]
    executable = next((str(path.resolve()) for path in candidates if path and path.is_file()), None)
    if args.browser and not args.browser.is_file():
        parser.error(f'Browser does not exist: {args.browser}')
    httpd = ThreadingHTTPServer(('127.0.0.1', 0), partial(Handler, directory=str(ROOT)))
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=executable, headless=True)
            try:
                page = browser.new_page()
                page.route('**/__probe__', lambda route: route.fulfill(
                    content_type='text/html', body='<!doctype html><script type="importmap">'
                    '{"imports":{"harfang":"/src/index.js"}}</script>'))
                page.goto(f'http://127.0.0.1:{httpd.server_port}/__probe__')
                report['browserVersion'] = browser.version
                report['web'] = page.evaluate('''async symbols => {
                  const hg = await import('/src/index.js');
                  const exports = Object.fromEntries(symbols.map(name => [name, typeof hg[name]]));
                  const scene = new hg.Scene();
                  const sceneMethods = Object.fromEntries(['Update','Clear','dispose','SetCurrentCamera']
                    .map(name => [name, typeof scene[name]]));
                  const transform = scene.CreateTransform(new hg.Vec3(1,2,3));
                  const position = transform.GetPos(); position.y = 99;
                  const getterCopies = transform.GetPos().y === 2;
                  transform.SetPos(position); position.y = 100;
                  const setterCopies = transform.GetPos().y === 99;
                  let allocationError;
                  try { for (let i=0; i<10204; ++i) scene.CreateNode(); }
                  catch (error) { allocationError = {code:error.code, message:error.message}; }
                  const allocatedNodes = Number(scene.GetNodeCount());
                  scene.dispose();
                  let importError;
                  try { await import('/build/experiments/native-scene-many-nodes/source/scene_many_nodes.js'); }
                  catch (error) { importError = String(error); }
                  return {exports, sceneMethods, getterCopies, setterCopies, allocatedNodes, allocationError,
                    exactSourceImportError:importError ?? null,
                    vec4ThreeArguments:[new hg.Vec4(.25,.5,.75).w, new hg.Vec4(1,0,0).w],
                    profile:{id:hg.profile.id, maxNodes:hg.profile.limits.maxNodes,
                      shadowMaps:hg.profile.limits.shadowMaps},
                    missingExports:symbols.filter(name => exports[name] === 'undefined')};
                }''', sorted(symbols))
            finally:
                browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)

    if args.native:
        native_probe = OUTPUT / 'native-value-probe.js'
        native_probe.write_text("""import * as hg from 'harfang';
export function main() {
  const scene = new hg.Scene(), node = scene.CreateNode();
  scene.Clear();
  const invalidated = !node.IsValid();
  const reusable = scene.CreateNode().IsValid();
  print('PROBE ' + JSON.stringify({
    vec4ThreeArguments:[new hg.Vec4(.25,.5,.75).w, new hg.Vec4(1,0,0).w],
    clearInvalidatesNodesBeforeReuse:invalidated, clearPreservesScene:reusable,
    resetFlags:{RF_VSync:hg.RF_VSync,RF_MSAA4X:hg.RF_MSAA4X}
  }));
  scene.Clear();
}
""", encoding='utf-8')
        executable = args.native.resolve()
        result = subprocess.run([str(executable), str(native_probe)], capture_output=True,
                                text=True, timeout=30, check=True)
        (OUTPUT / 'native-value-probe.log').write_text(result.stdout + result.stderr, encoding='utf-8')
        report['native'] = json.loads(next(line[6:] for line in result.stdout.splitlines()
                                          if line.startswith('PROBE ')))
        report['native']['executableSHA256'] = sha256(executable)

    target = OUTPUT / 'baseline-probe.json'
    target.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Exact source copies: {len(FILES)}; missing Web exports: {len(report["web"]["missingExports"])}')
    print(f'Node allocation stopped at {report["web"]["allocatedNodes"]}; tutorial needs 10204')
    print(f'Report: {target}')
    print('Probe completed; this does not claim tutorial execution or rendering parity.')


if __name__ == '__main__':
    main()
