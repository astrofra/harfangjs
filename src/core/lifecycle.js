import {requireCondition, syncCall} from './errors.js';
import {profile, requireCapabilities} from '../profile.js';

// Injectable scheduling makes lifecycle tests use exact times and exercises the
// same code as requestAnimationFrame. A runner owns exactly one application.
export function createRunner(application, context, {
  requestFrame, cancelFrame, beforeFrame = () => {}, cleanup = () => {}, onError = () => {}
}) {
  requireCapabilities(application.requires ?? [], 'application');
  for (const method of ['init', 'update', 'render', 'dispose']) {
    requireCondition(typeof application[method] === 'function', 'INVALID_APPLICATION', `Missing ${method} callback`);
  }
  const controller = new AbortController();
  let state = 'idle', request, previousMs, initialization, stopping, suspendRequested = false;
  let started = false, disposed = false, failure;
  context.signal = controller.signal;
  context.profile = profile;
  const isActive = () => state === 'running';
  function unschedule() { if (request !== undefined) cancelFrame(request); request = undefined; previousMs = undefined; }
  function report(error) {
    failure = failure ? new AggregateError([failure, error], 'Application failed during cleanup') : error;
    try { onError(error); } catch { /* An error reporter must not interrupt cleanup. */ }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try { if (started) syncCall(application, 'dispose', context); } catch (error) { report(error); }
    try { cleanup(); } catch (error) { report(error); }
    state = failure ? 'failed' : 'stopped';
  }
  function stop() {
    if (stopping) return stopping;
    if (disposed) return Promise.resolve();
    state = 'stopping'; unschedule(); controller.abort(); context.input?.reset();
    // init owns its partially constructed state until it settles. Managed loads
    // observe ctx.signal; dispose then runs once even after a late init completion.
    stopping = Promise.resolve(initialization).catch(() => {}).then(dispose);
    return stopping;
  }
  function fail(error) { report(error); void stop(); }
  function frame(timestampMs) {
    request = undefined;
    if (!isActive()) return;
    try {
      const deltaMs = previousMs === undefined ? 0 : Math.min(Math.max(timestampMs - previousMs, 0), profile.limits.maxFrameDeltaMs);
      previousMs = timestampMs;
      const dtNs = BigInt(Math.round(deltaMs * 1e6));
      beforeFrame();
      if (!isActive()) return;
      context.input?.snapshot();
      syncCall(application, 'update', context, dtNs);
      if (!isActive()) return;
      syncCall(application, 'ui', context);
      if (!isActive()) return;
      syncCall(application, 'render', context, 0);
      if (isActive()) request = requestFrame(frame);
    } catch (error) { fail(error); }
  }
  function start() {
    if (initialization) return initialization;
    requireCondition(state === 'idle', 'INVALID_LIFECYCLE', 'Create a new runner to restart');
    state = 'initializing';
    initialization = Promise.resolve().then(() => {
      if (state === 'stopping') return;
      started = true;
      return application.init(context);
    }).then(() => {
      if (state === 'stopping') return false;
      if (suspendRequested) { state = 'suspended'; syncCall(application, 'suspend', context); }
      else { state = 'running'; request = requestFrame(frame); }
      return true;
    }).catch(error => {
      if (state === 'stopping' && controller.signal.aborted && (error.code === 'CANCELLED' || error.name === 'AbortError')) return false;
      report(error); state = 'stopping'; unschedule(); controller.abort();
      dispose(); throw error;
    });
    return initialization;
  }
  function suspend() {
    suspendRequested = true;
    if (state !== 'running') return;
    state = 'suspended'; unschedule(); context.input?.reset();
    try { syncCall(application, 'suspend', context); } catch (e) { fail(e); }
  }
  function resume() {
    suspendRequested = false;
    if (state !== 'suspended') return;
    try {
      syncCall(application, 'resume', context);
      if (state !== 'suspended') return;
      state = 'running'; previousMs = undefined; request = requestFrame(frame);
    } catch (e) { fail(e); }
  }
  context.stop = stop;
  return {start, stop, suspend, resume, fail,
    resize(width, height) {
      if (!['running', 'suspended'].includes(state)) return;
      try { syncCall(application, 'resize', context, width, height); } catch (e) { fail(e); }
    },
    get state() { return state; }, get error() { return failure; }, context};
}
