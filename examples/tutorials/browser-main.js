import {createBrowserApplication} from 'harfang/browser';
import {createApplication, cases} from './application.js';
import {createStaticApplication, staticCases} from './static-application.js';
import {createLightingApplication, lightingCases} from './lighting-application.js';

const query = new URLSearchParams(location.search);
const caseId = query.get('case') ?? 'material_lighting';
const select = document.querySelector('select');
for (const name of [...lightingCases, ...staticCases, ...cases]) select.add(new Option(name, name, false, name === caseId));
select.addEventListener('change', () => { location.search = `?case=${encodeURIComponent(select.value)}`; });
const status = document.querySelector('#status');
let runner, application;
const assetBaseURL = new URL('../../assets-web/', import.meta.url).href;
let manifest;
function makeRunner() {
  application = lightingCases.includes(caseId) ? createLightingApplication(caseId) : staticCases.includes(caseId) ? createStaticApplication(caseId) : createApplication(caseId);
  runner = createBrowserApplication(application, {
    canvas: document.querySelector('canvas'), modules: {'behaviors/communication.js': () => import('./behaviors/communication.js')},
    manifest, assetBaseURL,
    onError: error => { status.textContent = `${error.code ?? error.name}: ${error.message}`; }
  });
  window.harfangDemo = {runner, application};
  runner.start().catch(error => { status.textContent = error.message; });
}
try {
  const response = await fetch(new URL('manifest.json', assetBaseURL));
  if (!response.ok) throw new Error(`Compiled manifest: HTTP ${response.status}. Run python tools/build_assets.py.`);
  manifest = await response.json(); makeRunner();
} catch (error) { status.textContent = error.message; }
document.querySelector('#pause').addEventListener('click', () => runner?.state === 'suspended' ? runner.resume() : runner?.suspend());
document.querySelector('#restart').addEventListener('click', async () => { await runner?.stop(); if (manifest) makeRunner(); });
setInterval(() => {
  if (!runner || runner.error) return;
  status.textContent = JSON.stringify({state: runner.state, ...application.stats, renderer: runner.context.renderer.stats,
    resources: runner.context.assets.stats, width: runner.context.width, height: runner.context.height}, null, 2);
}, 150);
