"""Build the standalone assetc-web executable for the current desktop platform."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build/assetc-web'


def compiler_path(build_dir=BUILD):
    build_dir = Path(build_dir).resolve()
    name = 'assetc-web.exe' if sys.platform == 'win32' else 'assetc-web'
    candidates = [build_dir / 'Release' / name, build_dir / name]
    return next((p for p in candidates if p.is_file()), candidates[0 if sys.platform == 'win32' else 1])


def build_compiler(harfang=ROOT.parent / 'harfang3d', build_dir=BUILD):
    build_dir = Path(build_dir).resolve()
    args = ['cmake', '-S', str(ROOT / 'tools/native'), '-B', str(build_dir),
            f'-DHARFANG_SOURCE={Path(harfang).resolve().as_posix()}']
    if sys.platform != 'win32':
        args.append('-DCMAKE_BUILD_TYPE=Release')
    subprocess.run(args, check=True)
    subprocess.run(['cmake', '--build', str(build_dir), '--config', 'Release',
                    '--target', 'assetc-web'], check=True)
    compiler = compiler_path(build_dir)
    if not compiler.is_file():
        raise FileNotFoundError(f'Compiler build produced no executable: {compiler}')
    return compiler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harfang', type=Path, default=ROOT.parent / 'harfang3d')
    parser.add_argument('--build-dir', type=Path, default=BUILD)
    args = parser.parse_args()
    print(build_compiler(args.harfang, args.build_dir))
