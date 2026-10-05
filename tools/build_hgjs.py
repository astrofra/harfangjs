"""Build the official HARFANG HGJS target in its own CMake tree."""
import argparse
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def build(quickjs_source, zig=None, native_build=None):
    native_build = (native_build or ROOT.parent / 'build/hgjs').resolve()
    options = dict(HG_BUILD_HG_JS='ON', HG_SCENE_PHYSICS_BACKEND='none',
                   HG_ENABLE_RECAST_DETOUR_API='OFF', HG_ENABLE_XMP_AUDIO='OFF', HG_BUILD_ASSETC='OFF',
                   HG_BUILD_ASSIMP_CONVERTER='OFF', HG_BUILD_FBX_CONVERTER='OFF', HG_BUILD_GLTF_EXPORTER='OFF',
                   HG_BUILD_GLTF_IMPORTER='OFF', HG_BUILD_LEGACY_ARCHIVE='OFF',
                   HG_QUICKJS_SOURCE_DIR=str(quickjs_source.resolve()))
    if zig:
        options['HG_QUICKJS_ZIG'] = str(zig.resolve())
    subprocess.run(['cmake', '-S', str(ROOT.parent / 'harfang3d'), '-B', str(native_build)] +
                   [f'-D{k}={v}' for k, v in options.items()], check=True)
    subprocess.run(['cmake', '--build', str(native_build), '--config', 'Release', '--target', 'HarfangJs', '--parallel', '4'], check=True)
    return native_build

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--quickjs-source', type=Path, required=True)
    parser.add_argument('--zig', type=Path, help='Zig 0.14.1 executable; required for MSVC')
    parser.add_argument('--build-dir', type=Path)
    args = parser.parse_args()
    build(args.quickjs_source, args.zig, args.build_dir)
