import {requireCondition} from '../core/errors.js';
import {profile} from '../profile.js';

// Independent LZ4 block, without a frame header or dictionary. Length and
// integrity are supplied by the asset manifest. Format: lz4/lz4 v1.10.0,
// doc/lz4_Block_format.md. All reads and writes are bounded before copying.
export function decodeLZ4Block(input, byteLength) {
  const valid=condition=>requireCondition(condition,'ASSET_COMPRESSION','Invalid LZ4 asset block');
  valid(input instanceof Uint8Array && input.length>0 && input.length<=profile.limits.maxResourceBytes);
  valid(Number.isSafeInteger(byteLength) && byteLength>=0 && byteLength<=profile.limits.maxResourceBytes);
  const output=new Uint8Array(byteLength);
  let source=0,target=0;
  const length=base=>{
    if(base!==15)return base;
    let extra;
    do {
      valid(source<input.length);extra=input[source++];base+=extra;
      valid(base<=byteLength);
    } while(extra===255);
    return base;
  };
  while(source<input.length) {
    const token=input[source++],literals=length(token>>>4);
    valid(source+literals<=input.length && target+literals<=output.length);
    output.set(input.subarray(source,source+literals),target);
    source+=literals;target+=literals;
    if(source===input.length) {
      valid(target===output.length);
      return output.buffer;
    }
    valid(source+2<=input.length);
    const offset=input[source]+input[source+1]*256;source+=2;
    valid(offset>0 && offset<=target);
    const match=length(token&15)+4;
    valid(target+match<=output.length);
    // Forward byte copies intentionally permit overlapping matches (offset 1
    // is run-length encoding); TypedArray.set alone would not preserve them.
    const end=target+match;
    while(target<end){output[target]=output[target-offset];++target;}
  }
  valid(false); // A block must end with a literal sequence, never a match.
}
