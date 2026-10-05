import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';

const check = (condition, message) => { if (!condition) throw Error(message); };
async function main() {
  hg.WindowSystemInit();
  const window = hg.NewWindow(64, 64, 32, hg.WV_Hidden);
  try {
    const dimensions = hg.GetWindowClientSize(window);
    check(dimensions.length === 3 && dimensions[0] === true && dimensions[1] > 0 && dimensions[2] > 0, `Native output array order: ${JSON.stringify(dimensions)}`);
    const pending = nextFrame(window);
    hg.DestroyWindow(window);
    check((await pending).closed, 'Close during await did not settle the frame wait');
  } finally {
    if (hg.IsWindowOpen(window)) hg.DestroyWindow(window);
    hg.WindowSystemShutdown();
  }
  console.log('HGJS_LIFETIME_OK');
}
export const completion = main();
