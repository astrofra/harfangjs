"""Record actual native HARFANG math outputs; never substitute JS-generated values."""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--module-dir', type=Path, required=True)
parser.add_argument('--dll-dir', type=Path)
parser.add_argument('--native-build', required=True, help='Build identifier printed by the native module')
parser.add_argument('--source', type=Path, default=ROOT.parent / 'harfang3d')
args = parser.parse_args()
dll_handle = os.add_dll_directory(str(args.dll_dir.resolve())) if args.dll_dir and os.name == 'nt' else None
sys.path.insert(0, str(args.module_dir.resolve()))
hg = importlib.import_module('harfang')
# No renderer is initialized: native NDCInfos uses its default zero-to-one
# depth. Tests explicitly adapt those recorded outputs to WebGL's [-1, 1].


def vector(value):
    return [value.x, value.y, value.z]


def matrix(value, affine=True):
    cols = [hg.GetColumn(value, i) for i in range(4)]
    return [n for c in cols for n in (vector(c) if affine else [c.x, c.y, c.z, c.w])]


cases = []
for name, pos, rot, scale in [
    ('identity', [0, 0, 0], [0, 0, 0], [1, 1, 1]),
    ('translation', [1.25, -2.5, 7], [0, 0, 0], [1, 1, 1]),
    ('rotate-x', [0, 0, 0], [0.7, 0, 0], [1, 1, 1]),
    ('rotate-y', [0, 0, 0], [0, 0.7, 0], [1, 1, 1]),
    ('rotate-z', [0, 0, 0], [0, 0, 0.7], [1, 1, 1]),
    ('nonuniform', [-3, 4, 2], [0.2, 0.3, 0.4], [2, 3, 4]),
    ('negative-scale', [1, 2, 3], [0.2, 0.3, 0.4], [-2, 3, 4]),
    ('three-negative', [0.1, -0.2, 4], [-0.6, 1.3, -2.1], [-1, -2, -3]),
]:
    mat = hg.TransformationMat4(hg.Vec3(*pos), hg.Vec3(*rot), hg.Vec3(*scale))
    cases.append(dict(name=name, position=pos, rotation=rot, scale=scale, matrix=matrix(mat),
                      point=vector(mat * hg.Vec3(0.7, -1.2, 2.3))))
projections = []
for kind in ['perspective', 'orthographic']:
    near, far, size, aspect = 0.25, 250, 1.7, [16 / 9, 1]
    fn = hg.ComputePerspectiveProjectionMatrix if kind == 'perspective' else hg.ComputeOrthographicProjectionMatrix
    mat = fn(near, far, size, hg.Vec2(*aspect))
    projected = []
    for point in [[0, 0, near], [0, 0, far], [0.3, -0.6, 4], [1, 2, -3]]:
        ok, result = hg.ProjectToScreenSpace(mat, hg.Vec3(*point), hg.Vec2(1280, 720))
        projected.append(dict(point=point, valid=ok, screen=vector(result) if ok else None))
    projections.append(dict(kind=kind, near=near, far=far, size=size, aspect=aspect, matrix=matrix(mat, False), points=projected))
sources = ['foundation/matrix3.cpp', 'foundation/matrix4.cpp', 'foundation/projection.cpp', 'foundation/rotation_order.h']
source_hashes = {name: hashlib.sha256((args.source / 'harfang' / name).read_bytes()).hexdigest() for name in sources}
result = dict(nativeBuild=args.native_build, nativeModuleSHA256=hashlib.sha256(Path(hg.__file__).read_bytes()).hexdigest(),
              inspectedSourceRevision=subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip(),
              inspectedSourceHashes=source_hashes, ndc=dict(originBottomLeft=False, homogeneousDepth=False),
              tolerance=0.0001, transforms=cases, projections=projections)
target = ROOT / 'tests/fixtures/native-math.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(f'Recorded {len(cases)} transforms and {len(projections)} projections in {target}')
