"""Create a dependency-free HTTP package and audit its JavaScript/module boundary."""
import hashlib
import argparse
import json
from pathlib import Path
import re
import shutil
from build_assets import build_assets

ROOT = Path(__file__).resolve().parents[1]
INCLUDES = ('src', 'examples/tutorials', 'tests', 'contract')


def audit(root):
    files = []
    for folder in (*INCLUDES, 'assets-web'):
        for path in sorted((root / folder).rglob('*')):
            if not path.is_file():
                continue
            data = path.read_bytes()
            if path.suffix.lower() == '.wasm' or data.startswith(b'\x00asm'):
                raise ValueError(f'Forbidden Wasm payload: {path}')
            if path.suffix == '.js':
                text = data.decode('utf-8')
                if re.search(r'\bWebAssembly\b|\batob\s*\(|\beval\s*\(|new\s+Function\s*\(', text):
                    raise ValueError(f'Forbidden embedded-code path: {path}')
                imports = re.findall(r'''(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']''', text)
                for specifier in imports:
                    if specifier in ('harfang', 'harfang/browser'):
                        continue
                    if not specifier.startswith('.'):
                        raise ValueError(f'Unsupported dependency {specifier} in {path}')
                    target = (path.parent / specifier).resolve()
                    if not target.is_relative_to(root.resolve()) or not target.is_file():
                        raise ValueError(f'Unresolved package import {specifier} in {path}')
            files.append(dict(path=path.relative_to(root).as_posix(), bytes=len(data), sha256=hashlib.sha256(data).hexdigest()))
    return files


def build(assets=None):
    assets = Path(assets).resolve() if assets else build_assets()
    if not (assets / 'manifest.json').is_file():
        raise ValueError(f'Missing compiled manifest: {assets}')
    audit(ROOT)
    target = (ROOT / 'dist/web').resolve()
    # The deletion target is a fixed generated directory, checked before removal.
    if target != ROOT.resolve() / 'dist/web' or not target.is_relative_to(ROOT.resolve()):
        raise ValueError(f'Unsafe build directory: {target}')
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for folder in INCLUDES:
        shutil.copytree(ROOT / folder, target / folder)
    shutil.copytree(assets, target / 'assets-web')
    shutil.copy2(ROOT / 'LICENSE', target / 'LICENSE')
    (target / 'index.html').write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=examples/tutorials/"><a href="examples/tutorials/">HARFANG JS tutorials</a>\n', encoding='utf-8')
    report = dict(api='harfang-js/1', profile='web-forward/1', nativeJS='pending-slice-N',
                  runtimeDependencies=[], wasmPayloads=0, files=audit(target))
    (target / 'release.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Built {target}: {len(report["files"])} audited files, no runtime dependencies.')
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--assets', type=Path, help='Package an existing assetc-web output instead of rebuilding native/web fixtures')
    build(parser.parse_args().assets)
