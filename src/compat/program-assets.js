import {requireCondition} from '../core/errors.js';
import {validateLogicalPath} from '../profile.js';
import {profile} from './profile.js';
import {validateSceneJSON} from '../scene/schema.js';

export async function loadProgramAssets(manifestURL, signal) {
  const url=new URL(manifestURL,document.baseURI);
  const fetchBytes=async target => {
    const response=await fetch(target,{signal});
    requireCondition(response.ok,'ASSET_FETCH_FAILED',`${response.status}: ${target}`);
    const data=await response.arrayBuffer();
    requireCondition(data.byteLength<=profile.limits.maxResourceBytes,'ASSET_BUDGET','Program payload is too large'); return data;
  };
  const manifest=JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const sceneProfile=manifest.profile==='web-native-scene/1';
  requireCondition(manifest.schema===profile.assetSchema && (manifest.profile===profile.id||sceneProfile) && manifest.api===profile.api && manifest.maxNodes===profile.limits.maxNodes,
    'INCOMPATIBLE_MANIFEST','Expected native forward program assets');
  requireCondition(manifest.assets && Object.keys(manifest.assets).length>0,'INVALID_MANIFEST','No program assets');
  const programs=new Map(),scenes=new Map(),geometries=new Map(),textures=new Map();
  let totalBytes=0;
  await Promise.all(Object.entries(manifest.assets).map(async ([id,entry]) => {
    validateLogicalPath(id); validateLogicalPath(entry.uri);
    requireCondition((entry.kind==='program'||sceneProfile&&['scene','geometry','texture'].includes(entry.kind)) && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.byteLength) && entry.byteLength>0 &&
      Array.isArray(entry.dependencies) && entry.dependencies.every(dep=>Object.hasOwn(manifest.assets,dep)),
      'INVALID_MANIFEST',`Invalid program entry: ${id}`);
    totalBytes+=entry.byteLength;
    requireCondition(totalBytes<=profile.limits.maxGPUBytes,'ASSET_BUDGET','Compiled asset bundle exceeds 128 MiB');
    const bytes=await fetchBytes(new URL(entry.uri,url));
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    requireCondition(bytes.byteLength===entry.byteLength && digest===entry.sha256,'ASSET_INTEGRITY',`Corrupt ${entry.kind}: ${id}`);
    if(entry.kind==='texture') {
      requireCondition(['rgba8','rgba16f'].includes(entry.format)&&[1,6].includes(entry.faces)&&Number.isInteger(entry.mips)&&entry.mips>=1&&entry.mips<=13&&
        Array.isArray(entry.levels)&&entry.levels.length===entry.faces*entry.mips,'INVALID_TEXTURE',`Invalid texture descriptor: ${id}`);
      let end=0;
      for(const [i,level] of entry.levels.entries()) {
        const {face,mip,width,height,offset,byteLength}=level,base=entry.levels[face*entry.mips];
        requireCondition(face===Math.floor(i/entry.mips)&&mip===i%entry.mips&&Number.isInteger(width)&&Number.isInteger(height)&&width>0&&height>0&&width<=4096&&height<=4096&&
          width===Math.max(1,base.width>>mip)&&height===Math.max(1,base.height>>mip)&&offset===end&&byteLength===width*height*(entry.format==='rgba16f'?8:4),
          'INVALID_TEXTURE',`Invalid texture mip: ${id}`);
        end+=byteLength;
      }
      requireCondition(end===bytes.byteLength,'INVALID_TEXTURE','Texture storage mismatch');
      textures.set(id,{...entry,bytes});return;
    }
    const program=JSON.parse(new TextDecoder().decode(bytes));
    if(entry.kind==='scene') {
      validateSceneJSON(program,{source:id,lighting:true,ignoreShadows:true,ambientEnvironment:true,maxNodes:profile.limits.maxNodes});
      scenes.set(id,program);return;
    }
    if(entry.kind==='geometry') {
      requireCondition(program.schema==='harfang-web-geometry/1','INVALID_MESH',`Invalid compiled geometry: ${id}`);
      geometries.set(id,program);return;
    }
    const approved={
      'core/shader/default.hps':['default-spot-instanced/1','untextured-unskinned',profile.capabilities],
      'core/shader/pbr.hps':['pbr-scene-instanced/1','base-color-unskinned',['render.forward','render.directional-shadow','render.environment','render.textures']],
      'shaders/pos_rgb':['pos-rgb/1','color',['render.lines']]
    }[id];
    requireCondition(approved && program.schema==='harfang-web-program/1' && program.adapter===approved[0] && program.logicalId===id &&
      Array.isArray(program.variants) && program.variants.length===1 && program.variants[0]===approved[1] &&
      Array.isArray(program.requires) && program.requires.length===approved[2].length && approved[2].every(v=>program.requires.includes(v)),
      'UNSUPPORTED_PROGRAM',`Incompatible program descriptor: ${id}`);
    programs.set(id,program);
  }));
  return {manifest,programs,scenes,geometries,textures};
}
