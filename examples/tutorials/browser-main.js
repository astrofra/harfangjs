import {createBrowserApplication} from 'harfang/browser';
import {createApplication, cases} from './application.js';

const query = new URLSearchParams(location.search);
const caseId = query.get('case') ?? 'draw_lines';
const select = document.querySelector('select');
for (const name of cases) select.add(new Option(name, name, false, name === caseId));
select.addEventListener('change', () => { location.search = `?case=${encodeURIComponent(select.value)}`; });
const status = document.querySelector('#status');
let runner, application;
function makeRunner() {
  application = createApplication(caseId);
  runner = createBrowserApplication(application, {
    canvas: document.querySelector('canvas'), modules: {'behaviors/communication.js': () => import('./behaviors/communication.js')},
    onError: error => { status.textContent = `${error.code ?? error.name}: ${error.message}`; }
  });
  window.harfangDemo = {runner, application};
  runner.start().catch(error => { status.textContent = error.message; });
}
try { makeRunner(); } catch (error) { status.textContent = error.message; }
document.querySelector('#pause').addEventListener('click', () => runner.state === 'suspended' ? runner.resume() : runner.suspend());
document.querySelector('#restart').addEventListener('click', async () => { await runner.stop(); makeRunner(); });
setInterval(() => {
  if (!runner || runner.error) return;
  status.textContent = JSON.stringify({state: runner.state, ...application.stats, renderer: runner.context.renderer.stats,
    resources: runner.context.assets.stats, width: runner.context.width, height: runner.context.height}, null, 2);
}, 150);
