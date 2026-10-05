import {requireCondition} from '../core/errors.js';
import {validateLogicalPath} from '../profile.js';
import {profile} from './profile.js';

export async function loadProgramAssets(manifestURL, signal) {
  const url=new URL(manifestURL,document.baseURI);
  const fetchBytes=async target => {
    const response=await fetch(target,{signal});
    requireCondition(response.ok,'ASSET_FETCH_FAILED',`${response.status}: ${target}`);
    const data=await response.arrayBuffer();
    requireCondition(data.byteLength<=profile.limits.maxResourceBytes,'ASSET_BUDGET','Program payload is too large'); return data;
  };
  const manifest=JSON.parse(new TextDecoder().decode(await fetchBytes(url)));
  requireCondition(manifest.schema===profile.assetSchema && manifest.profile===profile.id && manifest.api===profile.api && manifest.maxNodes===profile.limits.maxNodes,
    'INCOMPATIBLE_MANIFEST','Expected native forward program assets');
  requireCondition(manifest.assets && Object.keys(manifest.assets).length>0,'INVALID_MANIFEST','No program assets');
  const programs=new Map();
  await Promise.all(Object.entries(manifest.assets).map(async ([id,entry]) => {
    validateLogicalPath(id); validateLogicalPath(entry.uri);
    requireCondition(entry.kind==='program' && /^[a-f0-9]{64}$/.test(entry.sha256) && Number.isSafeInteger(entry.byteLength) && entry.byteLength>0 &&
      Array.isArray(entry.dependencies) && entry.dependencies.length===0,
      'INVALID_MANIFEST',`Invalid program entry: ${id}`);
    const bytes=await fetchBytes(new URL(entry.uri,url));
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
    requireCondition(bytes.byteLength===entry.byteLength && digest===entry.sha256,'ASSET_INTEGRITY',`Corrupt program: ${id}`);
    const program=JSON.parse(new TextDecoder().decode(bytes));
    requireCondition(program.schema==='harfang-web-program/1' && program.adapter==='default-spot-instanced/1' && program.logicalId===id && id==='core/shader/default.hps' &&
      Array.isArray(program.variants) && program.variants.length===1 && program.variants[0]==='untextured-unskinned' &&
      Array.isArray(program.requires) && program.requires.length===3 && profile.capabilities.every(v=>program.requires.includes(v)),
      'UNSUPPORTED_PROGRAM',`Incompatible program descriptor: ${id}`);
    programs.set(id,program);
  }));
  return {manifest,programs};
}
