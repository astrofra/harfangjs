import {HandlePool} from '../core/handles.js';
import {requireCondition} from '../core/errors.js';
import {profile} from '../profile.js';

const pool = new HandlePool(), tokens = new WeakMap(), observers = new WeakMap();
export function imageData(image) { return pool.get(tokens.get(image)); }
export function watchImage(image, callback) {
  imageData(image); let set = observers.get(image);
  if (!set) { set = new Set(); observers.set(image, set); }
  set.add(callback); return () => set.delete(callback);
}
export class Picture {
  constructor(bitmap, logicalId) {
    requireCondition(bitmap && Number.isInteger(bitmap.width) && bitmap.width > 0 && bitmap.width <= profile.limits.maxTextureSize && bitmap.height > 0 && bitmap.height <= profile.limits.maxTextureSize,
      'IMAGE_BUDGET', 'Invalid or oversized decoded image', logicalId);
    tokens.set(this, pool.allocate({bitmap, logicalId}));
  }
  IsValid() { return pool.valid(tokens.get(this)); }
  GetWidth() { return imageData(this).bitmap.width; }
  GetHeight() { return imageData(this).bitmap.height; }
  get logicalId() { return imageData(this).logicalId; }
  dispose() {
    if (!this.IsValid()) return;
    const {bitmap} = imageData(this); pool.release(tokens.get(this));
    const errors = [];
    for (const callback of observers.get(this) ?? []) { try { callback(); } catch (e) { errors.push(e); } }
    observers.delete(this); bitmap.close();
    if (errors.length) throw new AggregateError(errors, 'Image cleanup failed');
  }
}
