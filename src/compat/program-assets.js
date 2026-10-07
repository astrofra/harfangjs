import {integer,requireCondition} from '../core/errors.js';
import {validateLogicalPath} from '../profile.js';
import {profile} from './profile.js';
import {validateSceneJSON} from '../scene/schema.js';

export async function loadProgramAssets(manifestURL, signal, onProgress=()=>{}, maxAssetBytes=profile.limits.maxGPUBytes) {
  integer(maxAssetBytes,1,536870912,'asset byte budget');
  const url=new URL(manifestURL,document.baseURI);
  let loadedBytes=0,totalBytes=0,loadedAssets=0,totalAssets=0,failed=false;
  const notify=phase=>{
    if(!failed)onProgress({phase,loadedBytes,totalBytes,loadedAssets,totalAssets,
      percent:phase==='ready'?100:totalBytes?Math.min(99,Math.floor(100*loadedBytes/totalBytes)):0});
  };
  notify('manifest');
  const fetchBytes=async (target,entry) => {
    // Stable source filenames may acquire new bytes on every compiler run.
    const response=await fetch(target,{signal,cache:'no-store'});
    requireCondition(response.ok,'ASSET_FETCH_FAILED',`${response.status}: ${target}`);
    if(entry&&response.body) {
      // Manifest sizes describe decoded payloads, so gzip/Brotli do not distort
      // progress. Count stream chunks, including partially downloaded textures.
      const reader=response.body.getReader(),data=new Uint8Array(entry.byteLength);
      let offset=0,finished=false;
      try {
        while(true) {
          const {done,value}=await reader.read();
          if(done){finished=true;break;}
          requireCondition(offset+value.byteLength<=data.byteLength,'ASSET_INTEGRITY',`Corrupt ${entry.kind}: ${target}`);
          data.set(value,offset);offset+=value.byteLength;loadedBytes+=value.byteLength;notify('assets');
        }
        requireCondition(offset===data.byteLength,'ASSET_INTEGRITY',`Corrupt ${entry.kind}: ${target}`);
        return data.buffer;
      } finally {
        if(!finished)await reader.cancel().catch(()=>{});
        reader.releaseLock();
      }
    }
    const data=await response.arrayBuffer();
    requireCondition(data.byteLength<=profile.limits.maxResourceBytes,'ASSET_BUDGET','Program payload is too large');
    if(entry) {
      requireCondition(data.byteLength===entry.byteLength,'ASSET_INTEGRITY',`Corrupt ${entry.kind}: ${target}`);
      loadedBytes+=data.byteLength;notify('assets');
    }
    return data;
  };
  const manifest=JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  const sceneProfile=manifest.profile==='web-native-scene/1';
  requireCondition(manifest.schema===profile.assetSchema && (manifest.profile===profile.id||sceneProfile) && manifest.api===profile.api && manifest.maxNodes===profile.limits.maxNodes,
    'INCOMPATIBLE_MANIFEST','Expected native forward program assets');
  requireCondition(manifest.assets && Object.keys(manifest.assets).length>0,'INVALID_MANIFEST','No program assets');
  const programs=new Map(),scenes=new Map(),geometries=new Map(),textures=new Map();
  const entries=Object.entries(manifest.assets);totalAssets=entries.length;
  // Validate all sizes before starting payload requests or allocating buffers.
  for(const [id,entry] of entries) {
    validateLogicalPath(id); validateLogicalPath(entry.uri);
    requireCondition((entry.kind==='program'||sceneProfile&&['scene','geometry','texture'].includes(entry.kind)) && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.byteLength) && entry.byteLength>0 &&
      Array.isArray(entry.dependencies) && entry.dependencies.every(dep=>Object.hasOwn(manifest.assets,dep)),
      'INVALID_MANIFEST',`Invalid program entry: ${id}`);
    totalBytes+=entry.byteLength;
    requireCondition(entry.byteLength<=profile.limits.maxResourceBytes,'ASSET_BUDGET','Program payload is too large');
    requireCondition(totalBytes<=maxAssetBytes,'ASSET_BUDGET',`Compiled asset bundle exceeds ${maxAssetBytes/1048576} MiB`);
  }
  notify('assets');
  const loadAsset=async ([id,entry])=>{
    const bytes=await fetchBytes(new URL(entry.uri,url),entry);
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
      validateSceneJSON(program,{source:id,lighting:true,ignoreShadows:true,ambientEnvironment:true,maxNodes:profile.limits.maxNodes,
        instances:true,animationStubs:manifest.animationPlayback==='stub',nativeUniforms:true});
      requireCondition(!program.environment?.probe?.parallax,'UNSUPPORTED_SCENE_FEATURE','Parallax-corrected probes are unavailable');
      scenes.set(id,program);return;
    }
    if(entry.kind==='geometry') {
      requireCondition(program.schema==='harfang-web-geometry/1','INVALID_MESH',`Invalid compiled geometry: ${id}`);
      geometries.set(id,program);return;
    }
    const approved={
      'core/shader/default.hps':['default-spot-instanced/1','untextured-unskinned',profile.capabilities],
      'core/shader/pbr.hps':program.adapter==='pbr-scene-instanced/3'?
        ['pbr-scene-instanced/3','pbr-maps-unskinned',['render.forward','render.directional-shadow','render.spot-shadow','render.environment','render.textures','render.alpha-blend']]:program.adapter==='pbr-scene-instanced/2'?
        ['pbr-scene-instanced/2','pbr-maps-unskinned',['render.forward','render.directional-shadow','render.spot-shadow','render.environment','render.textures']]:
        ['pbr-scene-instanced/1','base-color-unskinned',['render.forward','render.directional-shadow','render.environment','render.textures']],
      'shaders/pos_rgb':['pos-rgb/1','color',['render.lines']]
    }[id];
    requireCondition(approved && program.schema==='harfang-web-program/1' && program.adapter===approved[0] && program.logicalId===id &&
      Array.isArray(program.variants) && program.variants.length===1 && program.variants[0]===approved[1] &&
      Array.isArray(program.requires) && program.requires.length===approved[2].length && approved[2].every(v=>program.requires.includes(v)),
      'UNSUPPORTED_PROGRAM',`Incompatible program descriptor: ${id}`);
    programs.set(id,program);
  };
  try {
    await Promise.all(entries.map(async entry=>{await loadAsset(entry);++loadedAssets;notify('assets');}));
  } catch(error) {
    failed=true; // Other in-flight requests must not replace the UI's error state.
    throw error;
  }
  notify('ready'); // 100% only after every payload passes integrity and decoding.
  return {manifest,programs,scenes,geometries,textures};
}
