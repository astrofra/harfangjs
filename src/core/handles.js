import {requireCondition} from './errors.js';

// Opaque tokens include pool identity and a non-wrapping generation. A freed slot
// can be reused without reviving any previously returned wrapper.
export class HandlePool {
  #slots = [];
  #free = [];
  #disposed = false;
  #count = 0;
  allocate(value) {
    requireCondition(!this.#disposed, 'DISPOSED', 'Handle pool is disposed');
    const index = this.#free.length ? this.#free.pop() : this.#slots.length;
    const slot = this.#slots[index] ?? {generation: 0n};
    slot.value = value;
    slot.alive = true;
    this.#slots[index] = slot;
    ++this.#count;
    return Object.freeze({pool: this, index, generation: slot.generation});
  }
  valid(token) {
    const slot = token?.pool === this ? this.#slots[token.index] : undefined;
    return !this.#disposed && !!slot?.alive && slot.generation === token.generation;
  }
  get(token) {
    requireCondition(this.valid(token), 'INVALID_HANDLE', 'Handle is invalid, foreign, or disposed');
    return this.#slots[token.index].value;
  }
  release(token) {
    this.get(token);
    const slot = this.#slots[token.index];
    slot.value = undefined;
    slot.alive = false;
    ++slot.generation;
    --this.#count;
    this.#free.push(token.index);
  }
  get size() { return this.#count; }
  forEach(callback) { for(const slot of this.#slots)if(slot.alive)callback(slot.value); }
  dispose() {
    this.#disposed = true;
    this.#slots.length = 0;
    this.#free.length = 0;
    this.#count = 0;
  }
}
