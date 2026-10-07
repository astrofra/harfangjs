"""Validate the supported Web packages, native compiler and browser lifecycle."""
import argparse
import subprocess
import sys
from demos import ROOT, DEMOS
from package_runtime import audit_runtime

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--demo', choices=[*DEMOS, 'all'], default='all')
    parser.add_argument('--skip-build', action='store_true')
    args = parser.parse_args()
    print(f'Runtime import audit: {len(audit_runtime())} modules', flush=True)
    subprocess.run([sys.executable, str(ROOT / 'tools/validate_animation.py')], check=True)
    if not args.skip_build:
        subprocess.run([sys.executable, str(ROOT / 'tools/build.py'), '--demo', args.demo], check=True)
    if args.demo in ('all', 'many-nodes'):
        subprocess.run([sys.executable, str(ROOT / 'tools/validate_compression.py')], check=True)
    for name in (DEMOS if args.demo == 'all' else [args.demo]):
        subprocess.run([sys.executable, str(ROOT / 'experiments' / DEMOS[name] / 'validate.py'),
                        '--skip-build'], check=True)
