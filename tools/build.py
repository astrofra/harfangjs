"""Compile assets with assetc-web and package a self-contained browser demo."""
import argparse
import subprocess
import sys
from demos import ROOT, DEMOS
from build_compiler import build_compiler

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', choices=[*DEMOS, 'all'], default='many-nodes')
    parser.add_argument('--skip-compiler-build', action='store_true')
    args = parser.parse_args()
    if not args.skip_compiler_build:
        build_compiler()
    for name in (DEMOS if args.demo == 'all' else [args.demo]):
        subprocess.run([sys.executable, str(ROOT / 'experiments' / DEMOS[name] / 'build.py'),
                        '--skip-compiler-build'], check=True)
