/** Encrypted local vault and durable, original-author synchronization. No bearer token is stored. */
import { createUuid as uuid } from './uuid.js';

export const SyncStatus = Object.freeze({SAVED_LOCALLY:'SAVED_LOCALLY',PENDING_SYNC:'PENDING_SYNC',SYNCING:'SYNCING',SYNCED:'SYNCED',FAILED:'FAILED',CONFLICT:'CONFLICT'});
const DB_NAME = 'ppms-offline-v1';
const ENCODER = new TextEncoder();
const DECODER = new TextDecoder();
const KDF_ITERATIONS = 600000;
const dirty = value => value && value.status !== SyncStatus.SYNCED;
const clone = value => structuredClone(value);
const message = (code, details) => Object.assign(new Error(code), {code,error:code,details});
const bytes = value => ENCODER.encode(JSON.stringify(value)).byteLength;
const encode64 = value => {const data=new Uint8Array(value);let text='';for(let i=0;i<data.length;i+=16384)text+=String.fromCharCode(...data.subarray(i,i+16384));return btoa(text);};
const decode64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const complete = transaction => new Promise((resolve,reject) => { transaction.oncomplete=resolve; transaction.onabort=()=>reject(transaction.error || message('LOCAL_WRITE_ABORTED')); transaction.onerror=()=>reject(transaction.error || message('LOCAL_WRITE_FAILED')); });
const result = request => new Promise((resolve,reject) => {request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);});
const transaction = (db, stores, mode='readonly') => {try{return db.transaction(stores,mode,{durability:mode==='readwrite'?'strict':'default'});}catch{return db.transaction(stores,mode);}};
const logicalContext = context => ({ppmFormId:context.ppmFormId,deviceId:context.deviceId,leaseVersion:Number(context.leaseVersion)});
const scopeKey = context => `${context.ppmFormId}:${context.deviceId}:${context.leaseVersion}`;
const batchLimit = value => Number.isInteger(Number(value)) && Number(value)>0 ? Math.min(500,Number(value)) : 50;
const entityId = envelope => envelope.id || envelope.record?.id;
const businessDate = timezone => {const parts=new Intl.DateTimeFormat('en',{timeZone:timezone || 'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const date=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${date.year}-${date.month}-${date.day}`;};
const checkLocalGeneration = (local,expected,editorSessionId) => {
  if(expected===undefined)return;
  if(!Number.isInteger(expected) || expected<0)throw message('INVALID_LOCAL_EDIT_VERSION');
  if(expected!==(local?.localEditVersion || 0) && (!editorSessionId || local?.editorSessionId!==editorSessionId)){
    throw message('LOCAL_DRAFT_CHANGED',{recordId:local?.id,currentLocalEditVersion:local?.localEditVersion || 0});
  }
};

function openDatabase() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      db.createObjectStore('vaults',{keyPath:'userId'});
      const entries=db.createObjectStore('entries',{keyPath:'key'});
      entries.createIndex('scope','scope',{unique:false});
      entries.createIndex('userId','userId',{unique:false});
    };
    request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close(); resolve(request.result);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(message('LOCAL_DATABASE_UPGRADE_BLOCKED'));
  });
}
async function derive(passphrase,salt,iterations) {
  const material=await crypto.subtle.importKey('raw',ENCODER.encode(passphrase.normalize('NFKC')),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encrypt(key,value,aad) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:ENCODER.encode(aad)},key,ENCODER.encode(JSON.stringify(value)));
  return {iv:encode64(iv),data:encode64(new Uint8Array(data))};
}
async function decrypt(key,value,aad) {
  const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode64(value.iv),additionalData:ENCODER.encode(aad)},key,decode64(value.data));
  return JSON.parse(DECODER.decode(data));
}

