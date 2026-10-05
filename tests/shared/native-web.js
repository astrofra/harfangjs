import * as hg from 'harfang';

// This exact module runs in Chromium and HGJS. All native math/scene operations
// below go through generated bindings into HARFANG C++.
export function runNativeWebContract() {
  const results = {};
  const xyz = v => [v.x, v.y, v.z];
  const a = new hg.Vec3(1.25, -2, 3);
  const b = new hg.Vec3(2, 4, -1);
  results.add = xyz(a.add(b));
  results.sub = xyz(a.sub(b));
  results.scale = xyz(a.mul(2));
  results.dot = hg.Dot(a, b);
  results.cross = xyz(hg.Cross(a, b));
  results.normalize = xyz(hg.Normalize(new hg.Vec3(3, 0, 4)));
  results.matrix = xyz(hg.TransformationMat4(new hg.Vec3(1, 2, 3), new hg.Vec3(), new hg.Vec3(-2, 3, 4)).mul(new hg.Vec3(2, 3, 4)));
  results.defaults = [xyz(new hg.Vec3()), [new hg.Vec2().x, new hg.Vec2().y],
    [new hg.Vec4().x, new hg.Vec4().w], [new hg.Color().r, new hg.Color().a],
    xyz(new hg.Mat4().mul(new hg.Vec3(2, 3, 4)))];
  results.scalarConstructors = [xyz(new hg.Vec3(2)), xyz(new hg.Vec3(2, 3)),
    [new hg.Vec2(2).x, new hg.Vec2(2).y], new hg.Vec4(2, 3, 4).w, new hg.Color(0.5).a];
  const constant = hg.Vec3.Zero; constant.x = 99;
  results.constantCopy = xyz(hg.Vec3.Zero);
  const identity = hg.Mat4.Identity;
  results.identityCopy = new hg.Mat4(identity).equals(new hg.Mat4());
  results.equality = [new hg.Vec2(2, 3).equals(new hg.Vec2(2, 3)),
    new hg.Vec4(2, 3, 4, 5).equals(new hg.Vec4(2, 3, 4, 5)),
    new hg.Mat44(new hg.Mat44()).equals(new hg.Mat44())];
  const copy = new hg.Vec3(a); copy.x = 42;
  results.valueCopy = xyz(a);
  results.time = [0n, -1n, 9007199254740993n, -(1n << 63n), (1n << 63n) - 1n]
    .map(n => hg.time_to_ns(hg.time_from_ns(n)).toString());
  results.units = [hg.time_from_sec(2n).toString(), hg.time_to_ms(-1234567890n).toString(), hg.time_to_sec_f(500000000n)];
  const scene = new hg.Scene();
  try {
    const node = scene.CreateNode('Shared actor');
    node.SetTransform(scene.CreateTransform(new hg.Vec3(1, 2, 3), new hg.Vec3(), new hg.Vec3(1, 1, 1)));
    const actor = scene.GetNode('Shared actor');
    const pos = actor.GetTransform().GetPos();
    pos.x += 4;
    results.transformCopy = xyz(actor.GetTransform().GetPos());
    actor.GetTransform().SetPos(pos);
    results.transformSet = xyz(node.GetTransform().GetPos());
    results.name = actor.GetName();
    scene.DestroyNode(node);
    results.destroyed = [node.IsValid(), actor.IsValid()];
  } finally {
    // Host cleanup differs at the raw engine API boundary, not in application behavior.
    if (scene.dispose) scene.dispose(); else scene.Clear();
  }
  return results;
}
