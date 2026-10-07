"""Build the native program compiler and package the unchanged Many Nodes entry."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

EXPERIMENT = Path(__file__).resolve().parent
ROOT = EXPERIMENT.parents[1]
NATIVE = ROOT.parent / 'harfang3d'
WORK = ROOT / 'build/experiments/native-scene-many-nodes'
DIST = ROOT / 'dist/experiments/native-scene-many-nodes'
sys.path.append(str(ROOT / 'tools'))
from package_assets import package_assets
from build_compiler import build_compiler, compiler_path
from package_runtime import package_runtime


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(skip_compiler=False):
    compiler = compiler_path() if skip_compiler else build_compiler()
    inputs = WORK / 'asset-input'
    hashes = json.loads((ROOT / 'tools/native/adapters/source-hashes.json').read_text())
    for name in hashes:
        target = inputs / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(NATIVE / 'tutorials/resources' / name, target)
    assets = WORK / 'resources_compiled'
    subprocess.run([str(compiler), str(inputs), str(assets)], check=True)
    DIST.mkdir(parents=True, exist_ok=True)
    package_runtime(ROOT / 'src', DIST / 'src')
    package_assets(assets, DIST / 'resources_compiled')
    (DIST / 'js').mkdir(exist_ok=True)
    shutil.copyfile(NATIVE / 'tutorials/scene_many_nodes.js', DIST / 'scene_many_nodes.js')
    shutil.copyfile(EXPERIMENT / 'window.js', DIST / 'js/window.js')
    for name in ['index.html', 'main.js']:
        shutil.copyfile(EXPERIMENT / name, DIST / name)
    shutil.copyfile(ROOT / 'LICENSE', DIST / 'LICENSE')
    source = NATIVE / 'tutorials/scene_many_nodes.js'
    assert source.read_bytes() == (DIST / source.name).read_bytes()
    report = {'sourceSHA256': digest(source), 'entryByteIdentical': True, 'windowHelper': 'browser-adapter',
              'compilerSHA256': digest(compiler), 'sourceAssets': {name: digest(inputs / name) for name in hashes},
              'profile': 'web-native-forward/1', 'runtime': 'JavaScript/WebGL2', 'wasm': False,
              'files': {p.relative_to(DIST).as_posix(): digest(p) for p in sorted(DIST.rglob('*'))
                        if p.is_file() and p.name != 'release.json'}}
    (DIST / 'release.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Packaged unchanged native entry: {DIST}')
    return DIST


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-compiler-build', action='store_true')
    args = parser.parse_args()
    build(args.skip_compiler_build)
