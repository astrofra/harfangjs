"""Install the official HGJS launcher and package already compiled runtime assets."""
import argparse
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-dir', type=Path, default=ROOT.parent / 'build/hgjs')
    parser.add_argument('--resources', type=Path, default=ROOT / 'build/hgjs/resources_compiled')
    parser.add_argument('--scripts', type=Path, default=ROOT / 'build/hgjs/source')
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/native')
    args = parser.parse_args()
    resources, scripts, output = args.resources.resolve(), args.scripts.resolve(), args.output.resolve()
    if not resources.is_dir() or not any(scripts.glob('*.js')):
        parser.error('Missing JavaScript entries or compiled resources; run validate_native_js.py first')
    for source in [resources, scripts]:
        if output == source or output.is_relative_to(source) or source.is_relative_to(output):
            parser.error('Package, scripts and compiled resources must be separate directories')
    subprocess.run(['cmake', '--install', str(args.build_dir.resolve()), '--config', 'Release', '--component', 'quickjs', '--prefix', str(output)], check=True)
    shutil.copytree(resources, output / 'hgjs/resources_compiled', dirs_exist_ok=True)
    for source in scripts.rglob('*.js'):
        destination = output / 'hgjs' / source.relative_to(scripts)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    (output / 'hgjs/run.cmd').write_text('''@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 exit /b %errorlevel%
if "%~1"=="" (
  "%~dp0hgjs.exe" main.js
) else (
  "%~dp0hgjs.exe" %*
)
set "EXITCODE=%ERRORLEVEL%"
popd
exit /b %EXITCODE%
''', encoding='utf-8')
    print(output / 'hgjs')

if __name__ == '__main__':
    main()