export class OfflineStore {
  static async open(options, passphrase) {
    if (typeof options==='string') options={userId:options,passphrase};
    const {userId}=options || {}; const secret=options?.passphrase ?? options?.pin;
    if (!globalThis.crypto?.subtle || !globalThis.indexedDB) throw message('SECURE_OFFLINE_STORAGE_UNAVAILABLE');
    if (typeof userId!=='string' || !userId || typeof secret!=='string' || secret.length<8) throw message('OFFLINE_PASSPHRASE_MINIMUM_8_CHARACTERS');
    const db=await openDatabase();
    const initialize=async()=>{
      let meta=await result(transaction(db,'vaults').objectStore('vaults').get(userId));
      if (meta) {
        const key=await derive(secret,decode64(meta.salt),meta.iterations);
        try {const check=await decrypt(key,meta.check,`vault:${userId}`); if(check.value!=='PPMS_VAULT_V1') throw new Error();}
        catch {db.close(); throw message('OFFLINE_UNLOCK_FAILED');}
        return new OfflineStore(db,userId,key);
      }
      const salt=crypto.getRandomValues(new Uint8Array(16)); const key=await derive(secret,salt,KDF_ITERATIONS);
      meta={userId,salt:encode64(salt),iterations:KDF_ITERATIONS,createdAt:new Date().toISOString(),check:await encrypt(key,{value:'PPMS_VAULT_V1'},`vault:${userId}`)};
      const tx=transaction(db,'vaults','readwrite'); tx.objectStore('vaults').add(meta); await complete(tx);
      return new OfflineStore(db,userId,key);
    };
    const store=globalThis.navigator?.locks ? await navigator.locks.request(`ppms-vault-init:${userId}`,initialize) : await initialize();
    store.persistent=globalThis.navigator?.storage?.persist ? await navigator.storage.persist().catch(()=>false) : false;
    return store;
  }
  static async restore(bundle,passphrase) {
    if(bundle?.format!=='ppms-encrypted-vault-v1' || !bundle.vault?.userId || !Array.isArray(bundle.entries)
        || bundle.entries.length>50000 || bytes(bundle)>67108864)throw message('INVALID_OFFLINE_BACKUP');
    const meta=bundle.vault,userId=meta.userId;
    if(typeof userId!=='string' || userId.length>191 || typeof passphrase!=='string' || passphrase.length<8
        || meta.iterations!==KDF_ITERATIONS || decode64(meta.salt).length!==16 || !Number.isSafeInteger(meta.version || 0) || (meta.version || 0)<0)throw message('INVALID_OFFLINE_BACKUP');
    const key=await derive(passphrase,decode64(meta.salt),meta.iterations);
    try{if((await decrypt(key,meta.check,`vault:${userId}`)).value!=='PPMS_VAULT_V1')throw new Error();}
    catch{throw message('OFFLINE_UNLOCK_FAILED');}
    const keys=new Set();
    for(const entry of bundle.entries){
      if(entry.userId!==userId || typeof entry.scope!=='string' || !entry.scope.startsWith(`${userId}:`)
          || typeof entry.key!=='string' || !entry.key.startsWith(`${entry.scope}:`) || keys.has(entry.key))throw message('INVALID_OFFLINE_BACKUP');
      keys.add(entry.key);
      try{await decrypt(key,entry,entry.key);}catch{throw message('OFFLINE_BACKUP_INTEGRITY_FAILED');}
    }
    const db=await openDatabase();
    try{
      if(await result(transaction(db,'vaults').objectStore('vaults').get(userId)))throw message('EXISTING_VAULT_MUST_NOT_BE_OVERWRITTEN');
      const tx=transaction(db,['vaults','entries'],'readwrite');const done=complete(tx);
      tx.objectStore('vaults').add(meta);for(const entry of bundle.entries)tx.objectStore('entries').add(entry);await done;
    }finally{db.close();}
    return OfflineStore.open({userId,passphrase});
  }
  static async listVaults() {
    const db=await openDatabase(); const values=await result(transaction(db,'vaults').objectStore('vaults').getAll()); db.close();
    return values.map(({userId,createdAt})=>({userId,createdAt}));
  }
  constructor(db,userId,key) {this.db=db;this.userId=userId;this.key=key;this.serial=Promise.resolve();this.persistent=false;}
  assertUnlocked() {if(!this.key) throw message('OFFLINE_VAULT_LOCKED');}
  keyFor(kind,id) {return `${this.userId}:${kind}:${id}`;}
  async exclusive(work) {
    const execute=async()=>{const meta=await result(transaction(this.db,'vaults').objectStore('vaults').get(this.userId));this.writeVersion=meta.version || 0;return work();};
    const run=async()=>{this.assertUnlocked();return globalThis.navigator?.locks ? navigator.locks.request(`ppms-vault:${this.userId}`,execute) : execute();};
    const promise=this.serial.then(run,run); this.serial=promise.catch(()=>{}); return promise;
  }
  async get(kind,id) {
    this.assertUnlocked(); const row=await result(transaction(this.db,'entries').objectStore('entries').get(this.keyFor(kind,id)));
    return row ? decrypt(this.key,row,row.key) : null;
  }
  async list(kind) {
    this.assertUnlocked(); const rows=await result(transaction(this.db,'entries').objectStore('entries').index('scope').getAll(`${this.userId}:${kind}`));
    return Promise.all(rows.map(row=>decrypt(this.key,row,row.key)));
  }
  async write(puts=[],removes=[]) {
    this.assertUnlocked();
    // Encrypt before opening the transaction. Crypto awaits cannot accidentally auto-commit half a queue update.
    const rows=await Promise.all(puts.map(async ({kind,id,value})=>{
      const key=this.keyFor(kind,id);return {key,userId:this.userId,scope:`${this.userId}:${kind}`,...await encrypt(this.key,value,key)};
    }));
    const tx=transaction(this.db,['vaults','entries'],'readwrite');const done=complete(tx);let conflict=false;
    const request=tx.objectStore('vaults').get(this.userId);
    request.onsuccess=()=>{
      const meta=request.result;
      if((meta.version || 0)!==this.writeVersion){conflict=true;tx.abort();return;}
      tx.objectStore('vaults').put({...meta,version:this.writeVersion+1});
      const entries=tx.objectStore('entries');rows.forEach(row=>entries.put(row));removes.forEach(({kind,id})=>entries.delete(this.keyFor(kind,id)));
    };
    try{await done;}catch(error){if(conflict)throw message('LOCAL_CONCURRENT_CHANGE');throw error;}
    this.writeVersion++;

  }
  async put(kind,id,value) {return this.exclusive(()=>this.write([{kind,id,value}]));}
  async remove(kind,id) {
    if (['records','queue','batches'].includes(kind)) throw message('USE_SAFE_RECORD_OR_QUEUE_OPERATION');
    return this.exclusive(()=>this.write([],[{kind,id}]));
  }
  async saveDraft(record) {
    return this.exclusive(async()=>{
      const id=entityId(record);if(!id) throw message('RECORD_ID_REQUIRED');
      const old=await this.get('records',id);
      checkLocalGeneration(old,record.expectedLocalEditVersion,record.editorSessionId);
      const value={...old,...clone(record),id,ppmFormId:record.ppmFormId || record.record?.ppmFormId || old?.ppmFormId,
        editorSessionId:typeof record.editorSessionId==='string' ? record.editorSessionId : null,
        dataJson:clone(record.dataJson ?? record.revision?.dataJson ?? old?.dataJson ?? {}),
        localBaseRevisionNo:Number(record.localBaseRevisionNo ?? record.editBaseRevisionNo ?? (dirty(old)?(old.localBaseRevisionNo ?? 0):undefined) ?? record.revision?.revisionNo ?? record.serverRevisionNo ?? record.record?.currentRevisionNo ?? old?.localBaseRevisionNo ?? 0),
        status:old?.status && old.status!==SyncStatus.SYNCED ? old.status : SyncStatus.SAVED_LOCALLY,
        localEditVersion:(old?.localEditVersion || 0)+1,updatedLocallyAt:new Date().toISOString()};
      if(!Number.isInteger(value.localBaseRevisionNo) || value.localBaseRevisionNo<0)throw message('INVALID_BASE_REVISION');
      delete value.expectedLocalEditVersion;
      await this.write([{kind:'records',id,value}]);return value;
    });
  }
  async listRecords(ppmFormId) {return (await this.list('records')).filter(row=>!ppmFormId || row.ppmFormId===ppmFormId).sort((a,b)=>(b.updatedLocallyAt||b.record?.updatedAt||'').localeCompare(a.updatedLocallyAt||a.record?.updatedAt||''));}
  async queueMutation(context, supplied) {
    return this.exclusive(async()=>{
      const input=clone(supplied); const userId=input.userId || context.userId || context.user?.id || this.userId;
      if(userId!==this.userId) throw message('ORIGINAL_AUTHOR_MISMATCH');
      if(!context.ppmFormId || !context.deviceId || !Number.isInteger(Number(context.leaseVersion))) throw message('DEVICE_ASSIGNMENT_REQUIRED');
      if(!input.recordId) throw message('RECORD_ID_REQUIRED');
      const form=await this.get('forms',context.ppmFormId);
      const permission=input.operationType==='CREATE_DRAFT'?'canCreate':'canEdit';
      if(form?.permissions?.[permission]===false)throw message('OFFLINE_PERMISSION_DENIED');
      const all=(await this.list('queue')).filter(q=>q.mutation.recordId===input.recordId).sort((a,b)=>a.order-b.order);
      if (input.operationType!=='CONFLICT_RESOLUTION' && all.some(q=>['FAILED','CONFLICT'].includes(q.status) && !q.resolved)) throw message('MUTATION_RECONCILIATION_REQUIRED');
      const pending=all.filter(q=>['PENDING_SYNC','SYNCING'].includes(q.status));
      const last=input.operationType==='CONFLICT_RESOLUTION'?null:pending.at(-1);const local=await this.get('records',input.recordId);
      checkLocalGeneration(local,context.expectedLocalEditVersion,context.editorSessionId);
      const editorSessionId=typeof context.editorSessionId==='string' ? context.editorSessionId : null;
      const sameEditor=Boolean(editorSessionId && last?.editorSessionId===editorSessionId);
      if(input.operationType==='CREATE_DRAFT' && pending.some(q=>q.mutation.operationType==='CREATE_DRAFT'))input.operationType='UPDATE_DRAFT';
      let base=Number(input.baseRevisionNo ?? local?.localBaseRevisionNo ?? local?.serverRevisionNo ?? local?.record?.currentRevisionNo ?? 0);
      let prior=null;
      if(last && sameEditor && !last.batchId && last.mutation.userId===userId && ['CREATE_DRAFT','UPDATE_DRAFT'].includes(last.mutation.operationType)
          && input.operationType==='UPDATE_DRAFT' && scopeKey(last.context)===scopeKey(context)) {
        prior=last;base=last.mutation.baseRevisionNo;
        Object.assign(input,{operationType:last.mutation.operationType,clientMutationId:last.id});
      } else if(last && sameEditor) {base=Math.max(base,last.mutation.baseRevisionNo+1);}
      if(!Number.isInteger(base) || base<0) throw message('INVALID_BASE_REVISION');
      const id=input.clientMutationId || uuid();
      const existing=await this.get('queue',id);
      if(existing && existing!==prior && (!prior || existing.id!==prior.id))throw message('LOCAL_MUTATION_ID_REUSED');
      const mutation={...(prior?.mutation || {}),...input,clientMutationId:id,userId,baseRevisionNo:base};
      if(last && sameEditor && !prior) mutation.dependsOnMutationId=last.id;
      if(context.authorProof) mutation.authorProof=context.authorProof;
      const counter=(await this.get('settings','queueCounter')) || 0;
      const localEditVersion=(local?.localEditVersion || 0)+1;
      const queued={id,context:logicalContext(context),mutation,status:SyncStatus.PENDING_SYNC,order:prior?.order ?? counter+1,
        editorSessionId,
        localEditVersion,createdAt:prior?.createdAt || new Date().toISOString(),batchId:null};
      const envelope={...local,id:input.recordId,ppmFormId:context.ppmFormId,dataJson:clone(input.dataJson ?? local?.dataJson ?? {}),
        editorSessionId,localEditVersion,localBaseRevisionNo:base,
        status:SyncStatus.PENDING_SYNC,error:null,updatedLocallyAt:new Date().toISOString(),pendingDeletion:input.operationType==='DELETE_RECORD'};
      await this.write([{kind:'queue',id,value:queued},{kind:'records',id:input.recordId,value:envelope},
        {kind:'settings',id:'queueCounter',value:prior?counter:counter+1}]);
      return {mutationId:id,recordId:input.recordId,status:SyncStatus.PENDING_SYNC,baseRevisionNo:base};
    });
  }
  async removeDraft(id) {
    return this.exclusive(async()=>{
      const local=await this.get('records',id);
      const queue=(await this.list('queue')).filter(q=>q.mutation.recordId===id && !['SYNCED','RESOLVED'].includes(q.status));
      if(dirty(local)||queue.length) throw message('UNSYNCHRONIZED_RECORD_PROTECTED');
      await this.write([],[{kind:'records',id}]);
    });
  }
  async exportVault() {
    this.assertUnlocked(); const tx=transaction(this.db,['vaults','entries']);
    const [vault,entries]=await Promise.all([result(tx.objectStore('vaults').get(this.userId)),result(tx.objectStore('entries').index('userId').getAll(this.userId))]);
    return {format:'ppms-encrypted-vault-v1',exportedAt:new Date().toISOString(),vault,entries};
  }
  async lock() {await this.serial;this.key=null;this.db.close();}
}

