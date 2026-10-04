import * as hg from 'harfang';
import {createBrowserApplication} from 'harfang/browser';
import {HandlePool} from '../src/core/handles.js';
import {createApplication, cases} from '../examples/tutorials/application.js';
import * as communication from '../examples/tutorials/behaviors/communication.js';
import {registerStaticTests} from './static-suite.js';

const tests = [];
window.tutorialCaptures = {};
const test = (name, fn) => tests.push({name, fn});
function assert(ok, message = 'Assertion failed') { if (!ok) throw new Error(message); }
function equal(a, b) { assert(JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} != ${JSON.stringify(b)}`); }
function near(a, b, epsilon = 0.0001) {
  assert(a.length === b.length, 'Different lengths');
  a.forEach((n, i) => assert(Math.abs(n - b[i]) <= epsilon, `${n} != ${b[i]} at ${i}`));
}
function throws(fn, code) {
  try { fn(); } catch (e) { assert(!code || e.code === code, `Expected ${code}, got ${e.code}: ${e}`); return e; }
  throw new Error(`Expected ${code ?? 'exception'}`);
}
async function rejects(promise, code) {
  try { await promise; } catch (e) { assert(!code || e.code === code, `Expected ${code}, got ${e.code}: ${e}`); return e; }
  throw new Error(`Expected rejection: ${code}`);
}
const tick = async () => { for (let i = 0; i < 12; ++i) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; };
function scheduler() {
  let next = 0; const callbacks = new Map();
  return {requestFrame(fn) { const id = ++next; callbacks.set(id, fn); return id; },
    cancelFrame(id) { callbacks.delete(id); }, get size() { return callbacks.size; },
    step(time) { const work = [...callbacks.values()]; callbacks.clear(); work.forEach(fn => fn(time)); }};
}
const emptyApp = overrides => ({init() {}, update() {}, render() {}, dispose() {}, ...overrides});
const manifest = assets => ({schema: hg.profile.assetSchema, api: hg.profile.api, profile: hg.profile.id, assets});
const resourceOptions = fetch => ({manifest: manifest({'data/test.txt': {kind: 'bytes', uri: 'test.txt'}}), baseURL: new URL('./fixtures/', location.href).href, fetch});

test('math: native float fixtures, negative/nonuniform scale and projection depth adaptation', async () => {
  const fixture = await (await fetch('./fixtures/native-math.json')).json();
  assert(fixture.nativeBuild && fixture.nativeModuleSHA256);
  for (const sample of fixture.transforms) {
    const m = hg.TransformationMat4(new hg.Vec3(...sample.position), new hg.Vec3(...sample.rotation), new hg.Vec3(...sample.scale));
    near([...m.data], sample.matrix, fixture.tolerance);
    near([...m.mul(new hg.Vec3(0.7, -1.2, 2.3)).data], sample.point, fixture.tolerance);
    const [ok, inverse] = hg.Inverse(m); assert(ok);
    near([...inverse.mul(m).data], [...hg.Mat4.Identity.data]);
  }
  for (const sample of fixture.projections) {
    const fn = sample.kind === 'perspective' ? hg.ComputePerspectiveProjectionMatrix : hg.ComputeOrthographicProjectionMatrix;
    const p = fn(sample.near, sample.far, sample.size, new hg.Vec2(...sample.aspect));
    const expected = [...sample.matrix];
    if (!fixture.ndc.homogeneousDepth) for (let c = 0; c < 4; ++c) expected[c * 4 + 2] = 2 * expected[c * 4 + 2] - expected[c * 4 + 3];
    near([...p.data], expected);
    for (const point of sample.points) {
      const [ok, screen] = hg.ProjectToScreenSpace(p, new hg.Vec3(...point.point), new hg.Vec2(1280, 720));
      assert(ok === point.valid);
      // Pixel coordinates near 1000 have float32 ULPs above 1e-4. Keep the
      // matrix/world tolerance strict and use a separate subpixel tolerance.
      if (ok) near([...screen.data], [point.screen[0], point.screen[1], fixture.ndc.homogeneousDepth ? point.screen[2] : 2 * point.screen[2] - 1], 0.001);
    }
  }
});
test('math: singular inverse, value equality, copy storage, invalid input', () => {
  assert(!hg.Inverse(hg.ScaleMat4(new hg.Vec3(0, 1, 1)))[0]);
  const a = new hg.Vec3(1, 2, 3), b = new hg.Vec3(a); b.x = 8; assert(a.x === 1 && !a.equals(b));
  const m = hg.Mat4.Identity, array = m.toArray(); array[0] = 20; assert(m.data[0] === 1);
  assert(hg.Normalize(new hg.Vec3()).equals(hg.Vec3.Zero));
  assert(hg.Cross(hg.Vec3.Right, hg.Vec3.Up).equals(hg.Vec3.Front));
  throws(() => new hg.Vec3(Infinity), 'INVALID_ARGUMENT');
  throws(() => new hg.Mat4(1), 'INVALID_ARGUMENT');
  throws(() => hg.ComputePerspectiveProjectionMatrix(1, 0, 1, new hg.Vec2(1)), 'INVALID_ARGUMENT');
});
test('time: int64 limits, unsafe JSON integers and explicit units', () => {
  assert(hg.time_from_ns(hg.TIME_MAX) === 9223372036854775807n);
  assert(hg.time_from_ns(hg.TIME_MIN) === -9223372036854775808n);
  assert(hg.time_from_sec(2n) === 2000000000n);
  assert(hg.parseTimeNs('9007199254740993') === 9007199254740993n);
  assert(hg.time_to_sec_f(500000000n) === 0.5);
  throws(() => hg.time_from_ns(hg.TIME_MAX + 1n), 'INVALID_ARGUMENT');
  throws(() => hg.time_from_ns(42), 'INVALID_ARGUMENT');
  throws(() => hg.parseTimeNs(9007199254740992), 'INVALID_TIMESTAMP');
  throws(() => hg.time_from_sec_f(NaN), 'INVALID_ARGUMENT');
});
test('scene: named node get/change/set, copies, output order and destruction', () => {
  const scene = new hg.Scene(), node = scene.CreateNode('Actor');
  node.SetTransform(scene.CreateTransform(new hg.Vec3(1, 2, 3), new hg.Vec3(0.1, 0.2, 0.3)));
  const t = scene.GetNode('Actor').GetTransform(), pos = t.GetPos(); pos.x = 9;
  assert(t.GetPos().x === 1); t.SetPos(pos); assert(node.GetTransform().GetPos().x === 9);
  pos.x = 99; assert(t.GetPos().x === 9);
  const [p, r] = t.GetPosRot(); assert(p.x === 9); near([...r.data], [0.1, 0.2, 0.3]);
  assert(node.equals(scene.GetNode('Actor')) && node !== scene.GetNode('Actor'));
  assert(!scene.GetNode('Missing').IsValid());
  throws(() => scene.GetNode('Missing').GetName(), 'INVALID_HANDLE');
  scene.DestroyNode(node); assert(!node.IsValid() && t.IsValid());
  const replacement = scene.CreateNode('New'); assert(!node.IsValid() && replacement.IsValid());
  const foreign = new hg.Scene(); const foreignTransform = foreign.CreateTransform();
  throws(() => replacement.SetTransform(foreignTransform), 'INVALID_HANDLE');
  foreign.dispose(); scene.DestroyTransform(t); assert(!t.IsValid());
  scene.dispose(); scene.dispose(); equal(scene.stats, {nodes: 0, transforms: 0, cameras: 0, objects: 0});
  throws(() => scene.CreateNode(), 'DISPOSED');
});
test('handles: reuse never revives stale or foreign generation tokens', () => {
  const pool = new HandlePool(), a = pool.allocate('a'); pool.release(a); const b = pool.allocate('b');
  assert(a.index === b.index && !pool.valid(a) && pool.get(b) === 'b');
  throws(() => pool.get(new HandlePool().allocate('foreign')), 'INVALID_HANDLE');
  pool.dispose(); assert(!pool.valid(b)); throws(() => pool.allocate('c'), 'DISPOSED');
});
test('profile: unsupported requirements, native imports, version/path errors name their source', () => {
  const e = throws(() => hg.requireCapabilities(['physics'], 'scenes/main.scn'), 'UNSUPPORTED_CAPABILITY');
  assert(e.message.includes('scenes/main.scn'));
  throws(() => hg.validatePortableModule('harfang/native', 'application.js:4'), 'NATIVE_ONLY');
  throws(() => hg.validateManifest({...manifest({}), profile: 'web-lite/1'}), 'INCOMPATIBLE_MANIFEST');
  throws(() => hg.validateManifest(manifest({'a': {kind: 'bytes', uri: '../outside'}})), 'INVALID_ASSET_PATH');
  throws(() => hg.validateManifest(manifest({'a': {kind: 'scene', uri: 'a.scn'}})), 'UNSUPPORTED_ASSET');
  throws(() => hg.validateManifest(manifest({'a': {kind: 'bytes', uri: 'a', requires: ['skinning']}})), 'UNSUPPORTED_CAPABILITY');
});
test('resources: fetch deduplication, copied bytes and reference-counted release', async () => {
  let calls = 0;
  const assets = new hg.ResourceManager(resourceOptions(async () => { ++calls; return new Response('payload'); }));
  const [a, b] = await Promise.all([assets.acquire('data/test.txt'), assets.acquire('data/test.txt')]);
  assert(calls === 1 && a.text() === 'payload' && assets.stats.bytes === 7);
  new Uint8Array(a.bytes())[0] = 0; assert(b.text() === 'payload');
  a.dispose(); a.dispose(); assert(b.IsValid() && !a.IsValid());
  b.dispose(); equal(assets.stats, {resources: 0, handles: 0, pending: 0, bytes: 0}); assets.dispose();
});
test('resources: independent cancellation and final consumer abort', async () => {
  const pending = deferred(); let underlying;
  const assets = new hg.ResourceManager(resourceOptions((url, options) => { underlying = options.signal; return pending.promise; }));
  const a = new AbortController(), b = new AbortController();
  const first = assets.acquire('data/test.txt', {signal: a.signal}), firstRejected = rejects(first, 'CANCELLED');
  const second = assets.acquire('data/test.txt', {signal: b.signal});
  a.abort(); await firstRejected; assert(!underlying.aborted);
  pending.resolve(new Response('ok')); const resource = await second; assert(resource.text() === 'ok');
  resource.dispose(); assert(underlying.aborted); assets.dispose();
});
test('resources: disposal while fetching, late completion, failure and retry cleanup', async () => {
  const pending = deferred();
  const assets = new hg.ResourceManager(resourceOptions(() => pending.promise));
  const rejected = rejects(assets.acquire('data/test.txt'), 'CANCELLED'); assets.dispose(); await rejected;
  pending.resolve(new Response('late')); await tick(); assert(assets.stats.handles === 0);
  await rejects(assets.acquire('data/test.txt'), 'DISPOSED');
  let fail = true;
  const retry = new hg.ResourceManager(resourceOptions(async () => new Response('ok', {status: fail ? 404 : 200})));
  const error = await rejects(retry.acquire('data/test.txt'), 'ASSET_LOAD_FAILED'); assert(error.message.includes('data/test.txt'));
  fail = false; (await retry.acquire('data/test.txt')).dispose(); assert(retry.stats.bytes === 0);
  await rejects(retry.acquire('absent'), 'MISSING_ASSET'); retry.dispose();
});
test('scripts: per-component factory state, parameters, communication and exact lifetime order', async () => {
  const scene = new hg.Scene(), node = scene.CreateNode('Actor'), order = [];
  const module = {createBehavior() { return {value: 0,
    OnSetScriptValue(name) { order.push(`parameter:${name}`); }, OnAttach() { order.push('attach'); },
    OnUpdate() { ++this.value; }, OnDetach() { order.push('detach'); }, OnDestroy() { order.push('destroy'); },
    Echo(v) { return v; }}; }};
  const scripts = new hg.ScriptManager({'behavior.js': async () => module});
  const a = await scripts.attach('behavior.js', node, {value: 4}), b = await scripts.attach('behavior.js', node);
  scripts.update(1n); assert(scripts.getValue(a, 'value') === 5 && scripts.getValue(b, 'value') === 1);
  scripts.setValue(a, 'value', 9); assert(scripts.getValue(b, 'value') === 1);
  assert(scripts.call(a, 'Echo', node).equals(node)); throws(() => scripts.call(a, 'Missing'), 'MISSING_SCRIPT_FUNCTION');
  scripts.detach(a); assert(!scripts.IsValid(a)); scene.DestroyNode(node); scripts.update(1n); assert(scripts.size === 0);
  equal(order, ['parameter:value', 'attach', 'attach', 'parameter:value', 'detach', 'destroy', 'detach', 'destroy']);
  scripts.dispose(); scene.dispose();
});
test('scripts: cancelled module load never creates an instance; shared singleton rejected', async () => {
  const pending = deferred(); let created = 0;
  const scripts = new hg.ScriptManager({'late.js': () => pending.promise});
  const attaching = scripts.attach('late.js', {}), rejected = rejects(attaching, 'CANCELLED'); scripts.dispose();
  pending.resolve({createBehavior() { ++created; return {}; }}); await rejected; assert(created === 0);
  const instance = {}, shared = new hg.ScriptManager({'bad.js': async () => ({createBehavior: () => instance})});
  await shared.attach('bad.js', {}); await rejects(shared.attach('bad.js', {}), 'INVALID_SCRIPT'); shared.dispose();
});
test('scripts: update Promise rejected and disposal continues through callback errors', async () => {
  let destroyed = 0;
  const scripts = new hg.ScriptManager({'bad.js': async () => ({createBehavior: () => ({
    async OnUpdate() { throw new Error('async failure'); }, OnDetach() { throw new Error('detach failure'); }, OnDestroy() { ++destroyed; }
  })})});
  await scripts.attach('bad.js', {}); await scripts.attach('bad.js', {});
  throws(() => scripts.update(1n), 'ASYNC_CALLBACK'); throws(() => scripts.dispose());
  assert(scripts.size === 0 && destroyed === 2); await tick();
});
test('scripts: scene destruction detaches while node handles remain valid', async () => {
  const scene = new hg.Scene(), detached = [];
  const scripts = new hg.ScriptManager({'owned.js': async () => ({createBehavior: () => ({
    OnDetach(node) { assert(node.IsValid()); detached.push(node.GetName()); }
  })})});
  const first = scene.CreateNode('first'), second = scene.CreateNode('second');
  await scripts.attach('owned.js', first); await scripts.attach('owned.js', second);
  scene.DestroyNode(first); assert(scripts.size === 1); scene.dispose();
  equal(detached, ['first', 'second']); assert(scripts.size === 0); scripts.dispose();
});
test('input: transitions survive press/release between frames, repeats and blur', () => {
  const input = new hg.InputManager();
  input.key('KeyA', true); input.key('KeyA', true); input.snapshot(); assert(input.keyboard.Pressed('KeyA'));
  const old = input.keyboard; input.snapshot(); assert(!input.keyboard.Pressed('KeyA') && old.Pressed('KeyA'));
  input.reset(); input.snapshot(); assert(input.keyboard.Released('KeyA') && !input.keyboard.Down('KeyA'));
  input.key('KeyB', true); input.key('KeyB', false); input.snapshot();
  assert(input.keyboard.Pressed('KeyB') && input.keyboard.Released('KeyB') && !input.keyboard.Down('KeyB'));
  input.move(20, 30); input.wheel(1); input.button(0, true); input.snapshot();
  equal([input.mouse.X(), input.mouse.Y(), input.mouse.DtX(), input.mouse.DtY(), input.mouse.Wheel()], [20, 30, 20, 30, 1]);
  assert(input.mouse.Pressed(0)); input.snapshot(); assert(input.mouse.DtX() === 0 && input.mouse.Wheel() === 0);
  input.dispose(); input.key('KeyC', true); input.snapshot(); assert(!input.keyboard.Down('KeyC'));
});
test('lifecycle: async init barrier, variable delta/clamp and pause/resume reset', async () => {
  const clock = scheduler(), loading = deferred(), deltas = [], events = [];
  const runner = hg.createRunner(emptyApp({init: () => loading.promise,
    update(ctx, dt) { deltas.push(Number(dt)); events.push('update'); }, render() { events.push('render'); },
    suspend() { events.push('suspend'); }, resume() { events.push('resume'); }, dispose() { events.push('dispose'); }}), {}, clock);
  const starting = runner.start(); await tick(); assert(clock.size === 0 && runner.state === 'initializing');
  loading.resolve(); await starting; clock.step(0); clock.step(10); clock.step(35); clock.step(900);
  equal(deltas, [0, 10000000, 25000000, 100000000]);
  runner.suspend(); assert(clock.size === 0); runner.resume(); clock.step(10000); assert(deltas.at(-1) === 0);
  await runner.stop(); await runner.stop(); assert(clock.size === 0 && runner.state === 'stopped');
  assert(events.filter(e => e === 'dispose').length === 1);
});
test('lifecycle: stop during init waits for owned state, never updates disposed app', async () => {
  const clock = scheduler(), loading = deferred(); let disposeCount = 0, updates = 0, scene;
  const runner = hg.createRunner(emptyApp({async init(ctx) { await loading.promise; scene = new hg.Scene(); scene.CreateNode(); assert(ctx.signal.aborted); },
    update() { ++updates; }, dispose() { ++disposeCount; scene.dispose(); }}), {}, clock);
  const start = runner.start(); await tick(); const stop = runner.stop(); assert(runner.state === 'stopping' && disposeCount === 0);
  loading.resolve(); assert(await start === false); await stop;
  assert(updates === 0 && disposeCount === 1 && scene.stats.nodes === 0 && clock.size === 0);
});
test('lifecycle: immediate stop prevents init from starting after cancellation', async () => {
  const clock = scheduler(); let initialized = 0, cleaned = 0;
  const runner = hg.createRunner(emptyApp({init() { ++initialized; }}), {}, {...clock, cleanup() { ++cleaned; }});
  const start = runner.start(); await runner.stop(); assert(await start === false);
  assert(initialized === 0 && cleaned === 1 && clock.size === 0 && runner.state === 'stopped');
});
test('lifecycle: errors, Promise frame callbacks, and stop from update clean up exactly once', async () => {
  for (const mode of ['reject-init', 'async-update', 'throw-render', 'stop-update']) {
    const clock = scheduler(); let disposed = 0, cleaned = 0, renders = 0;
    const runner = hg.createRunner(emptyApp({init() { if (mode === 'reject-init') return Promise.reject(new Error(mode)); },
      update(ctx) { if (mode === 'async-update') return Promise.reject(new Error(mode)); if (mode === 'stop-update') void ctx.stop(); },
      render() { ++renders; if (mode === 'throw-render') throw new Error(mode); }, dispose() { ++disposed; }}), {}, {...clock, cleanup() { ++cleaned; }});
    if (mode === 'reject-init') await rejects(runner.start()); else { await runner.start(); clock.step(0); }
    await tick(); await runner.stop(); assert(disposed === 1 && cleaned === 1 && clock.size === 0);
    assert(runner.state === (mode === 'stop-update' ? 'stopped' : 'failed'));
    if (mode === 'stop-update') assert(renders === 0);
  }
});
test('lifecycle: suspension during init and repeated independent runs', async () => {
  for (let i = 0; i < 5; ++i) {
    const clock = scheduler(), loading = deferred();
    const runner = hg.createRunner(emptyApp({init: () => loading.promise}), {}, clock);
    const start = runner.start(); runner.suspend(); loading.resolve(); await start;
    assert(runner.state === 'suspended' && clock.size === 0); runner.resume(); clock.step(0); await runner.stop(); assert(clock.size === 0);
  }
});
test('vertices: sparse/incomplete/unsupported data fails before drawing', () => {
  const layout = new hg.VertexLayout().Begin().Add(hg.A_Position, 3, hg.AT_Float).End();
  const v = new hg.Vertices(layout, 4); v.Begin(3).SetPos(new hg.Vec3()).End(); throws(() => v.dataForUpload(), 'INVALID_VERTEX');
  v.Clear(); v.Begin(0); throws(() => v.End(), 'INVALID_VERTEX');
  throws(() => new hg.VertexLayout().Begin().Add(hg.A_Position, 2, hg.AT_Float), 'UNSUPPORTED_LAYOUT');
  v.dispose(); throws(() => v.Begin(0), 'DISPOSED');
});

function makeCanvas() { const c = document.createElement('canvas'); c.width = c.height = 128; document.body.append(c); return c; }
test('WebGL2: diagnostic clear, white/colored line pixels, capability and GPU cleanup', () => {
  const canvas = makeCanvas(), renderer = new hg.LineRenderer(canvas), gl = canvas.getContext('webgl2');
  const white = renderer.createLineProgram('shaders/white');
  const layout = new hg.VertexLayout().Begin().Add(hg.A_Position, 3, hg.AT_Float).End();
  const vertices = new hg.Vertices(layout, 2);
  vertices.Begin(0).SetPos(new hg.Vec3(-0.8, 0, 0)).End(); vertices.Begin(1).SetPos(new hg.Vec3(0.8, 0, 0)).End();
  renderer.beginFrame(hg.Color.Green); renderer.drawLines(vertices, white);
  const pixels = new Uint8Array(128 * 128 * 4); gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let whitePixels = 0, greenPixels = 0;
  // A one-pixel line may straddle samples on an antialiased drawing buffer.
  for (let i = 0; i < pixels.length; i += 4) { if (pixels[i] > 100 && pixels[i + 2] > 100) ++whitePixels; if (pixels[i] === 0 && pixels[i + 1] === 255) ++greenPixels; }
  assert(whitePixels > 80 && greenPixels > 10000, `white=${whitePixels}, green=${greenPixels}`);
  const color = renderer.createLineProgram('shaders/pos_rgb');
  const colorLayout = new hg.VertexLayout().Begin().Add(hg.A_Position, 3, hg.AT_Float).Add(hg.A_Color0, 3, hg.AT_Float).End();
  const colored = new hg.Vertices(colorLayout, 2);
  colored.Begin(0).SetPos(new hg.Vec3(-0.8, 0, 0)).SetColor0(new hg.Color(1, 0, 0)).End();
  colored.Begin(1).SetPos(new hg.Vec3(0.8, 0, 0)).SetColor0(new hg.Color(0, 0, 1)).End();
  renderer.beginFrame(hg.Color.Black); renderer.drawLines(colored, color);
  gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let colors = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 10 && pixels[i + 2] > 10) ++colors;
  assert(colors > 60 && gl.getError() === gl.NO_ERROR);
  assert(renderer.stats.vertices === 2 && renderer.capabilities.renderer === 'WebGL2');
  throws(() => renderer.createLineProgram('custom/program'), 'UNSUPPORTED_PROGRAM');
  white.dispose(); throws(() => renderer.drawLines(vertices, white), 'INVALID_HANDLE');
  renderer.dispose(); vertices.dispose(); colored.dispose(); assert(!color.IsValid());
  assert(renderer.stats.gpuBufferBytes === 0 && renderer.stats.programs === 0); canvas.remove();
});

for (const caseId of cases) test(`tutorial: ${caseId} deterministic shared update/render/dispose`, async () => {
  const canvas = makeCanvas(), renderer = new hg.LineRenderer(canvas), input = new hg.InputManager();
  const scripts = new hg.ScriptManager({'behaviors/communication.js': async () => communication});
  const app = createApplication(caseId), clock = scheduler();
  const ctx = {renderer, input, scripts, width: 128, height: 128};
  const runner = hg.createRunner(app, ctx, {...clock, cleanup() { scripts.dispose(); input.dispose(); renderer.dispose(); }});
  await runner.start(); [0, 16, 32, 48].forEach(time => clock.step(time));
  assert(app.stats.steps === 4 && app.stats.elapsedNs === '48000000');
  window.tutorialCaptures[caseId] = canvas.toDataURL('image/png');
  near(app.stats.actorPosition, [0.0048, 0, 0], 0.000001);
  if (caseId.includes('draw_lines') || caseId.includes('.lines')) assert(renderer.stats.vertices === 2000 && renderer.stats.drawCalls === 1);
  if (caseId === 'scene_lua_script.js') assert(app.stats.scriptResult.includes('(24)'));
  input.key(hg.K_Escape, true); clock.step(64); await runner.stop();
  assert(app.stats.disposed && scripts.size === 0 && renderer.stats.programs === 0); canvas.remove();
});
test('browser adapter: context loss reports a failure and releases resources', async () => {
  const canvas = makeCanvas(), runner = createBrowserApplication(emptyApp(), {canvas, onError() {}});
  await runner.start(); canvas.dispatchEvent(new Event('webglcontextlost', {cancelable: true})); await runner.stop();
  assert(runner.state === 'failed' && runner.error.code === 'CONTEXT_LOST');
  assert(runner.context.renderer.stats.programs === 0); canvas.remove();
});
test('browser adapter: stop cancels init loads even without an explicit consumer signal', async () => {
  const canvas = makeCanvas(); let factoryCalls = 0, disposed = 0;
  const pending = deferred();
  const runner = createBrowserApplication(emptyApp({async init(ctx) {
    await ctx.scripts.attach('pending.js', {});
  }, dispose() { ++disposed; }}), {canvas, onError() {}, modules: {'pending.js': () => pending.promise}});
  const start = runner.start(); await tick(); await runner.stop(); await start;
  assert(runner.state === 'stopped' && disposed === 1);
  pending.resolve({createBehavior() { ++factoryCalls; return {}; }}); await tick(); assert(factoryCalls === 0);
  canvas.remove();
});

registerStaticTests({test, assert, equal, near, throws, rejects, scheduler});
const results = [];
for (const {name, fn} of tests) {
  try { await fn(); results.push({name, status: 'pass'}); }
  catch (e) { results.push({name, status: 'fail', error: e.stack ?? String(e)}); }
  document.querySelector('#results').textContent = results.map(r => `${r.status.toUpperCase()} ${r.name}${r.error ? `\n${r.error}` : ''}`).join('\n');
}
window.testResults = {api: hg.profile.api, profile: hg.profile.id, nativeJS: 'pending-slice-N', results,
  passed: results.filter(r => r.status === 'pass').length, failed: results.filter(r => r.status === 'fail').length};
document.body.dataset.complete = 'true';
