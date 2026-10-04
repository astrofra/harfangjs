import {HandlePool} from '../core/handles.js';
import {requireCondition, finite, integer} from '../core/errors.js';
import {Vec3, Color, Deg, Mat4, Mat44, Inverse, TransformationMat4, FovToZoomFactor, ComputePerspectiveProjectionMatrix, ComputeOrthographicProjectionMatrix} from '../core/math.js';
import {profile} from '../profile.js';

const handles = new WeakMap();
const destructionObservers = new WeakMap();
export function watchNodeDestruction(node, callback) {
  const ref = handles.get(node);
  requireCondition(node instanceof Node && node.IsValid(), 'INVALID_HANDLE', 'Cannot watch an invalid node');
  let observers = destructionObservers.get(ref);
  if (!observers) { observers = new Set(); destructionObservers.set(ref, observers); }
  observers.add(callback);
  return () => observers.delete(callback);
}
function notifyDestruction(ref) {
  const observers = destructionObservers.get(ref);
  destructionObservers.delete(ref);
  const errors = [];
  for (const callback of [...(observers ?? [])]) { try { callback(); } catch (e) { errors.push(e); } }
  if (errors.length) throw new AggregateError(errors, 'Node destruction callback failed');
}
function token(wrapper, pool) {
  const t = handles.get(wrapper);
  pool.get(t);
  return t;
}
function value(wrapper) {
  const ref = handles.get(wrapper);
  requireCondition(ref, 'INVALID_HANDLE', 'Handle is invalid');
  return ref.pool.get(ref);
}
class Handle {
  constructor(pool, ref) { handles.set(this, ref); }
  IsValid() { const ref = handles.get(this); return !!ref && ref.pool.valid(ref); }
  equals(other) {
    const a = handles.get(this), b = handles.get(other);
    return !!a && !!b && a.pool === b.pool && a.index === b.index && a.generation === b.generation;
  }
}
export class Transform extends Handle {
  GetPos() { return new Vec3(value(this).pos); }
  SetPos(v) { requireVec3(v); value(this).pos = new Vec3(v); }
  GetRot() { return new Vec3(value(this).rot); }
  SetRot(v) { requireVec3(v); value(this).rot = new Vec3(v); }
  GetScale() { return new Vec3(value(this).scale); }
  SetScale(v) { requireVec3(v); value(this).scale = new Vec3(v); }
  GetPosRot() { return [this.GetPos(), this.GetRot()]; }
  SetPosRot(p, r) { requireVec3(p); requireVec3(r); this.SetPos(p); this.SetRot(r); }
  GetParent() { const v = value(this); return new Node(v.nodes, v.parent); }
  SetParent(node) {
    const v = value(this), parent = token(node, v.nodes);
    let cursor = node;
    for (let depth = 0; cursor.IsValid(); ++depth) {
      requireCondition(depth < profile.limits.maxHierarchyDepth, 'HIERARCHY_DEPTH', 'Transform hierarchy is too deep');
      const transform = cursor.GetTransform();
      requireCondition(!transform.equals(this), 'HIERARCHY_CYCLE', 'Transform parenting would create a cycle');
      if (!transform.IsValid()) break;
      cursor = transform.GetParent();
    }
    v.parent = parent;
  }
  ClearParent() { value(this).parent = undefined; }
  GetWorld() {
    const chain = [], seen = new Set(); let transform = this;
    while (transform.IsValid()) {
      const v = value(transform);
      requireCondition(!seen.has(v) && chain.length < profile.limits.maxHierarchyDepth, 'HIERARCHY_CYCLE', 'Invalid transform hierarchy');
      seen.add(v); chain.push(TransformationMat4(v.pos, v.rot, v.scale));
      const parent = transform.GetParent();
      if (!parent.IsValid()) break;
      transform = parent.GetTransform();
    }
    // Validate the starting handle even when the loop above did not execute.
    value(this);
    let world = Mat4.Identity;
    for (const local of chain.reverse()) world = world.mul(local);
    return world;
  }
}
function requireVec3(v) { requireCondition(v instanceof Vec3, 'INVALID_ARGUMENT', 'Expected Vec3'); }
export class Node extends Handle {
  GetName() { return value(this).name; }
  SetName(name) { requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected node name'); value(this).name = name; }
  GetTransform() { const v = value(this); return new Transform(v.transforms, v.transform); }
  SetTransform(transform) {
    const v = value(this), next = token(transform, v.transforms), previous = v.transform;
    v.transform = next;
    try { transform.GetWorld(); } catch (error) { v.transform = previous; throw error; }
  }
  GetCamera() { const v = value(this); return new Camera(v.cameras, v.camera); }
  SetCamera(camera) { const v = value(this); v.camera = token(camera, v.cameras); }
  GetObject() { const v = value(this); return new ObjectComponent(v.objects, v.object); }
  SetObject(object) { const v = value(this); v.object = token(object, v.objects); }
  IsEnabled() { return value(this).enabled; }
  IsItselfEnabled() { return this.IsEnabled(); }
  Enable() { value(this).enabled = true; }
  Disable() { value(this).enabled = false; }
}
export class Camera extends Handle {
  GetZNear() { return value(this).near; }
  GetZFar() { return value(this).far; }
  GetFov() { return value(this).fov; }
  GetSize() { return value(this).size; }
  GetIsOrthographic() { return value(this).ortho; }
  SetFov(fov) { finite(fov); requireCondition(fov > 0 && fov < Math.PI, 'INVALID_CAMERA', 'FOV must be in (0, pi)'); value(this).fov = fov; }
  SetSize(size) { finite(size); requireCondition(size > 0, 'INVALID_CAMERA', 'Orthographic size must be positive'); value(this).size = size; }
  projection(aspect) {
    const c = value(this);
    return c.ortho ? ComputeOrthographicProjectionMatrix(c.near, c.far, c.size, aspect) :
      ComputePerspectiveProjectionMatrix(c.near, c.far, FovToZoomFactor(c.fov), aspect);
  }
}
export class ObjectComponent extends Handle {
  GetModelRef() { return value(this).model; }
  GetMaterialCount() { return value(this).materials.length; }
  GetMaterial(index) { const v = value(this); return v.materials[integer(index, 0, v.materials.length - 1, 'material index')]; }
  GetMaterialName(index) { const v = value(this); integer(index, 0, v.materials.length - 1, 'material index'); return v.names[index] ?? ''; }
  SetMaterialName(index, name) { const v = value(this); integer(index, 0, v.materials.length - 1, 'material index'); requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected material name'); v.names[index] = name; }
}
export class Scene {
  #nodes = new HandlePool();
  #transforms = new HandlePool();
  #cameras = new HandlePool(); #objects = new HandlePool(); #currentCamera;
  #owned = [];
  #order = [];
  #disposed = false;
  canvas = {clear_color: true, clear_z: true, color: new Color(0.05, 0.06, 0.08)};
  metadata = {};
  #assertAlive() { requireCondition(!this.#disposed, 'DISPOSED', 'Scene is disposed'); }
  CreateNode(name = '') {
    this.#assertAlive();
    requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected node name');
    requireCondition(this.#nodes.size < profile.limits.maxNodes, 'RESOURCE_BUDGET', 'Scene node budget exceeded');
    const ref = this.#nodes.allocate({name, transforms: this.#transforms, cameras: this.#cameras, objects: this.#objects, transform: undefined, enabled: true});
    this.#order.push(ref);
    return new Node(this.#nodes, ref);
  }
  GetNode(name) {
    this.#assertAlive();
    return new Node(this.#nodes, this.#order.find(t => this.#nodes.valid(t) && this.#nodes.get(t).name === name));
  }
  GetNodes() { this.#assertAlive(); return this.#order.filter(t => this.#nodes.valid(t)).map(t => new Node(this.#nodes, t)); }
  GetNodeCount() { this.#assertAlive(); return this.#nodes.size; }
  DestroyNode(node) {
    const ref = token(node, this.#nodes);
    try { notifyDestruction(ref); }
    finally {
      if (this.#nodes.valid(ref)) this.#nodes.release(ref);
      this.#order = this.#order.filter(t => t !== ref);
    }
  }
  CreateTransform(pos = Vec3.Zero, rot = Vec3.Zero, scale = Vec3.One) {
    this.#assertAlive();
    [pos, rot, scale].forEach(requireVec3);
    return new Transform(this.#transforms, this.#transforms.allocate({pos: new Vec3(pos), rot: new Vec3(rot), scale: new Vec3(scale), nodes: this.#nodes}));
  }
  DestroyTransform(transform) { this.#transforms.release(token(transform, this.#transforms)); }
  CreateCamera(near = 0.01, far = 1000, fov) {
    fov ??= arguments.length === 0 ? Deg(40) : Deg(45);
    this.#assertAlive(); [near, far, fov].forEach(v => finite(v));
    requireCondition(near > 0 && far > near && fov > 0 && fov < Math.PI, 'INVALID_CAMERA', 'Invalid camera range/FOV');
    return new Camera(this.#cameras, this.#cameras.allocate({near, far, fov, size: 1, ortho: false}));
  }
  CreateOrthographicCamera(near = 0.01, far = 1000, size = 1) {
    this.#assertAlive(); [near, far, size].forEach(v => finite(v));
    requireCondition(near >= 0 && far > near && size > 0, 'INVALID_CAMERA', 'Invalid orthographic camera');
    return new Camera(this.#cameras, this.#cameras.allocate({near, far, fov: Deg(40), size, ortho: true}));
  }
  DestroyCamera(camera) { this.#cameras.release(token(camera, this.#cameras)); }
  SetCurrentCamera(node) { const ref = token(node, this.#nodes); requireCondition(node.GetCamera().IsValid(), 'INVALID_CAMERA', 'Node has no camera'); this.#currentCamera = ref; }
  GetCurrentCamera() { this.#assertAlive(); return new Node(this.#nodes, this.#currentCamera); }
  ComputeCurrentCameraViewState(aspect) {
    const node = this.GetCurrentCamera(), camera = node.GetCamera();
    const [ok, view] = Inverse(node.GetTransform().GetWorld());
    requireCondition(ok, 'INVALID_CAMERA', 'Camera world transform is singular');
    const proj = camera.projection(aspect);
    return {view, proj, viewProjection: proj.mul(new Mat44(view))};
  }
  CreateObject(model, materials) {
    this.#assertAlive();
    requireCondition(model?.IsValid() && Array.isArray(materials) && materials.length > 0, 'INVALID_OBJECT', 'Valid model and materials required');
    for (const submesh of model.submeshes) requireCondition(submesh.material < materials.length, 'INVALID_MATERIAL_SLOT', 'Model references a missing material slot');
    return new ObjectComponent(this.#objects, this.#objects.allocate({model, materials: [...materials], names: []}));
  }
  DestroyObject(object) { this.#objects.release(token(object, this.#objects)); }
  own(resource) { this.#assertAlive(); this.#owned.push(resource); return resource; }
  get stats() { return {nodes: this.#nodes.size, transforms: this.#transforms.size, cameras: this.#cameras.size, objects: this.#objects.size}; }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const errors = [];
    for (const ref of [...this.#order]) { try { notifyDestruction(ref); } catch (e) { errors.push(e); } }
    this.#nodes.dispose(); this.#transforms.dispose(); this.#cameras.dispose(); this.#objects.dispose(); this.#order.length = 0;
    for (const owned of this.#owned.splice(0).reverse()) { try { owned.dispose(); } catch (e) { errors.push(e); } }
    if (errors.length) throw new AggregateError(errors, 'Scene destruction callback failed');
  }
}
