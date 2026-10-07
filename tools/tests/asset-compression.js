import {decodeLZ4Block} from '../../src/compat/lz4.js';
import {loadProgramAssets} from '../../src/compat/program-assets.js';
import {profile} from '../../src/profile.js';

const check=(ok,label)=>{if(!ok)throw Error(label);};
const bytes=base64=>Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
const digest=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(v=>v.toString(16).padStart(2,'0')).join('');
async function rejects(fn,code) {
  try {await fn();} catch(error){check(error.code===code,`${code}: ${error.stack}`);return;}
  throw Error(`Expected ${code}`);
}

export async function run({vectors,manifest,raw,packed}) {
  for(const vector of vectors) {
    const decoded=decodeLZ4Block(bytes(vector.packed),vector.size);
    check(await digest(decoded)===vector.sha256,'Official LZ4 block round trip');
  }
  const malformed=[
    [[],0], [[0xf0],15], [[0xf0,255],1000], [[0x20,65],2], // missing lengths/literals
    [[0x10,65,1],10], [[0x10,65,0,0,0],10],             // truncated/zero offset
    [[0x10,65,2,0,0],10], [[0x1f,65,1,0,255],1000],    // outside history/match length
    [[0x10,65,1,0,0],4], [[0x10,65,1,0],5],            // overflow/missing final sequence
    [[0x10,65],2], [[0],profile.limits.maxResourceBytes+1], [[0],-1]
  ];
  for(const [input,size] of malformed)await rejects(()=>decodeLZ4Block(new Uint8Array(input),size),'ASSET_COMPRESSION');

  const id=Object.keys(manifest.assets)[0],originalFetch=globalThis.fetch;
  const rawBytes=bytes(raw),packedBytes=bytes(packed);
  const base=structuredClone(manifest),compressed=base.assets[id];
  compressed.compression='lz4-block';compressed.storedByteLength=packedBytes.length;
  compressed.storedSha256=await digest(packedBytes);
  let current,payloads,progress,requests,fallback=false;
  const reset=()=>{current=structuredClone(base);payloads=new Map([[id,packedBytes]]);progress=[];requests=[];fallback=false;};
  globalThis.fetch=async target=>{
    const path=new URL(target).pathname;
    if(path.endsWith('/manifest.json'))return new Response(JSON.stringify(current));
    const uri=path.slice('/compression-fixture/'.length);requests.push(uri);
    const key=Object.keys(current.assets).find(id=>current.assets[id].uri===uri);
    const data=payloads.get(key);check(data,'Unexpected request');
    if(fallback)return {ok:true,arrayBuffer:async()=>data.slice().buffer};
    // Exercise fragmented HTTP bodies, including short first and last chunks.
    let offset=0;
    return new Response(new ReadableStream({pull(controller){
      if(offset===data.length){controller.close();return;}
      const end=Math.min(offset+127,data.length);controller.enqueue(data.slice(offset,end));offset=end;
    }}));
  };
  const load=(budget)=>loadProgramAssets('/compression-fixture/manifest.json',undefined,p=>progress.push(p),budget);
  try {
    for(const uncompressed of [false,true])for(const noStream of [false,true]) {
      reset();fallback=noStream;
      if(uncompressed) {
        delete current.assets[id].compression;delete current.assets[id].storedByteLength;delete current.assets[id].storedSha256;
        payloads.set(id,rawBytes);
      }
      const result=await load();check(result.programs.size===1,'Program loaded');
      const size=uncompressed?rawBytes.length:packedBytes.length,last=progress.at(-1);
      check(last.phase==='ready'&&last.loadedBytes===size&&last.totalBytes===size&&last.percent===100,'Stored-byte progress');
      check(progress.every((p,i)=>!i||p.loadedBytes>=progress[i-1].loadedBytes),'Monotonic progress');
    }
    reset();current.profile='web-native-scene/1';
    current.assets[id].uri=id+'.lz4';
    const texture=Uint8Array.from({length:64},(_,i)=>i);
    current.assets['raw.png']={kind:'texture',uri:'raw.png',byteLength:64,sha256:await digest(texture),dependencies:[],
      format:'rgba8',faces:1,mips:1,levels:[{face:0,mip:0,width:4,height:4,offset:0,byteLength:64}]};
    payloads.set('raw.png',texture);
    check((await load()).textures.size===1,'Mixed compressed and raw bundle');

    for(const [field,value,code] of [
      ['compression','zstd','ASSET_COMPRESSION'],['storedByteLength',0,'INVALID_MANIFEST'],
      ['storedByteLength',rawBytes.length+1,'INVALID_MANIFEST'],['storedByteLength',1.5,'INVALID_MANIFEST'],
      ['storedSha256','bad','INVALID_MANIFEST'],['byteLength',profile.limits.maxResourceBytes+1,'ASSET_BUDGET']
    ]) {
      reset();current.assets[id][field]=value;await rejects(()=>load(),code);
      check(requests.length===0,'Invalid manifest rejected before asset fetch');
    }
    reset();await rejects(()=>load(rawBytes.length-1),'ASSET_BUDGET');
    check(requests.length===0,'Budget uses decoded size');
    for(const replacement of [packedBytes.slice(1),new Uint8Array(packedBytes.length+1)]) {
      reset();payloads.set(id,replacement);await rejects(()=>load(),'ASSET_INTEGRITY');
      check(!progress.some(p=>p.phase==='ready'),'Failed load cannot report ready');
    }
    reset();const corrupt=packedBytes.slice();corrupt[0]^=1;payloads.set(id,corrupt);
    await rejects(()=>load(),'ASSET_INTEGRITY');
    reset();current.assets[id].sha256='0'.repeat(64);await rejects(()=>load(),'ASSET_INTEGRITY');
    reset();delete current.assets[id].compression;await rejects(()=>load(),'INVALID_MANIFEST');
    reset();const invalid=new Uint8Array([0x10,65,0,0,0]);payloads.set(id,invalid);
    current.assets[id].storedByteLength=invalid.length;current.assets[id].storedSha256=await digest(invalid);
    await rejects(()=>load(),'ASSET_COMPRESSION');
  } finally {globalThis.fetch=originalFetch;}
  return {vectors:vectors.length,malformed:malformed.length,loader:'compressed/raw/mixed, streaming/fallback, hashes, budgets, progress, invalid metadata'};
}
