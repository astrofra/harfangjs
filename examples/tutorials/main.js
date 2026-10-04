// Desktop entry contract for slice N. Requires a native harfang module providing
// CreateDesktopContext and the same context services; never uses the web runner.
import * as hg from 'harfang';
import {createApplication} from './application.js';

async function main() {
  if (typeof hg.CreateDesktopContext !== 'function') throw new Error('Native QuickJS host requires slice N; it is not shipped by harfangjs W0.');
  const ctx = await hg.CreateDesktopContext({width: 1280, height: 720, profile: 'web-foundation/1'});
  const app = createApplication('draw_lines');
  try {
    await app.init(ctx);
    while (ctx.window.isOpen() && !ctx.stopRequested) {
      const frame = await ctx.nextFrame();
      if (frame.closed || ctx.stopRequested) break;
      app.update(ctx, frame.dtNs);
      if (ctx.stopRequested) break;
      if (app.ui) app.ui(ctx);
      app.render(ctx, 0);
      ctx.present();
    }
  } finally {
    ctx.cancelPendingApplicationWork();
    try { app.dispose(ctx); } finally { ctx.destroy(); }
  }
}
export const completion = main();
