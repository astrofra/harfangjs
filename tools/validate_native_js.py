"""Execute the same math/scene contract in HGJS/C++ and Chromium/pure JS."""
import argparse
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import threading
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'harfang3d/languages/hg_quickjs'))
from prepare_tutorials import stage_tutorials, TUTORIALS
from test_launcher import check_launcher

from serve import ROOT, server
from validate import browser_path

def compare(native, web, path='result'):
    if isinstance(native, dict) and isinstance(web, dict):
        assert native.keys() == web.keys(), f'{path}: different keys'
        for key in native:
            compare(native[key], web[key], f'{path}.{key}')
    elif isinstance(native, list) and isinstance(web, list):
        assert len(native) == len(web), f'{path}: different lengths'
        for i, (a, b) in enumerate(zip(native, web)):
            compare(a, b, f'{path}[{i}]')
    elif type(native) in (int, float) and type(web) in (int, float):
        assert math.isclose(native, web, rel_tol=1e-6, abs_tol=1e-6), f'{path}: {native} != {web}'
    else:
        assert native == web, f'{path}: {native!r} != {web!r}'

def compile_native_assets(assetc, source, output, log, api=None):
    output.mkdir(parents=True, exist_ok=True)
    command = [str(assetc.resolve())] + (['-api', api] if api else [])
    result = subprocess.run([*command, str(source), str(output)], capture_output=True, text=True, timeout=120)
    log.write_text(result.stdout + result.stderr)
    result.check_returncode()
    assert not re.search(r'\b[1-9][0-9]* failed\b|FAILED:', result.stdout + result.stderr), f'assetc compilation failed: {log}'

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--hgjs', type=Path, default=ROOT.parent / 'build/hgjs/languages/hg_quickjs/Release/hgjs.exe')
    parser.add_argument('--assetc', type=Path, default=ROOT.parent / 'install/assetc/assetc.exe')
    parser.add_argument('--browser')
    parser.add_argument('--native-render', action='store_true', help='Render the existing native room and lighting assets through HGJS')
    args = parser.parse_args()
    check_launcher(args.hgjs)
    source, compiled = ROOT / 'build/hgjs/source', ROOT / 'build/hgjs/resources_compiled'
    runtime_dir = source.parent
    source.mkdir(parents=True, exist_ok=True)
    if args.native_render:
        # Compile scene fixtures for the native default too; existing GL
        # binaries are only valid with an explicitly selected GL renderer.
        shutil.copytree(ROOT / 'build/fixtures/source', source, dirs_exist_ok=True)
    shutil.copytree(ROOT / 'tests/shared', source / 'shared', dirs_exist_ok=True)
    shutil.copytree(ROOT / 'native/examples', source / 'viewer', dirs_exist_ok=True)
    for name in ['main.js', 'lifetime.js', 'render.js']:
        shutil.copy2(ROOT / 'native/tests' / name, source / name)
    (source / 'rejected.js').write_text("export const completion = Promise.reject(new Error('HGJS_EXPECTED_REJECTION'));\n")
    (source / 'missing.js').write_text("import './does-not-exist.js';\n")
    (source / 'syntax.js').write_text("export const = ;\n")
    (source / 'unhandled.js').write_text("Promise.reject(Error('HGJS_UNHANDLED_REJECTION'));\n")
    (source / 'stalled.js').write_text("export const completion = new Promise(() => {});\n")
    (source / 'recursive.js').write_text("function recurse() { return recurse() + 1; } recurse();\n")
    (source / 'move.lua').write_text("function OnUpdate(node, dt) local p = node:GetTransform():GetPos(); p.x = p.x + hg.time_to_sec_f(dt); node:GetTransform():SetPos(p); end\n")
    stage_tutorials(source)
    (source / 'tutorials-test.js').write_text("import * as hg from 'harfang';\n" + '\n'.join(
        f"import {{main as run{i}}} from './{name}.js';" for i, name in enumerate(TUTORIALS)) +
        "\nexport async function main() {\nconst renderer = scriptArgs.includes('--opengl') ? hg.RT_OpenGL : undefined;\n" + '\n'.join(
        f"await run{i}({{hidden: true, frameLimit: 6, renderer, capturePath: 'hgjs-tutorial-{name}'}}); console.log('TUTORIAL_OK {name}');"
        for i, name in enumerate(TUTORIALS)) + '''
    for (const name of ['draw_lines', 'draw_model_no_pipeline']) {
        const picture = new hg.Picture(), path = `hgjs-tutorial-${name}`;
        if (!hg.LoadPicture(picture, path + '.tga') || !hg.SavePNG(picture, path + '.png')) throw Error('Missing tutorial capture: ' + name);
    }
}\n''')
    report_dir = ROOT / 'build/reports'; report_dir.mkdir(parents=True, exist_ok=True)
    compile_native_assets(args.assetc, source, compiled, report_dir / 'hgjs-assetc.log')
    gl_dir = runtime_dir / 'opengl'
    stage_tutorials(gl_dir / 'source')
    compile_native_assets(args.assetc, gl_dir / 'source', gl_dir / 'resources_compiled', report_dir / 'hgjs-assetc-gl.log', 'GL')
    results = []
    for round in range(3):
        run = subprocess.run([str(args.hgjs.resolve()), str(source / 'main.js')], cwd=runtime_dir, capture_output=True, text=True, timeout=60)
        (report_dir / f'hgjs-{round}.log').write_text(run.stdout + run.stderr)
        run.check_returncode()
        line = next(line for line in run.stdout.splitlines() if line.startswith('HGJS_CONTRACT '))
        results.append(json.loads(line.removeprefix('HGJS_CONTRACT ')))
    for entry, expected in [('rejected.js', 'HGJS_EXPECTED_REJECTION'), ('missing.js', 'does-not-exist.js'), ('syntax.js', 'SyntaxError'),
                            ('unhandled.js', 'HGJS_UNHANDLED_REJECTION'), ('stalled.js', 'stalled'),
                            ('recursive.js', 'stack overflow')]:
        run = subprocess.run([str(args.hgjs.resolve()), str(source / entry)], cwd=runtime_dir, capture_output=True, text=True, timeout=15)
        assert run.returncode == 1 and expected in run.stderr, (entry, run.returncode, run.stdout, run.stderr)
    run = subprocess.run([str(args.hgjs.resolve()), str(source / 'lifetime.js')], cwd=runtime_dir, capture_output=True, text=True, timeout=30)
    (report_dir / 'hgjs-lifetime.log').write_text(run.stdout + run.stderr)
    run.check_returncode()
    assert 'HGJS_LIFETIME_OK' in run.stdout
    for profile, directory, options in [('native-default', runtime_dir, []), ('opengl', gl_dir, ['--opengl'])]:
        for name in TUTORIALS:
            for extension in ['png', 'tga']:
                (directory / f'hgjs-tutorial-{name}.{extension}').unlink(missing_ok=True)
        run = subprocess.run([str(args.hgjs.resolve()), str(source / 'tutorials-test.js'), *options], cwd=directory, capture_output=True, text=True, timeout=60)
        (report_dir / f'hgjs-tutorials-{profile}.log').write_text(run.stdout + run.stderr)
        run.check_returncode()
        for name in TUTORIALS:
            assert f'TUTORIAL_OK {name}' in run.stdout, (profile, name)
        assert 'Texture dimensions: 512x512' in run.stdout
        for name in ['draw_lines', 'draw_model_no_pipeline']:
            capture = directory / f'hgjs-tutorial-{name}.png'
            assert capture.stat().st_size > 1000, (profile, name)
            shutil.copy2(capture, report_dir / f'hgjs-tutorial-{name}-{profile}.png')
    if args.native_render:
        for name in ['room', 'lighting', 'pbr-ambient']:
            for extension in ['tga', 'png']:
                (runtime_dir / f'hgjs-{name}.{extension}').unlink(missing_ok=True)
        run = subprocess.run([str(args.hgjs.resolve()), str(source / 'render.js')], cwd=runtime_dir, capture_output=True, text=True, timeout=60)
        (report_dir / 'hgjs-render.log').write_text(run.stdout + run.stderr)
        run.check_returncode()
        assert 'HGJS_RENDER_OK' in run.stdout
        for name in ['room', 'lighting', 'pbr-ambient']:
            assert (runtime_dir / f'hgjs-{name}.png').stat().st_size > 1000, f'Missing {name} capture'
            shutil.copy2(runtime_dir / f'hgjs-{name}.png', report_dir)
    from playwright.sync_api import sync_playwright
    httpd = server(ROOT, 0)
    worker = threading.Thread(target=httpd.serve_forever, daemon=True); worker.start()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=browser_path(args.browser), headless=True)
            page = browser.new_page()
            page.goto(f'http://127.0.0.1:{httpd.server_port}/tests/native-web.html')
            page.wait_for_function('window.nativeWebResult || window.nativeWebError', timeout=15000)
            error = page.evaluate('window.nativeWebError')
            assert not error, error
            web = page.evaluate('window.nativeWebResult')
            browser.close()
    finally:
        httpd.shutdown(); httpd.server_close()
    for native in results:
        compare(native, web)
    report = dict(status='pass', fileLauncher='pass', nativeRuns=3, luaSceneVMsPerRun=4, contractGroups=len(web['contract']),
                  native=results[0], web=web, negativeCases=6, windowCases=2, nativeTutorials=list(TUTORIALS),
                  tutorialRendererProfiles=['native-default', 'opengl'],
                  nativeRenderedScenes=3 if args.native_render else 0,
                  scope='Generated native HG API: math, BigInt time, scene values; engine Lua compatibility and three native tutorial ports. Full portable W1/W2 facade remains pending.')
    (report_dir / 'native-js-conformance.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f"HGJS/Web parity passed: {report['contractGroups']} groups, 3 native runs, 6 negative cases, Lua coexistence, 3 tutorials on native-default and OpenGL")

if __name__ == '__main__':
    main()
