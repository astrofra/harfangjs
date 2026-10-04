import {requireCondition} from '../core/errors.js';

// Match PrepareForwardPipelineLights: reserve slot 0 even with no directional light.
// Native std::sort does not specify ties; our documented tie-break is scene node order.
export function selectLights(scene) {
  const enabled = scene.GetLights().filter(node => node.IsEnabled());
  const byPriority = (a,b) => b.GetLight().GetPriority() - a.GetLight().GetPriority();
  const directional = enabled.filter(n => n.GetLight().GetType() === 'linear').sort(byPriority);
  const local = enabled.filter(n => n.GetLight().GetType() !== 'linear').sort(byPriority);
  const selected = [directional[0],...local.slice(0,7)];
  const positions = new Float32Array(32), directions = new Float32Array(32), diffuse = new Float32Array(32), specular = new Float32Array(32);
  const names = Array(8).fill(null);
  for (const [slot,node] of selected.entries()) {
    if (!node) continue;
    const light = node.GetLight(), world = node.GetTransform().GetWorld().data;
    requireCondition(light.GetInnerAngle() <= light.GetOuterAngle(),'INVALID_LIGHT','Inner spot angle exceeds outer angle',node.GetName());
    const i = slot * 4, radius = light.GetRadius(), spot = light.GetType() === 'spot';
    positions.set([world[9],world[10],world[11],slot && radius ? 1/radius : 0],i);
    directions.set([world[6],world[7],world[8],spot ? Math.cos(light.GetInnerAngle()) : 0],i);
    const d = light.GetDiffuseColor(), s = light.GetSpecularColor();
    diffuse.set([d.r*light.GetDiffuseIntensity(),d.g*light.GetDiffuseIntensity(),d.b*light.GetDiffuseIntensity(),spot ? Math.cos(light.GetOuterAngle()) : 0],i);
    specular.set([s.r*light.GetSpecularIntensity(),s.g*light.GetSpecularIntensity(),s.b*light.GetSpecularIntensity(),0],i);
    names[slot] = node.GetName();
  }
  return {positions,directions,diffuse,specular,names,active:names.filter(n => n !== null).length,
    omitted:Math.max(0,directional.length-1)+Math.max(0,local.length-7)};
}
