import {requireCondition} from '../core/errors.js';
let current;
export function setHost(host) {
  requireCondition(!host || !current, 'HOST_ACTIVE', 'Only one native-style browser session can run at a time');
  current=host;
}
export function getHost() { requireCondition(current, 'HOST_REQUIRED', 'Start a native-style browser application first'); return current; }
export function optionalHost() { return current; }
