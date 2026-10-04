import {HandlePool} from '../core/handles.js';
import {requireCondition} from '../core/errors.js';
import {Vec3, TransformationMat4} from '../core/math.js';

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
  GetWorld() { const v = value(this); return TransformationMat4(v.pos, v.rot, v.scale); }
}
function requireVec3(v) { requireCondition(v instanceof Vec3, 'INVALID_ARGUMENT', 'Expected Vec3'); }
export class Node extends Handle {
  GetName() { return value(this).name; }
  SetName(name) { requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected node name'); value(this).name = name; }
  GetTransform() { const v = value(this); return new Transform(v.transforms, v.transform); }
  SetTransform(transform) { const v = value(this); v.transform = token(transform, v.transforms); }
}
export class Scene {
  #nodes = new HandlePool();
  #transforms = new HandlePool();
  #order = [];
  #disposed = false;
  #assertAlive() { requireCondition(!this.#disposed, 'DISPOSED', 'Scene is disposed'); }
  CreateNode(name = '') {
    this.#assertAlive();
    requireCondition(typeof name === 'string', 'INVALID_ARGUMENT', 'Expected node name');
    const ref = this.#nodes.allocate({name, transforms: this.#transforms, transform: undefined});
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
    return new Transform(this.#transforms, this.#transforms.allocate({pos: new Vec3(pos), rot: new Vec3(rot), scale: new Vec3(scale)}));
  }
  DestroyTransform(transform) { this.#transforms.release(token(transform, this.#transforms)); }
  get stats() { return {nodes: this.#nodes.size, transforms: this.#transforms.size}; }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    const errors = [];
    for (const ref of [...this.#order]) { try { notifyDestruction(ref); } catch (e) { errors.push(e); } }
    this.#nodes.dispose(); this.#transforms.dispose(); this.#order.length = 0;
    if (errors.length) throw new AggregateError(errors, 'Scene destruction callback failed');
  }
}
