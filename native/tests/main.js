import * as hg from 'harfang';
import {nextFrame} from 'harfang-host';
import {runNativeWebContract} from './shared/native-web.js';

export async function main() {
  hg.AddAssetsFolder('resources_compiled');
  await Promise.resolve();
  const contract = runNativeWebContract();
  // The same engine still runs Lua scene components when driven from JS.
  for (let round = 0; round < 4; round++) {
    const scene = new hg.Scene(), vm = new hg.SceneLuaVM(), clocks = new hg.SceneClocks();
    try {
      const node = scene.CreateNode(); node.SetTransform(scene.CreateTransform());
      node.SetScript(0, scene.CreateScript('move.lua'));
      hg.SceneSyncToSystemsFromAssets(scene, vm);
      if (vm.GetScriptCount() !== 1n) throw Error('Embedded Lua component missing');
      await nextFrame();
      hg.SceneUpdateSystems(scene, clocks, 500000000n, vm);
      if (node.GetTransform().GetPos().x !== 0.5) throw Error('Lua scene update failed');
      hg.SceneClearSystems(scene, vm);
      if (vm.GetScriptCount() !== 0n) throw Error('Lua component cleanup failed');
    } finally { hg.SceneClearSystems(scene, vm); }
  }
  console.log('HGJS_CONTRACT ' + JSON.stringify({contract}));
}
