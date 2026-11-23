/** UUID compatibility must keep cryptographic entropy and the server's v4 format. */
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createUuid} from '../public/assets/ppms/uuid.js';

const originalCrypto=Object.getOwnPropertyDescriptor(globalThis,'crypto');
const useCrypto=value=>Object.defineProperty(globalThis,'crypto',{configurable:true,value});
const uuidV4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const checks=[];
try {
  let nativeCalls=0;
  const native={
    randomUUID(){assert.equal(this,native);nativeCalls++;return '00112233-4455-4677-8899-aabbccddeeff';},
    getRandomValues(){assert.fail('Native UUID support must remain usable');},
  };
  useCrypto(native);
  assert.equal(createUuid(),'00112233-4455-4677-8899-aabbccddeeff');
  assert.equal(nativeCalls,1);
  checks.push('Native UUID support keeps its Crypto receiver');

  const fallback={getRandomValues(bytes){
    assert.equal(this,fallback);
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes.length,16);
    bytes.set(Array.from({length:16},(_,index)=>index));
    return bytes;
  }};
  for(const unavailable of [undefined,null,false,'unsupported']) {
    fallback.randomUUID=unavailable;
    useCrypto(fallback);
    assert.equal(createUuid(),'00010203-0405-4607-8809-0a0b0c0d0e0f');
  }
  checks.push('Unavailable or non-callable randomUUID uses secure bytes with v4 and RFC variant bits');

  useCrypto({getRandomValues:bytes=>webcrypto.getRandomValues(bytes)});
  const ids=Array.from({length:4096},()=>createUuid());
  assert.ok(ids.every(id=>uuidV4.test(id)));
  assert.equal(new Set(ids).size,ids.length);
  checks.push('Real secure fallback produces 4,096 distinct, server-compatible UUIDs');

  for(const unavailable of [undefined,null,{}, {randomUUID:undefined,getRandomValues:null}]) {
    useCrypto(unavailable);
    assert.throws(()=>createUuid(),error=>error.code==='SECURE_RANDOM_UNAVAILABLE');
  }
  checks.push('Missing cryptographic randomness fails closed without a weak identifier');

  const failure=new Error('Entropy provider failed');
  useCrypto({getRandomValues(){throw failure;}});
  assert.throws(()=>createUuid(),error=>error===failure);
  checks.push('Entropy provider failures cannot fall back to predictable values');
} finally {
  if(originalCrypto)Object.defineProperty(globalThis,'crypto',originalCrypto);
  else delete globalThis.crypto;
}
console.log(JSON.stringify({passed:checks.length,checks},null,2));
