"""Compile the original PBR scene and package the shared native/Web JS entry."""
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
WORK = ROOT / 'build/experiments/native-scene-pbr'
DIST = ROOT / 'dist/experiments/native-scene-pbr'
sys.path.append(str(EXPERIMENT.parent))
from package_assets import package_assets


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def scene_sources(names, path):
    if path in names:
        return
    names.add(path)
    scene = json.loads((NATIVE / 'tutorials/resources' / path).read_text())
    for instance in scene.get('instances', []):
        scene_sources(names, instance['name'])
    for obj in scene.get('objects', []):
        names.add(obj['name'])
        for material in obj['materials']:
            for texture in material.get('textures', []):
                if texture.get('path'):
                    names.add(texture['path'])
    env = scene.get('environment', {})
    for maps in [env, env.get('probe', {})]:
        for key in ['brdf_map', 'irradiance_map', 'radiance_map']:
            value = maps.get(key)
            if value:
                for suffix in ['.irradiance', '.radiance']:
                    value = value.removesuffix(suffix)
                names.add(value)


def build(skip_compiler=False, max_texture_size=0):
    compiler_build = ROOT / 'build/assetc-web'
    if not skip_compiler:
        args = ['cmake', '-S', str(ROOT / 'tools/native'), '-B', str(compiler_build),
                '-DHG_WEB_BUILD_BRIDGE=OFF', f'-DHARFANG_SOURCE={NATIVE.as_posix()}']
        if sys.platform == 'win32':
            args += ['-A', 'x64']
        subprocess.run(args, check=True)
        subprocess.run(['cmake', '--build', str(compiler_build), '--config', 'Release', '--target', 'assetc-web'], check=True)
    compiler = compiler_build / ('Release/assetc-web.exe' if sys.platform == 'win32' else 'assetc-web')
    names = set()
    for manifest in ['source-hashes.json', 'scene-source-hashes.json']:
        names.update(json.loads((ROOT / 'tools/native/adapters' / manifest).read_text()))
    scene_sources(names, 'materials/materials.scn')
    for name in list(names):
        if (NATIVE / 'tutorials/resources' / (name + '.meta')).exists():
            names.add(name + '.meta')
    inputs = WORK / 'asset-input'
    for name in sorted(names):
        target = inputs / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(NATIVE / 'tutorials/resources' / name, target)
    assets = WORK / 'resources_compiled'
    stamp = {'compiler': digest(compiler), 'maxTextureSize': max_texture_size,
             'sources': {name: digest(inputs / name) for name in sorted(names)}}
    stamp_file = WORK / 'compile-stamp.json'
    if not stamp_file.exists() or json.loads(stamp_file.read_text()) != stamp or not (assets / 'manifest.json').exists():
        options = ['--max-texture-size', str(max_texture_size)] if max_texture_size else []
        subprocess.run([str(compiler), *options, str(inputs), str(assets)], check=True)
        stamp_file.write_text(json.dumps(stamp, indent=2) + '\n', encoding='utf-8')
    DIST.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'src', DIST / 'src', dirs_exist_ok=True)
    package_assets(assets, DIST / 'resources_compiled')
    (DIST / 'js').mkdir(exist_ok=True)
    source = NATIVE / 'tutorials/scene_pbr.js'
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
    print(f'Web release ready (upload this directory\'s contents): {DIST}')
    return DIST


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-compiler-build', action='store_true')
    parser.add_argument('--max-texture-size', type=int, default=0)
    args = parser.parse_args()
    build(args.skip_compiler_build, args.max_texture_size)
