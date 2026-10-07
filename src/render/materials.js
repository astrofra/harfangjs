import {Color, Vec4} from '../core/math.js';
import {requireCondition} from '../core/errors.js';
import {validateMaterial} from '../scene/schema.js';
import {materialContract} from './material-contract.js';

// Materials borrow image resources; the scene or explicit caller owns their lifetime.
export class Material {
  #source; #pictures = new Map(); #revision = 0; #batchKey; #nativeUniforms;
  constructor(source, pictures = new Map(), {nativeUniforms = false} = {}) {
    validateMaterial(source, {nativeUniforms});this.#nativeUniforms=nativeUniforms;
    this.#source = structuredClone(source);
    for (const [name, picture] of pictures) {
      requireCondition(materialContract.families[source.program].textures[name] !== undefined && picture?.IsValid(), 'INVALID_MATERIAL', `Invalid texture ${name}`);
      this.#pictures.set(name,picture);
    }
    for (const texture of source.textures ?? []) if (texture.path)
      requireCondition(this.#pictures.get(texture.name)?.logicalId === texture.path,'INVALID_MATERIAL',`Unresolved texture ${texture.name}: ${texture.path}`);
  }
  get source() { return structuredClone(this.#source); }
  get family() { return materialContract.families[this.#source.program].family; }
  get program() { return this.#source.program; }
  get revision() { return this.#revision; }
  get blendMode() { return this.#source.blend_mode??'opaque'; }
  get batchKey() { return this.#batchKey ??= JSON.stringify(this.#source); }
  clone() { return new Material(this.#source, this.#pictures, {nativeUniforms:this.#nativeUniforms}); }
  get variantKey() {
    return `${this.program}:${[...this.#pictures.keys()].sort().join(',')}:${(this.#source.flags ?? []).slice().sort().join(',')}`;
  }
  value(name) {
    const family = materialContract.families[this.#source.program];
    const defaults = this.#nativeUniforms?{...family.values,...family.nativeInactiveValues}:family.values;
    requireCondition(Object.hasOwn(defaults,name), 'UNSUPPORTED_MATERIAL', `Unknown uniform ${name}`);
    return (this.#source.values?.find(v => v.name === name)?.value ?? defaults[name]).slice();
  }
  texture(name) { return this.#pictures.get(name); }
  textures() { return [...this.#pictures.entries()]; }
  setValue(name, value) {
    requireCondition(value instanceof Vec4 || value instanceof Color, 'INVALID_MATERIAL', 'Material values require Vec4 or Color');
    this.value(name);
    const next = this.source; next.values = next.values ?? [];
    const record = {name,type:'vec4',value:[...value.data]}, index = next.values.findIndex(v => v.name === name);
    if (index < 0) next.values.push(record); else next.values[index] = record;
    validateMaterial(next, {nativeUniforms:this.#nativeUniforms}); this.#source = next; this.#batchKey = undefined; ++this.#revision;
  }
  setTexture(name, picture, stage) {
    const expected = materialContract.families[this.#source.program].textures[name];
    requireCondition(expected !== undefined && stage === expected, 'UNSUPPORTED_MATERIAL', `Unsupported sampler ${name} at ${stage}`);
    requireCondition(picture == null || picture.IsValid?.(), 'INVALID_HANDLE', 'Texture is invalid');
    const next = this.source; next.textures = (next.textures ?? []).filter(t => t.name !== name);
    if (picture) next.textures.push({name,stage,path:picture.logicalId});
    validateMaterial(next, {nativeUniforms:this.#nativeUniforms});
    this.#source = next; this.#batchKey = undefined;
    if (picture) this.#pictures.set(name,picture); else this.#pictures.delete(name);
    ++this.#revision;
  }
  setState(key, value) {
    requireCondition(['blend_mode','depth_test','face_culling','write_r','write_g','write_b','write_a','write_z','flags'].includes(key), 'INVALID_MATERIAL', `Unknown material state ${key}`);
    const next = this.source; next[key] = value; validateMaterial(next,{nativeUniforms:this.#nativeUniforms}); this.#source = structuredClone(next); this.#batchKey = undefined; ++this.#revision;
  }
}

export const SetMaterialValue = (material, name, value) => material.setValue(name,value);
export const GetMaterialValue = (material, name) => new Vec4(...material.value(name));
export const SetMaterialTexture = (material, name, picture, stage) => material.setTexture(name,picture,stage);
export const GetMaterialTexture = (material, name) => material.texture(name) ?? null;
export const InvalidTextureRef = null;
// Features are uniforms in two bounded forward programs, so updating a variant never compiles a shader.
export const UpdateMaterialPipelineProgramVariant = material => material.variantKey;
export const SetMaterialBlendMode = (m, value) => m.setState('blend_mode',value);
export const SetMaterialDepthTest = (m, value) => m.setState('depth_test',value);
export const SetMaterialFaceCulling = (m, value) => m.setState('face_culling',value);
export const SetMaterialWriteZ = (m, value) => m.setState('write_z',value);
export function SetMaterialWriteRGBA(m,r,g,b,a) {
  requireCondition([r,g,b,a].every(v => typeof v === 'boolean'),'INVALID_MATERIAL','Write masks require booleans');
  for (const [key,value] of [['r',r],['g',g],['b',b],['a',a]]) m.setState(`write_${key}`,value);
}
export function SetMaterialAlphaCut(m, enabled) {
  requireCondition(typeof enabled === 'boolean','INVALID_MATERIAL','Alpha cut requires a boolean');
  m.setState('flags', enabled ? ['EnableAlphaCut'] : []);
}
export const FC_Disabled='disabled', FC_Clockwise='cw', FC_CounterClockwise='ccw';
export const DT_Less='less', DT_LessEqual='leq', DT_Equal='eq', DT_GreaterEqual='geq', DT_Greater='greater', DT_NotEqual='neq', DT_Never='never', DT_Always='always', DT_Disabled='disabled';
export const BM_Additive='add', BM_Alpha='alpha', BM_Darken='darken', BM_Lighten='lighten', BM_Multiply='multiply', BM_Opaque='opaque', BM_Screen='screen', BM_LinearBurn='linearburn', BM_AlphaRGB_AddAlpha='alphaRGB_addAlpha';
