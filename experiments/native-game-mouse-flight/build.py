"""Compile native scene sources and package the unchanged Mouse Flight entry."""
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
WORK = ROOT / 'build/experiments/native-game-mouse-flight'
DIST = ROOT / 'dist/experiments/native-game-mouse-flight'
sys.path.append(str(ROOT / 'tools'))
from package_assets import package_assets
from build_compiler import build_compiler, compiler_path
from package_runtime import package_runtime


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(skip_compiler=False):
    compiler = compiler_path() if skip_compiler else build_compiler()
    names = set()
    for manifest in ['source-hashes.json', 'scene-source-hashes.json']:
        names.update(json.loads((ROOT / 'tools/native/adapters' / manifest).read_text()))
    names.update(['playground/playground.scn', 'paper_plane/paper_plane.scn',
                  'playground/Plane.geo', 'playground/Cube.001.geo', 'paper_plane/Shape.geo',
                  'playground/grid_baseColor.png', 'playground/grid_baseColor.png.meta',
                  'core/pbr/brdf.dds', 'core/pbr/probe.hdr', 'core/pbr/probe.hdr.meta'])
    inputs = WORK / 'asset-input'
    for name in sorted(names):
        target = inputs / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(NATIVE / 'tutorials/resources' / name, target)
    assets = WORK / 'resources_compiled'
    stamp = {'compiler': digest(compiler), 'sources': {name: digest(inputs / name) for name in sorted(names)}}
    stamp_file = WORK / 'compile-stamp.json'
    if not stamp_file.exists() or json.loads(stamp_file.read_text()) != stamp or not (assets / 'manifest.json').exists():
        subprocess.run([str(compiler), str(inputs), str(assets)], check=True)
        stamp_file.write_text(json.dumps(stamp, indent=2) + '\n', encoding='utf-8')
    DIST.mkdir(parents=True, exist_ok=True)
    package_runtime(ROOT / 'src', DIST / 'src')
    package_assets(assets, DIST / 'resources_compiled')
    (DIST / 'js').mkdir(exist_ok=True)
    source = NATIVE / 'tutorials/game_mouse_flight.js'
    shutil.copyfile(source, DIST / source.name)
    shutil.copyfile(EXPERIMENT / 'window.js', DIST / 'js/window.js')
    for name in ['index.html', 'main.js']:
        shutil.copyfile(EXPERIMENT / name, DIST / name)
    shutil.copyfile(ROOT / 'LICENSE', DIST / 'LICENSE')
    assert source.read_bytes() == (DIST / source.name).read_bytes()
    report = {'sourceSHA256': digest(source), 'entryByteIdentical': True, 'windowHelper': 'browser-adapter',
              'compilerSHA256': digest(compiler), 'sourceAssets': stamp['sources'],
              'profile': 'web-native-scene/1', 'runtime': 'JavaScript/WebGL2', 'wasm': False,
              'files': {p.relative_to(DIST).as_posix(): digest(p) for p in sorted(DIST.rglob('*'))
                        if p.is_file() and p.name != 'release.json'}}
    (DIST / 'release.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Packaged unchanged native entry: {DIST}')
    return DIST


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-compiler-build', action='store_true')
    build(parser.parse_args().skip_compiler_build)
