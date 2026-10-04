export class HarfangError extends Error {
  constructor(code, message, source, options) {
    super(source ? `${source}: ${message}` : message, options);
    this.name = 'HarfangError';
    this.code = code;
    this.source = source;
  }
}

export function requireCondition(condition, code, message, source) {
  if (!condition) throw new HarfangError(code, message, source);
}

export function finite(value, name = 'value') {
  requireCondition(typeof value === 'number' && Number.isFinite(value), 'INVALID_ARGUMENT', `${name} must be finite`);
  return value;
}

export function integer(value, min, max, name = 'value') {
  requireCondition(Number.isSafeInteger(value) && value >= min && value <= max,
    'INVALID_ARGUMENT', `${name} must be an integer in [${min}, ${max}]`);
  return value;
}

export function syncCall(target, name, ...args) {
  const result = target[name]?.(...args);
  if (result && typeof result.then === 'function') {
    // Observe a rejection even though returning a Promise violates the contract.
    Promise.resolve(result).catch(() => {});
    throw new HarfangError('ASYNC_CALLBACK', `${name} must be synchronous`);
  }
  return result;
}

export function abortError(source) {
  return new HarfangError('CANCELLED', 'Operation cancelled', source);
}
