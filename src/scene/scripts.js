import {HandlePool} from '../core/handles.js';
import {abortError, requireCondition, syncCall} from '../core/errors.js';
import {time_from_ns} from '../core/time.js';
import {validateLogicalPath} from '../profile.js';
import {Node, watchNodeDestruction} from './scene.js';

export class ScriptManager {
  #registry; #pool = new HandlePool(); #order = []; #disposed = false;
  #instances = new WeakSet();
  #pending = new Set();
  constructor(registry = {}) { this.#registry = Object.freeze({...registry}); }
  async attach(id, target, parameters = {}, {signal} = {}) {
    validateLogicalPath(id);
    requireCondition(!this.#disposed, 'DISPOSED', 'Script manager is disposed', id);
    const loader = Object.hasOwn(this.#registry, id) && this.#registry[id];
    requireCondition(typeof loader === 'function', 'MISSING_MODULE', 'Missing compiled module registry entry', id);
    if (signal?.aborted) throw abortError(id);
    const module = await new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener('abort', cancel); this.#pending.delete(cancel); };
      const cancel = () => { cleanup(); reject(abortError(id)); };
      this.#pending.add(cancel);
      signal?.addEventListener('abort', cancel, {once: true});
      Promise.resolve().then(loader).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
    if (signal?.aborted || this.#disposed) throw abortError(id);
    requireCondition(typeof module.createBehavior === 'function', 'INVALID_SCRIPT', 'Module must export createBehavior()', id);
    const instance = syncCall(module, 'createBehavior');
    requireCondition(instance && typeof instance === 'object' && !this.#instances.has(instance),
      'INVALID_SCRIPT', 'Factory must return a fresh object per component', id);
    this.#instances.add(instance);
    const entry = {id, target, instance, attached: false};
    try {
      for (const [name, value] of Object.entries(parameters)) {
        requireCondition(!name.startsWith('On') && name !== '__proto__' && name !== 'constructor' && name !== 'prototype',
          'INVALID_SCRIPT_VALUE', 'Reserved script field', `${id}:${name}`);
        instance[name] = value;
        syncCall(instance, 'OnSetScriptValue', name);
      }
      requireCondition(!target?.IsValid || target.IsValid(), 'INVALID_HANDLE', 'Script target was destroyed', id);
      entry.attached = true;
      syncCall(instance, 'OnAttach', target);
      if (signal?.aborted || this.#disposed) throw abortError(id);
      requireCondition(!target?.IsValid || target.IsValid(), 'INVALID_HANDLE', 'Script target was destroyed during attachment', id);
      const handle = this.#pool.allocate(entry);
      this.#order.push(handle);
      if (target instanceof Node) entry.unwatch = watchNodeDestruction(target, () => { if (this.#pool.valid(handle)) this.detach(handle); });
      return handle;
    } catch (error) {
      const errors = [error];
      if (entry.attached && (!target?.IsValid || target.IsValid())) { try { syncCall(instance, 'OnDetach', target); } catch (e) { errors.push(e); } }
      try { syncCall(instance, 'OnDestroy'); } catch (e) { errors.push(e); }
      throw errors.length === 1 ? error : new AggregateError(errors, `Script attachment failed: ${id}`);
    }
  }
  IsValid(handle) { return this.#pool.valid(handle); }
  getValue(handle, name) { return this.#pool.get(handle).instance[name]; }
  setValue(handle, name, value) {
    const {instance, id} = this.#pool.get(handle);
    requireCondition(!name.startsWith('On') && !['__proto__', 'constructor', 'prototype'].includes(name),
      'INVALID_SCRIPT_VALUE', 'Reserved script field', `${id}:${name}`);
    instance[name] = value;
    syncCall(instance, 'OnSetScriptValue', name);
  }
  call(handle, name, ...args) {
    const {instance, id} = this.#pool.get(handle);
    requireCondition(Object.hasOwn(instance, name) && typeof instance[name] === 'function' && !name.startsWith('On'),
      'MISSING_SCRIPT_FUNCTION', `No callable ${name}`, id);
    return syncCall(instance, name, ...args);
  }
  update(dtNs) {
    time_from_ns(dtNs);
    requireCondition(!this.#disposed, 'DISPOSED', 'Script manager is disposed');
    for (const handle of [...this.#order]) {
      if (!this.#pool.valid(handle)) continue;
      const {instance, target} = this.#pool.get(handle);
      if (target?.IsValid && !target.IsValid()) { this.detach(handle); continue; }
      syncCall(instance, 'OnUpdate', target, dtNs);
    }
  }
  detach(handle) {
    const {instance, target, unwatch} = this.#pool.get(handle);
    unwatch?.();
    this.#pool.release(handle);
    this.#order = this.#order.filter(h => h !== handle);
    try { if (!target?.IsValid || target.IsValid()) syncCall(instance, 'OnDetach', target); }
    finally { syncCall(instance, 'OnDestroy'); }
  }
  get size() { return this.#pool.size; }
  cancelPending() { for (const cancel of [...this.#pending]) cancel(); }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.cancelPending();
    const errors = [];
    for (const handle of [...this.#order].reverse()) {
      try { if (this.#pool.valid(handle)) this.detach(handle); } catch (e) { errors.push(e); }
    }
    this.#pool.dispose();
    if (errors.length) throw new AggregateError(errors, 'Script disposal failed');
  }
}
