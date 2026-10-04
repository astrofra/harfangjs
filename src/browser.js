import {createRunner} from './core/lifecycle.js';
import {InputManager} from './core/input.js';
import {StaticAssets} from './scene/assets.js';
import {ScriptManager} from './scene/scripts.js';
import {StaticRenderer} from './render/static.js';
import {HarfangError, requireCondition} from './core/errors.js';
import {profile} from './profile.js';

export function createBrowserApplication(application, {
  canvas, parent = document.body, manifest = {schema: profile.assetSchema, api: profile.api, profile: profile.id, assets: {}},
  assetBaseURL = new URL('./assets-web/', document.baseURI).href, modules = {}, onError = error => console.error(error)
} = {}) {
  const ownsCanvas = !canvas;
  if (!canvas) { canvas = document.createElement('canvas'); canvas.style.cssText = 'width:100%;height:100%;display:block'; parent.append(canvas); }
  const disposables = [], listeners = [];
  const cleanup = () => {
    const errors = [];
    for (const off of listeners.splice(0)) off();
    for (const value of disposables.splice(0).reverse()) { try { value.dispose(); } catch (e) { errors.push(e); } }
    if (ownsCanvas) canvas.remove();
    if (errors.length) throw new AggregateError(errors, 'Browser services cleanup failed');
  };
  try {
    requireCondition(canvas instanceof HTMLCanvasElement, 'INVALID_CANVAS', 'Expected an HTML canvas');
    const renderer = new StaticRenderer(canvas); disposables.push(renderer);
    const input = new InputManager().attach(canvas); disposables.push(input);
    const assets = new StaticAssets({manifest, baseURL: assetBaseURL, renderer}); disposables.push(assets);
    const scripts = new ScriptManager(modules); disposables.push(scripts);
    const context = {canvas, renderer, input, assets, scripts, width: canvas.width, height: canvas.height};
    let runner;
    function resize() {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, profile.limits.maxPixelRatio);
      const limit = Math.min(profile.limits.maxDrawingBufferSize, ...renderer.capabilities.maxViewportDimensions);
      const width = Math.max(1, Math.min(limit, Math.round(rect.width * ratio)));
      const height = Math.max(1, Math.min(limit, Math.round(rect.height * ratio)));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width; canvas.height = height;
        context.width = width; context.height = height; runner?.resize(width, height);
      }
    }
    resize();
    runner = createRunner(application, context, {
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: id => window.cancelAnimationFrame(id), beforeFrame: resize, cleanup, onError
    });
    context.signal.addEventListener('abort', () => { assets.cancelPending(); scripts.cancelPending(); }, {once: true});
    const on = (target, type, fn) => { target.addEventListener(type, fn); listeners.push(() => target.removeEventListener(type, fn)); };
    on(document, 'visibilitychange', () => document.hidden ? runner.suspend() : runner.resume());
    on(window, 'pagehide', () => { void runner.stop(); });
    on(canvas, 'webglcontextlost', event => {
      event.preventDefault(); runner.fail(new HarfangError('CONTEXT_LOST', 'WebGL context lost; create a new application after restoration'));
    });
    if (document.hidden) runner.suspend();
    return runner;
  } catch (error) { cleanup(); throw error; }
}