/** Applying an older feed page must never roll back a newer data revision or pending local edits. */
export function mergeProjection(local, projection, sequence='0') {
  const id=projection?.record?.id;if(!id)return local;
  const incoming=Number(projection.record.currentRevisionNo || projection.revision?.revisionNo || 0);
  const known=Number(local?.serverRevisionNo || local?.server?.record?.currentRevisionNo || 0);
  const oldSequence=BigInt(local?.lastEventSequence || '0'),nextSequence=BigInt(sequence || '0');
  if(incoming<known || (incoming===known && nextSequence<oldSequence)) return local;
  const isDeleted=Boolean(projection.deleted || projection.record.archivedAt);
  const value={...local,id,ppmFormId:projection.record.ppmFormId,server:clone(projection),serverRevisionNo:incoming,
    lastEventSequence:String(nextSequence>oldSequence?nextSequence:oldSequence),record:clone(projection.record),revision:clone(projection.revision),
    reviewReference:clone(projection.reviewReference || null),traceLinks:clone(projection.traceLinks || []),revalidations:clone(projection.revalidations || [])};
  if(dirty(local)) {
    value.localBaseRevisionNo=Number(local.localBaseRevisionNo ?? 0);
    if(isDeleted){value.remoteDeleted=true;value.status=SyncStatus.CONFLICT;value.error='RECORD_DELETED_ON_SERVER';}
  } else {value.dataJson=clone(projection.revision?.dataJson || {});value.localBaseRevisionNo=incoming;value.traceSelections=(projection.traceLinks || []).map(link=>({connectionId:link.connectionId,sourceTraceOutputId:link.sourceTraceOutputId,inputPath:link.downstreamInputKey}));value.status=SyncStatus.SYNCED;value.deleted=isDeleted;value.remoteDeleted=false;}
  return value;
}

