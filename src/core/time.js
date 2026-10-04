import {finite, requireCondition} from './errors.js';

export const TIME_MIN = -(1n << 63n);
export const TIME_MAX = (1n << 63n) - 1n;
export function time_from_ns(value) {
  requireCondition(typeof value === 'bigint' && value >= TIME_MIN && value <= TIME_MAX,
    'INVALID_ARGUMENT', 'time_ns requires a signed 64-bit BigInt');
  return value;
}
export const time_to_ns = time_from_ns;
export const time_from_sec = seconds => time_from_ns(time_from_ns(seconds) * 1000000000n);
export const time_from_ms = ms => time_from_ns(time_from_ns(ms) * 1000000n);
export const time_to_sec = ns => time_from_ns(ns) / 1000000000n;
export const time_to_ms = ns => time_from_ns(ns) / 1000000n;
export const time_to_sec_f = ns => Math.fround(Number(time_from_ns(ns)) / 1e9);
export const time_to_ms_f = ns => Math.fround(Number(time_from_ns(ns)) / 1e6);
export const time_from_sec_f = seconds => time_from_ns(BigInt(Math.trunc(Math.fround(finite(seconds)) * 1e9)));
export const time_from_sec_d = seconds => time_from_ns(BigInt(Math.trunc(finite(seconds) * 1e9)));

export function parseTimeNs(value, source = 'time_ns') {
  requireCondition((typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' && /^-?\d+$/.test(value)),
  'INVALID_TIMESTAMP', 'Expected a safe JSON integer or decimal string; lost digits cannot be recovered', source);
  return time_from_ns(BigInt(value));
}
