import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
import {createApplication} from './application.js';

async function main() {
  hg.AddAssetsFolder('resources_compiled');
  hg.WindowSystemInit();
  const window = hg.NewWindow('HARFANG HGJS / QuickJS', 960, 640);
  const app = createApplication();
  let rendering = false;
  let previousWidth = 0, previousHeight = 0;
  try {
    if (!hg.RenderInit(window)) throw Error('Renderer initialization failed');
    rendering = true;
    await app.init();
    while (hg.IsWindowOpen(window)) {
      const frame = await nextFrame(window);
      if (frame.closed) break;
      const [ok, width, height] = hg.GetWindowFrameBufferSize(window);
      if (!ok || !width || !height) continue;
      if (width !== previousWidth || height !== previousHeight) {
        hg.RenderReset(width, height, hg.RF_VSync);
        previousWidth = width; previousHeight = height;
      }
      app.update(frame.dtNs);
      app.render(width, height);
      hg.Frame();
    }
  } finally {
    try { app.dispose(); }
    finally {
      if (rendering) hg.RenderShutdown();
      if (hg.IsWindowOpen(window)) hg.DestroyWindow(window);
      hg.WindowSystemShutdown();
    }
  }
}
export const completion = main();