export class SyncEngine {
  constructor({store,request,onStatus=()=>{}}) {this.store=store;this.request=request;this.onStatus=onStatus;this.context=null;this.running=null;this.timer=null;this.stopped=true;this.online=()=>this.sync().catch(()=>{});}
  async configure(context) {
    if(context.user?.id && context.user.id!==this.store.userId) throw message('ORIGINAL_AUTHOR_MISMATCH');
    this.context={...context,userId:context.userId || context.user?.id || this.store.userId};
    await this.store.exclusive(async()=>{
      const old=await this.store.get('settings',`context:${context.ppmFormId}`);
      const puts=[{kind:'settings',id:`context:${context.ppmFormId}`,value:this.context}];
      if(old && scopeKey(old)!==scopeKey(this.context))puts.push({kind:'settings',id:`needsBootstrap:${context.ppmFormId}`,value:true});
      await this.store.write(puts);
    });
    return this.context;
  }
  requireContext(){if(!this.context)throw message('SYNC_CONTEXT_REQUIRED');return this.context;}
  async call(path,body,method='POST') {const c=this.requireContext();return this.request(path,{method,body,deviceToken:c.deviceToken});}
  notify(status,details={}){this.onStatus({status,ppmFormId:this.context?.ppmFormId,...details});}
  start(){this.stopped=false;globalThis.addEventListener?.('online',this.online);this.schedule(1000);}
  stop(){this.stopped=true;clearTimeout(this.timer);globalThis.removeEventListener?.('online',this.online);}
  schedule(delay=15000){clearTimeout(this.timer);if(!this.stopped)this.timer=setTimeout(()=>this.sync().catch(()=>{}),delay);}
  async bootstrap() {
    const c=this.requireContext();let pageToken;const snapshotId=uuid();
    do {
      const page=await this.call('/sync/bootstrap',{...logicalContext(c),...(pageToken?{pageToken}:{})});
      if(page.maxBatchSize!==undefined)this.context={...this.context,maxBatchSize:batchLimit(page.maxBatchSize)};
      await this.store.exclusive(async()=>{
        const puts=[];
        const cachedForm=await this.store.get('forms',c.ppmFormId);
        puts.push({kind:'forms',id:c.ppmFormId,value:{...cachedForm,...page.form,areaAssignments:page.areaAssignments,personnel:page.personnel,plantTimezone:page.plantTimezone}});
        puts.push({kind:'connections',id:c.ppmFormId,value:page.connections});
        for(const template of page.templates)puts.push({kind:'templates',id:template.id,value:template});
        const own=page.sources.find(source=>source.sourcePpmFormId===c.ppmFormId);
        for(const projection of page.records){const old=await this.store.get('records',projection.record.id);const value=mergeProjection(old,projection,own?.sequence || '0');puts.push({kind:'records',id:projection.record.id,value:{...value,snapshotId}});}
        for(const source of page.sources)for(const output of source.outputs)puts.push({kind:'outputs',id:`${c.ppmFormId}:${output.id}`,value:{...output,targetPpmFormId:c.ppmFormId,sourcePpmFormId:source.sourcePpmFormId,snapshotId}});
        puts.push({kind:'settings',id:`bootstrap:${c.ppmFormId}`,value:{snapshotId,pageToken:page.pageToken,complete:!page.hasMore}});
        if(!page.hasMore){
          // Persist the complete snapshot and its ack proofs atomically before acknowledging any boundary.
          for(const source of page.sources)puts.push({kind:'cursors',id:`${c.ppmFormId}:${source.sourcePpmFormId}`,value:{sourcePpmFormId:source.sourcePpmFormId,sequence:source.sequence,cursorToken:source.cursorToken,needsAck:true}});
          puts.push({kind:'settings',id:`sources:${c.ppmFormId}`,value:page.sources.map(source=>source.sourcePpmFormId)});
          puts.push({kind:'settings',id:`needsBootstrap:${c.ppmFormId}`,value:false});
        }
        const removes=[];
        if(!page.hasMore){
          const written=new Set(puts.map(p=>`${p.kind}:${p.id}`));
          for(const output of await this.store.list('outputs'))if(output.targetPpmFormId===c.ppmFormId && output.snapshotId!==snapshotId && !written.has(`outputs:${c.ppmFormId}:${output.id}`))removes.push({kind:'outputs',id:`${c.ppmFormId}:${output.id}`});
          // Evict only synchronized cache entries absent from the complete current cache window.
          for(const record of await this.store.list('records'))if(record.ppmFormId===c.ppmFormId && !dirty(record) && record.snapshotId!==snapshotId && !written.has(`records:${record.id}`))removes.push({kind:'records',id:record.id});
        }
        await this.store.write(puts,removes);
      });
      pageToken=page.pageToken;
      if(!page.hasMore)break;
      if(!pageToken)throw message('INVALID_BOOTSTRAP_PAGE');
    } while(true);
    await this.acknowledgePending();
    await this.pull();
    this.notify('READY');
  }
  async acknowledgePending() {
    const c=this.requireContext();
    const sources=await this.store.get('settings',`sources:${c.ppmFormId}`) || [];
    for(const source of sources){
      const id=`${c.ppmFormId}:${source}`;const cursor=await this.store.get('cursors',id);if(!cursor?.needsAck)continue;
      const acknowledged=await this.call('/sync/ack',{...logicalContext(c),cursorToken:cursor.cursorToken});
      if(BigInt(acknowledged.lastEventSequence)<BigInt(cursor.sequence))throw message('CURSOR_ACKNOWLEDGEMENT_INCOMPLETE');
      await this.store.put('cursors',id,{...cursor,needsAck:false});
    }
  }
  async pull() {
    const c=this.requireContext();await this.acknowledgePending();
    const sources=await this.store.get('settings',`sources:${c.ppmFormId}`) || [];
    for(const source of sources){
      let more=true;
      while(more){
        const cursorId=`${c.ppmFormId}:${source}`;const cursor=await this.store.get('cursors',cursorId);
        const page=await this.call('/sync/pull',{...logicalContext(c),sourcePpmFormId:source,afterSequence:cursor?.sequence || '0',limit:100});
        await this.store.exclusive(async()=>{
          const puts=[];const staged=new Map();
          for(const event of page.events){
            const projection=event.payloadJson;
            if(projection?.record?.id){
              const id=projection.record.id;const old=staged.get(id) || await this.store.get('records',id);
              staged.set(id,mergeProjection(old,projection,event.sequence));
            } else if(event.eventType==='TEMPLATE_PUBLISHED' && projection?.id)puts.push({kind:'templates',id:projection.id,value:projection});
            else if(['TRACE_OUTPUT_PUBLISHED','TRACE_OUTPUT_RETIRED'].includes(event.eventType) && projection?.id){
              const id=`${c.ppmFormId}:${projection.id}`;const old=await this.store.get('outputs',id);
              puts.push({kind:'outputs',id,value:{...old,...projection,sourcePpmFormId:source,targetPpmFormId:c.ppmFormId,lastEventSequence:event.sequence}});
            }
          }
          staged.forEach((value,id)=>puts.push({kind:'records',id,value}));
          puts.push({kind:'cursors',id:cursorId,value:{sourcePpmFormId:source,sequence:page.nextSequence,cursorToken:page.cursorToken,needsAck:true}});
          await this.store.write(puts);
        });
        await this.acknowledgePending();more=page.hasMore;
      }
    }
  }
  async sealBatch() {
    const c=this.requireContext();
    return this.store.exclusive(async()=>{
      const existing=(await this.store.list('batches')).filter(b=>b.state!=='COMPLETE' && scopeKey(b.request)===scopeKey(c)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt))[0];
      if(existing)return existing;
      const queue=(await this.store.list('queue')).filter(q=>q.status===SyncStatus.PENDING_SYNC && !q.batchId && scopeKey(q.context)===scopeKey(c)).sort((a,b)=>a.order-b.order);
      if(!queue.length)return null;
      const id=uuid();const selected=[];const body={id,...logicalContext(c),businessDate:businessDate(c.plantTimezone),mutations:[]};
      for(const entry of queue){
        if(selected.length>=batchLimit(c.maxBatchSize))break;
        const mutation=clone(entry.mutation);
        if(c.authorProof && mutation.userId===c.userId)mutation.authorProof=c.authorProof;
        const candidate={...body,mutations:[...body.mutations,mutation]};
        if(bytes(candidate)>1900000){if(!selected.length)throw message('OFFLINE_MUTATION_TOO_LARGE');break;}
        body.mutations.push(mutation);selected.push(entry);
      }
      const batch={id,request:body,mutationIds:selected.map(q=>q.id),state:'PENDING',createdAt:new Date().toISOString(),attempts:0,nextAttemptAt:0};
      const puts=[{kind:'batches',id,value:batch}];
      for(const entry of selected)puts.push({kind:'queue',id:entry.id,value:{...entry,batchId:id}});
      await this.store.write(puts);return batch;
    });
  }
  async applyBatch(batch,response) {
    if(response?.id!==batch.id || !Array.isArray(response.results))throw message('INVALID_SYNC_RESPONSE');
    const byId=new Map(response.results.filter(r=>r.clientMutationId).map(r=>[r.clientMutationId,r]));
    for(const mutation of batch.request.mutations){
      const outcome=byId.get(mutation.clientMutationId);
      if(!outcome){if(response.recovered===true)continue;throw message('INVALID_SYNC_RESPONSE');}
      if(!['APPLIED','CONFLICT','REJECTED'].includes(outcome.status))throw message('INVALID_SYNC_RESPONSE');
      if(outcome.status==='APPLIED' && (typeof outcome.receiptId!=='string' || !outcome.receiptId || outcome.recordId!==mutation.recordId || !Number.isInteger(outcome.revisionNo) || outcome.revisionNo<1))throw message('INVALID_SYNC_RESPONSE');
      if(outcome.status==='CONFLICT' && typeof outcome.conflictId!=='string')throw message('INVALID_SYNC_RESPONSE');
    }
    await this.store.exclusive(async()=>{
      const puts=[];const queue=await this.store.list('queue');const records=new Map();
      for(const id of batch.mutationIds){
        const entry=queue.find(q=>q.id===id);if(!entry)throw message('LOCAL_MUTATION_MISSING');
        const outcome=byId.get(id);
        const validApplied=outcome?.status==='APPLIED' && typeof outcome.receiptId==='string' && outcome.recordId===entry.mutation.recordId && Number.isInteger(outcome.revisionNo);
        const status=validApplied?SyncStatus.SYNCED:outcome?.status==='CONFLICT'?SyncStatus.CONFLICT:SyncStatus.FAILED;
        const value={...entry,status,outcome:clone(outcome || {error:'SERVER_OUTCOME_MISSING'}),finishedAt:new Date().toISOString()};
        puts.push({kind:'queue',id,value});Object.assign(entry,value);
        const recordId=entry.mutation.recordId;const local=records.get(recordId)||await this.store.get('records',recordId)||{id:recordId,ppmFormId:entry.context.ppmFormId};
        if(validApplied){
          if(entry.mutation.operationType==='CONFLICT_RESOLUTION'){
            for(const old of queue)if(old.status===SyncStatus.CONFLICT && old.outcome?.conflictId===entry.mutation.conflictId){old.status='RESOLVED';old.resolved=true;puts.push({kind:'queue',id:old.id,value:old});}
          }
          local.serverRevisionNo=Math.max(local.serverRevisionNo || 0,outcome.revisionNo);
          // Storage ordering alone does not prove that another tab's newer draft descends from this edit.
          // Promote the edit base only for this exact snapshot or a proven same-editor descendant.
          if((local.localEditVersion||0)<=(entry.localEditVersion||0)
              || (entry.editorSessionId && entry.editorSessionId===local.editorSessionId)){
            local.localBaseRevisionNo=Math.max(local.localBaseRevisionNo ?? entry.mutation.baseRevisionNo,outcome.revisionNo);
          }
          if(entry.mutation.operationType==='CONFLICT_RESOLUTION' && entry.mutation.resolutionType==='KEEP_SERVER'
              && Number(local.server?.record?.currentRevisionNo)===outcome.revisionNo && (local.localEditVersion||0)<=(entry.localEditVersion||0)){
            local.dataJson=clone(local.server.revision?.dataJson || {});
            local.traceSelections=(local.server.traceLinks || []).map(link=>({connectionId:link.connectionId,sourceTraceOutputId:link.sourceTraceOutputId,inputPath:link.downstreamInputKey}));
          }
          local.record={...local.record,id:recordId,currentRevisionNo:local.serverRevisionNo};
          local.lastReceiptId=outcome.receiptId;
          if(entry.mutation.operationType==='DELETE_RECORD'){local.deleted=true;local.pendingDeletion=false;}
          // A newer unsent edit stays local even when an earlier immutable batch has committed.
          local.status=(local.localEditVersion||0)>(entry.localEditVersion||0)?SyncStatus.SAVED_LOCALLY:SyncStatus.SYNCED;
          local.error=null;
        }else{local.status=status;local.error=outcome?.status==='CONFLICT'?{error:'REVISION_CONFLICT',...clone(outcome)}:outcome?.error || 'SERVER_OUTCOME_MISSING';if(outcome?.conflictId){local.conflictId=outcome.conflictId;local.conflict=clone(outcome);}}
        records.set(recordId,local);
      }
      for(const [id,local] of records){
        const outstanding=queue.filter(q=>q.mutation.recordId===id && !q.resolved && ['PENDING_SYNC','SYNCING','FAILED','CONFLICT'].includes(q.status));
        if(outstanding.some(q=>q.status==='CONFLICT'))local.status=SyncStatus.CONFLICT;
        else if(outstanding.some(q=>q.status==='FAILED'))local.status=SyncStatus.FAILED;
        else if(outstanding.length)local.status=SyncStatus.PENDING_SYNC;
        puts.push({kind:'records',id,value:local});
      }
      puts.push({kind:'batches',id:batch.id,value:{...batch,state:'COMPLETE',response:clone(response),completedAt:new Date().toISOString()}});
      await this.store.write(puts);
    });
  }
  async reconcileChangedContexts() {
    const c=this.requireContext();
    const stale=(await this.store.list('batches')).filter(b=>b.state!=='COMPLETE' && b.request.ppmFormId===c.ppmFormId && scopeKey(b.request)!==scopeKey(c));
    for(const batch of stale){
      try{const saved=await this.call(`/sync/batches/${encodeURIComponent(batch.id)}`,undefined,'GET');if(saved.resultJson)await this.applyBatch(batch,saved.resultJson);}catch{}
    }
    await this.store.exclusive(async()=>{
      const puts=[];
      for(const entry of await this.store.list('queue')){
        if(entry.resolved || !['PENDING_SYNC','SYNCING'].includes(entry.status) || entry.context.ppmFormId!==c.ppmFormId || scopeKey(entry.context)===scopeKey(c))continue;
        const error='DEVICE_ASSIGNMENT_CHANGED_RECONCILIATION_REQUIRED';
        puts.push({kind:'queue',id:entry.id,value:{...entry,status:SyncStatus.FAILED,error}});
        const local=await this.store.get('records',entry.mutation.recordId);if(local)puts.push({kind:'records',id:local.id,value:{...local,status:SyncStatus.FAILED,error}});
      }
      if(puts.length)await this.store.write(puts);
    });
  }
  async synchronize() {
    const c=this.requireContext();if(globalThis.navigator?.onLine===false){this.notify('OFFLINE');return;}
    this.notify('SYNCING');
    if(await this.store.get('settings',`needsBootstrap:${c.ppmFormId}`))await this.bootstrap();
    await this.reconcileChangedContexts();
    await this.acknowledgePending();
    // Refresh only this authenticated author's grant. Never substitute another user's proof.
    const grant=await this.call('/sync/grants',logicalContext(c));
    if(grant.userId!==this.store.userId)throw message('ORIGINAL_AUTHOR_MISMATCH');
    this.context={...c,authorProof:grant.authorProof,maxBatchSize:batchLimit(grant.maxBatchSize ?? c.maxBatchSize)};await this.store.put('grants',c.ppmFormId,grant);
    await this.store.put('settings',`context:${c.ppmFormId}`,this.context);
    for(let count=0;count<100;count++){
      let batch=await this.sealBatch();if(!batch)break;
      if(batch.nextAttemptAt>Date.now())break;
      batch={...batch,state:'SYNCING',attempts:batch.attempts+1};
      await this.store.exclusive(async()=>{
        const puts=[{kind:'batches',id:batch.id,value:batch}];
        for(const id of batch.mutationIds){const q=await this.store.get('queue',id);puts.push({kind:'queue',id,value:{...q,status:SyncStatus.SYNCING}});const r=await this.store.get('records',q.mutation.recordId);if(r)puts.push({kind:'records',id:r.id,value:{...r,status:SyncStatus.SYNCING}});}
        await this.store.write(puts);
      });
      try {
        // An interrupted batch keeps the exact body. Only its author proof can be refreshed: proofs are excluded from server identity.
        const request=clone(batch.request);
        for(const mutation of request.mutations)if(mutation.userId===c.userId)mutation.authorProof=this.context.authorProof;
        const response=await this.call('/sync/batches',request);await this.applyBatch(batch,response);
      }catch(error){
        // Only an explicit server guarantee of no acceptance permits a new batch envelope.
        // Mutation IDs and the rejected immutable request are retained for audit/recovery.
        if(error.error==='INVALID_BATCH_SIZE' && error.details?.accepted===false
            && Number.isInteger(error.details.maxBatchSize) && error.details.maxBatchSize>0
            && error.details.maxBatchSize<batch.request.mutations.length){
          await this.repartitionUnaccepted(batch,error.details.maxBatchSize);continue;
        }
        // Before treating changed credentials as rejection, look for a durable outcome through the authenticated read endpoint.
        if([401,403,409].includes(error.status)){
          try{const saved=await this.call(`/sync/batches/${encodeURIComponent(batch.id)}`,undefined,'GET');if(saved.resultJson){await this.applyBatch(batch,saved.resultJson);continue;}}catch{}
        }
        const permanent=Boolean(error.status && error.status<500 && error.status!==408 && error.status!==429 && !['BATCH_BUSY','SERVICE_UNAVAILABLE'].includes(error.error));
        const next=Date.now()+Math.min(300000,1000*2**Math.min(batch.attempts,8))+Math.floor(Math.random()*1000);
        await this.store.exclusive(async()=>{
          const puts=[{kind:'batches',id:batch.id,value:{...batch,state:permanent?'BLOCKED':'PENDING',nextAttemptAt:permanent?Number.MAX_SAFE_INTEGER:next,error:error.error || error.message}}];
          for(const id of batch.mutationIds){const q=await this.store.get('queue',id);const status=permanent?SyncStatus.FAILED:SyncStatus.PENDING_SYNC;puts.push({kind:'queue',id,value:{...q,status,error:error.error || error.message}});const r=await this.store.get('records',q.mutation.recordId);if(r)puts.push({kind:'records',id:r.id,value:{...r,status,error:error.error || error.message}});}
          await this.store.write(puts);
        });
        this.notify(permanent?'FAILED':'PENDING_SYNC',{error:error.error || error.message});throw error;
      }
    }
    await this.pull();
    const outstanding=(await this.store.list('queue')).filter(q=>q.context.ppmFormId===c.ppmFormId && !q.resolved && !['SYNCED','RESOLVED'].includes(q.status));
    this.notify(outstanding.some(q=>q.status==='CONFLICT')?'CONFLICT':outstanding.some(q=>q.status==='FAILED')?'FAILED':outstanding.length?'PENDING_SYNC':'SYNCED');
  }
  async repartitionUnaccepted(batch,maxBatchSize) {
    const context={...this.requireContext(),maxBatchSize:batchLimit(maxBatchSize)};
    await this.store.exclusive(async()=>{
      const puts=[{kind:'batches',id:batch.id,value:{...batch,state:'COMPLETE',rejectedBeforeAcceptance:true,
        error:'INVALID_BATCH_SIZE',maxBatchSize:context.maxBatchSize,completedAt:new Date().toISOString()}},
        {kind:'settings',id:`context:${context.ppmFormId}`,value:context}];
      for(const id of batch.mutationIds){
        const entry=await this.store.get('queue',id);
        if(!entry || entry.batchId!==batch.id)throw message('LOCAL_MUTATION_MISSING');
        puts.push({kind:'queue',id,value:{...entry,batchId:null,status:SyncStatus.PENDING_SYNC}});
        const record=await this.store.get('records',entry.mutation.recordId);
        if(record)puts.push({kind:'records',id:record.id,value:{...record,status:SyncStatus.PENDING_SYNC}});
      }
      await this.store.write(puts);
    });
    this.context=context;
  }
  async synchronizeAll() {
    const active=this.requireContext();
    const pendingForms=new Set((await this.store.list('queue')).filter(q=>!q.resolved && ['PENDING_SYNC','SYNCING'].includes(q.status)).map(q=>q.context.ppmFormId));
    const contexts=new Map([[active.ppmFormId,active]]);
    for(const form of await this.store.list('forms')){
      if(!pendingForms.has(form.id) || contexts.has(form.id))continue;
      const saved=await this.store.get('settings',`context:${form.id}`);if(saved && saved.userId===this.store.userId)contexts.set(form.id,saved);
    }
    let activeUpdated=active,firstError=null;
    try {
      for(const context of contexts.values()){
        this.context=context;
        try{await this.synchronize();}catch(error){this.notify(error.status===401?'SIGN_IN_REQUIRED':'FAILED',{error:error.error || error.message});firstError ||= error;}
        if(context.ppmFormId===active.ppmFormId)activeUpdated=this.context;
      }
    } finally {this.context=activeUpdated;}
    if(firstError)throw firstError;
  }
  async sync() {
    if(this.running)return this.running;
    const work=()=>this.synchronizeAll();
    // Prevent duplicate batches from two tabs; server idempotence still protects a crash/retry.
    this.running=(globalThis.navigator?.locks?navigator.locks.request(`ppms-sync:${this.store.userId}`,work):work()).finally(()=>{this.running=null;this.schedule();});
    return this.running;
  }
  async retry() {
    const c=this.requireContext();await this.store.exclusive(async()=>{
      const puts=[];for(const batch of await this.store.list('batches'))if(batch.state!=='COMPLETE' && scopeKey(batch.request)===scopeKey(c))puts.push({kind:'batches',id:batch.id,value:{...batch,nextAttemptAt:0,state:'PENDING'}});await this.store.write(puts);
    });return this.sync();
  }
  async requeueRejected(id,{baseRevisionNo,dataJson,traceSelections,reason,reviewed=false}={}) {
    if(!reviewed || typeof reason!=='string' || !reason.trim() || !Number.isInteger(baseRevisionNo) || baseRevisionNo<0)throw message('EXPLICIT_RECONCILIATION_REQUIRED');
    const c=this.requireContext();
    return this.store.exclusive(async()=>{
      const old=await this.store.get('queue',id);
      if(!old || old.resolved || old.mutation.userId!==this.store.userId || old.context.ppmFormId!==c.ppmFormId)throw message('MUTATION_NOT_RECONCILABLE');
      const unattempted=!old.batchId && old.status===SyncStatus.FAILED && old.error==='DEVICE_ASSIGNMENT_CHANGED_RECONCILIATION_REQUIRED';
      if(!unattempted && old.outcome?.status!=='REJECTED')throw message('DURABLE_REJECTION_REQUIRED');
      const batch=old.batchId && await this.store.get('batches',old.batchId);
      if(!unattempted && (!batch || batch.state!=='COMPLETE'))throw message('BATCH_REQUIRES_ADMINISTRATIVE_RECOVERY');
      const newId=uuid();const mutation={...old.mutation,clientMutationId:newId,baseRevisionNo,authorProof:c.authorProof};
      delete mutation.dependsOnMutationId;
      mutation.recoveryOfMutationId=old.id;mutation.recoveryReason=reason.trim();
      if(old.batchId){mutation.recoveryOfBatchId=old.batchId;delete mutation.recoverySource;}else{mutation.recoverySource='LOCAL_UNATTEMPTED';delete mutation.recoveryOfBatchId;}
      if(mutation.operationType==='CREATE_DRAFT' && baseRevisionNo>0)mutation.operationType='UPDATE_DRAFT';
      if(dataJson!==undefined)mutation.dataJson=clone(dataJson);if(traceSelections!==undefined)mutation.traceSelections=clone(traceSelections);
      const counter=(await this.store.get('settings','queueCounter')) || 0;
      const local=await this.store.get('records',old.mutation.recordId);
      const localEditVersion=(local?.localEditVersion || 0)+1;
      const fresh={id:newId,context:logicalContext(c),mutation,status:SyncStatus.PENDING_SYNC,order:counter+1,
        localEditVersion,editorSessionId:null,createdAt:new Date().toISOString(),batchId:null,recoveryOf:id,recoveryReason:reason.trim()};
      await this.store.write([{kind:'queue',id,value:{...old,status:'RESOLVED',resolved:true,requeuedAs:newId,recoveryReason:reason.trim()}},
        {kind:'queue',id:newId,value:fresh},{kind:'settings',id:'queueCounter',value:counter+1},
        {kind:'records',id:old.mutation.recordId,value:{...local,dataJson:clone(mutation.dataJson ?? local?.dataJson ?? {}),localEditVersion,editorSessionId:null,localBaseRevisionNo:baseRevisionNo,status:SyncStatus.PENDING_SYNC,error:null}}]);
      return fresh;
    });
  }
  async reconcileBatch(id) {
    const batch=await this.store.get('batches',id);if(!batch)throw message('LOCAL_BATCH_NOT_FOUND');
    const saved=await this.call(`/sync/batches/${encodeURIComponent(id)}`,undefined,'GET');
    if(!saved.resultJson)throw message('BATCH_REQUIRES_ADMINISTRATIVE_RECOVERY');
    await this.applyBatch(batch,saved.resultJson);return saved.resultJson;
  }
}
