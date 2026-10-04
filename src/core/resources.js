import {HandlePool} from './handles.js';
import {abortError, HarfangError, requireCondition} from './errors.js';
import {profile, validateManifest, validateLogicalPath} from '../profile.js';

class Resource {
  #pool; #token; #release; #released = false;
  constructor(pool, token, release) { this.#pool = pool; this.#token = token; this.#release = release; }
  IsValid() { return this.#pool.valid(this.#token); }
  get logicalId() { return this.#pool.get(this.#token).id; }
  get byteLength() { return this.#pool.get(this.#token).data.byteLength; }
  bytes() { return this.#pool.get(this.#token).data.slice(0); }
  text() { return new TextDecoder('utf-8', {fatal: true}).decode(this.bytes()); }
  dispose() {
    if (this.#released) return;
    this.#released = true;
    if (this.IsValid()) { this.#pool.release(this.#token); this.#release(); }
    this.#release = undefined;
  }
}

export class ResourceManager {
  #entries = new Map();
  #pool = new HandlePool();
  #manifest; #baseURL; #fetch; #disposed = false;
  constructor({manifest, baseURL, fetch: fetcher = (...args) => globalThis.fetch(...args)}) {
    this.#manifest = JSON.parse(JSON.stringify(validateManifest(manifest)));
    this.#baseURL = new URL(baseURL);
    requireCondition(['http:', 'https:'].includes(this.#baseURL.protocol) && this.#baseURL.pathname.endsWith('/'),
      'INVALID_ASSET_PATH', 'Compiled asset base must be an HTTP(S) directory URL');
    this.#fetch = (...args) => fetcher(...args);
  }
  describe(id) {
    requireCondition(!this.#disposed, 'DISPOSED', 'Resource manager is disposed', id);
    requireCondition(Object.hasOwn(this.#manifest.assets, id), 'MISSING_ASSET', 'Logical ID is absent from the compiled manifest', id);
    return JSON.parse(JSON.stringify(this.#manifest.assets[id]));
  }
  acquire(id, {signal} = {}) {
    try {
      requireCondition(!this.#disposed, 'DISPOSED', 'Resource manager is disposed', id);
      validateLogicalPath(id);
      const descriptor = Object.hasOwn(this.#manifest.assets, id) && this.#manifest.assets[id];
      requireCondition(descriptor, 'MISSING_ASSET', 'Logical ID is absent from the compiled manifest', id);
      if (signal?.aborted) throw abortError(id);
      let entry = this.#entries.get(id);
      if (!entry) {
        entry = {id, controller: new AbortController(), users: 0, data: undefined};
        this.#entries.set(id, entry);
        entry.promise = this.#load(entry, descriptor);
      }
      ++entry.users;
      const release = () => {
        if (--entry.users === 0) {
          entry.controller.abort();
          entry.data = undefined;
          entry.promise = undefined;
          if (this.#entries.get(id) === entry) this.#entries.delete(id);
        }
      };
      return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          signal?.removeEventListener('abort', cancel);
          entry.controller.signal.removeEventListener('abort', cancel);
        };
        const cancel = () => {
          if (settled) return;
          settled = true; cleanup(); release(); reject(abortError(id));
        };
        signal?.addEventListener('abort', cancel, {once: true});
        entry.controller.signal.addEventListener('abort', cancel, {once: true});
        entry.promise.then(data => {
          if (settled) return;
          if (this.#disposed || signal?.aborted) { cancel(); return; }
          settled = true; cleanup();
          const token = this.#pool.allocate({id, data});
          resolve(new Resource(this.#pool, token, release));
        }, error => {
          if (settled) return;
          settled = true; cleanup(); release(); reject(error);
        });
      });
    } catch (error) { return Promise.reject(error); }
  }
  async #load(entry, descriptor) {
    try {
      const response = await this.#fetch(new URL(descriptor.uri, this.#baseURL), {signal: entry.controller.signal});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredBytes = Number(response.headers?.get('content-length'));
      requireCondition(!declaredBytes || declaredBytes <= profile.limits.maxResourceBytes,
        'RESOURCE_BUDGET', 'Resource exceeds byte budget', entry.id);
      const data = await response.arrayBuffer();
      if (entry.controller.signal.aborted || this.#disposed) throw abortError(entry.id);
      requireCondition(descriptor.byteLength === undefined || data.byteLength === descriptor.byteLength,
        'CORRUPT_ASSET', 'Compiled byte length does not match manifest', entry.id);
      if (descriptor.sha256) {
        requireCondition(globalThis.crypto?.subtle, 'INTEGRITY_UNAVAILABLE', 'SHA-256 verification requires HTTPS or localhost', entry.id);
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
        const hash = [...digest].map(n => n.toString(16).padStart(2, '0')).join('');
        requireCondition(hash === descriptor.sha256, 'CORRUPT_ASSET', 'SHA-256 does not match compiled manifest', entry.id);
        if (entry.controller.signal.aborted || this.#disposed) throw abortError(entry.id);
      }
      requireCondition(data.byteLength + this.stats.bytes <= profile.limits.maxResourceBytes,
        'RESOURCE_BUDGET', 'Resident resource byte budget exceeded', entry.id);
      entry.data = data;
      return data;
    } catch (error) {
      throw error instanceof HarfangError ? error : new HarfangError('ASSET_LOAD_FAILED', error.message, entry.id, {cause: error});
    }
  }
  get stats() {
    return {resources: this.#entries.size, handles: this.#pool.size,
      pending: [...this.#entries.values()].filter(e => !e.data).length,
      bytes: [...this.#entries.values()].reduce((n, e) => n + (e.data?.byteLength ?? 0), 0)};
  }
  cancelPending() {
    for (const entry of [...this.#entries.values()]) if (!entry.data) entry.controller.abort();
  }
  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const entry of [...this.#entries.values()]) { entry.controller.abort(); entry.data = undefined; entry.promise = undefined; }
    this.#pool.dispose(); this.#entries.clear();
  }
}
