"""Build W1 native/web assets from a common generated source tree."""
import argparse
import json
import re
from pathlib import Path
import subprocess
import sys

from assetc_web import ROOT, compile_assets
from generate_fixture import generate


def build_assets(harfang=None, bridge=None, assetc=None):
    harfang = (harfang or ROOT.parent / 'harfang3d').resolve()
    bridge = (bridge or ROOT / 'build/native/Release/harfang_web_asset_bridge.exe').resolve()
    assetc = (assetc or ROOT.parent / 'install/assetc/assetc.exe').resolve()
    default_bridge = ROOT / 'build/native/Release/harfang_web_asset_bridge.exe'
    if not bridge.is_file() or (bridge == default_bridge and any(p.stat().st_mtime > bridge.stat().st_mtime for p in (ROOT / 'tools/native').glob('*'))):
        subprocess.run([sys.executable, str(ROOT / 'tools/build_native.py')], check=True)
    source = ROOT / 'build/fixtures/source'
    resources = harfang / 'tutorials/resources'
    generate(source, bridge, resources)
    native = ROOT / 'build/assets-native'; native.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([str(assetc), '-api', 'GL', str(source), str(native)], capture_output=True, text=True)
    (ROOT / 'build/native-assetc.log').write_text(result.stdout + result.stderr, encoding='utf-8')
    if result.returncode or re.search(r'\b[1-9][0-9]* failed\b|FAILED:', result.stdout + result.stderr):
        raise RuntimeError(f'Native assetc failed: see {ROOT / "build/native-assetc.log"}')
    # Keep binary source input distinct, preserving the original room JSON.
    binary = ROOT / 'build/fixtures/binary-input/scenes/room-binary.scn'; binary.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([str(bridge), 'scene-binary', str(source / 'scenes/room.scn'), str(binary)], capture_output=True, check=True)
    references = []
    for name, scene in [('room', source / 'scenes/room.scn'), ('room-compiled', native / 'scenes/room.scn'),
                        ('pbr', resources / 'materials/materials.scn')]:
        reference = ROOT / f'build/fixtures/{name}-native.json'
        subprocess.run([str(bridge), 'scene-state', str(scene), str(reference)], capture_output=True, check=True)
        references.append((f'references/{name}-native.json', reference))
    output = ROOT / 'build/assets-web'
    manifest = compile_assets([source, binary.parents[1], resources], output, bridge,
        ['scenes/room.scn', 'scenes/room-binary.scn'], images=['pictures/owl.jpg'],
        structure_scenes=['materials/materials.scn'], references=references)
    report = dict(nativeSource=str(source), nativeOutput=str(native), webOutput=str(output),
                  assets=len(manifest['assets']), bytes=sum(v['byteLength'] for v in manifest['assets'].values()),
                  scenes=manifest['reports'], nativeJavaScript='pending-slice-N')
    (ROOT / 'build/asset-validation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(f'Compiled W1 assets: {report["assets"]} entries, {report["bytes"]} bytes; native + web.')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harfang', type=Path)
    parser.add_argument('--bridge', type=Path)
    parser.add_argument('--assetc', type=Path)
    args = parser.parse_args()
    build_assets(args.harfang, args.bridge, args.assetc)
