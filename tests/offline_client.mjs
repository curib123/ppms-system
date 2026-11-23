/** Real-browser IndexedDB/WebCrypto regression checks. npm install --no-save playwright, then node tests/offline_client.mjs. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
let playwright;if(!process.argv.includes('--node')){try{playwright=require(process.env.PLAYWRIGHT_MODULE || 'playwright');}catch{playwright=require('/opt/codex/cua_node/lib/node_modules/playwright');}}
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const server=createServer(async(req,res)=>{if(['/offline.js','/uuid.js'].includes(req.url)){res.setHeader('Content-Type','application/javascript');res.end(await readFile(resolve(root,'public/assets/ppms'+req.url)));}else{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>PPMS offline regression</title>');}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  const executablePath=process.env.CHROMIUM_PATH || undefined;
  let page;
  if(process.argv.includes('--node')) {
    const fake=require(process.env.FAKE_INDEXEDDB_MODULE || 'fake-indexeddb');
    globalThis.indexedDB=fake.indexedDB;globalThis.IDBKeyRange=fake.IDBKeyRange;
  } else {
    browser=await playwright.chromium.launch({headless:true,executablePath,args:['--no-sandbox','--no-proxy-server','--host-resolver-rules=MAP ppms-uuid.test 127.0.0.1']});
    page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);
  }
  const run=async(moduleUrl)=>{
    // Exercise the full durable queue with the compatibility path. The separate
    // UUID suite and unmodified application contexts also verify native support.
    Object.defineProperty(crypto,'randomUUID',{configurable:true,value:undefined});
    const {OfflineStore,SyncEngine,mergeProjection}=await import(moduleUrl);
    const tests=[];const check=(name,value)=>{if(!value)throw new Error(name);tests.push(name);};
    const rejects=async(name,work,code)=>{try{await work();throw new Error(name+' did not reject');}catch(e){if(e.code!==code)throw e;tests.push(name);}};
    const uuidV4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    check('UUID compatibility is exercised with native randomUUID unavailable',typeof crypto.randomUUID==='undefined' && typeof crypto.getRandomValues==='function');
    const c={user:{id:'test-offline-user'},userId:'test-offline-user',deviceId:'device-1',leaseVersion:1,ppmFormId:'form-1',deviceToken:'device-secret',authorProof:'author-proof',plantTimezone:'Asia/Manila',editorSessionId:'editor-main'};
    let store=await OfflineStore.open({userId:c.user.id,passphrase:'offline test passphrase'});
    await store.saveDraft({id:'record-a',ppmFormId:c.ppmFormId,editorSessionId:c.editorSessionId,dataJson:{secret:'production-private'}});
    const a=await store.queueMutation(c,{recordId:'record-a',operationType:'CREATE_DRAFT',baseRevisionNo:0,templateVersionId:'version-1',dataJson:{secret:'production-private'}});
    check('Offline queue generates a secure v4 mutation ID without randomUUID',uuidV4.test(a.mutationId));
    await store.saveDraft({id:'record-a',ppmFormId:c.ppmFormId,editorSessionId:c.editorSessionId,dataJson:{secret:'production-edited'}});
    const a2=await store.queueMutation(c,{recordId:'record-a',operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{secret:'production-edited'}});
    check('Repeated unsent create is coalesced',a.mutationId===a2.mutationId && (await store.list('queue')).length===1);
    check('Coalesced create retains original schema', (await store.get('queue',a.mutationId)).mutation.templateVersionId==='version-1');
    const backup=await store.exportVault();const raw=JSON.stringify(backup);
    check('Vault export encrypts production values and device secrets',!raw.includes('production-private')&&!raw.includes('production-edited')&&!raw.includes('device-secret'));
    await rejects('Unsynchronized drafts cannot be removed',()=>store.removeDraft('record-a'),'UNSYNCHRONIZED_RECORD_PROTECTED');
    await rejects('Vault rejects wrong unlock passphrase',()=>OfflineStore.open({userId:c.user.id,passphrase:'incorrect passphrase'}),'OFFLINE_UNLOCK_FAILED');
    await store.lock();await rejects('Locked vault denies data reads',()=>store.get('records','record-a'),'OFFLINE_VAULT_LOCKED');
    store=await OfflineStore.open({userId:c.user.id,passphrase:'offline test passphrase'});
    check('Draft and queue survive vault reopening',(await store.get('records','record-a')).dataJson.secret==='production-edited' && (await store.list('queue')).length===1);
    const engine=new SyncEngine({store,request:async()=>{throw new Error('Unexpected network');}});await engine.configure(c);
    check('Encrypted vault does not persist plaintext device credential',!JSON.stringify(await store.exportVault()).includes('device-secret'));
    const sealed=await engine.sealBatch();const before=JSON.stringify(sealed.request);
    check('Sealed batch gets a distinct secure v4 identity without randomUUID',uuidV4.test(sealed.id) && sealed.id!==a.mutationId);
    await store.saveDraft({id:'record-a',ppmFormId:c.ppmFormId,editorSessionId:c.editorSessionId,dataJson:{secret:'newer-local-edit'}});
    const a3=await store.queueMutation(c,{recordId:'record-a',operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{secret:'newer-local-edit'}});
    const follow=await store.get('queue',a3.mutationId);
    check('Sealed batch remains immutable',JSON.stringify((await store.get('batches',sealed.id)).request)===before);
    check('Later edit has guarded predecessor and predicted base',follow.mutation.dependsOnMutationId===a.mutationId && follow.mutation.baseRevisionNo===1 && follow.mutation.operationType==='UPDATE_DRAFT');
    await engine.applyBatch(sealed,{id:sealed.id,results:[{clientMutationId:a.mutationId,status:'APPLIED',receiptId:'durable-r1',recordId:'record-a',revisionNo:1}]});
    check('Earlier receipt cannot mark newer edit synced',(await store.get('records','record-a')).status==='PENDING_SYNC' && (await store.get('records','record-a')).dataJson.secret==='newer-local-edit');
    const lostStore=await OfflineStore.open({userId:'lost-response',passphrase:'another safe passphrase'});
    const lc={...c,user:{id:'lost-response'},userId:'lost-response'};
    await lostStore.saveDraft({id:'lost-record',ppmFormId:c.ppmFormId,dataJson:{count:5}});
    await lostStore.queueMutation(lc,{recordId:'lost-record',operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{count:5}});
    const received=[];let committed=0;let response;let lose=true;const statuses=[];
    const lostEngine=new SyncEngine({store:lostStore,onStatus:event=>statuses.push(event.status),request:async(path,{body})=>{
      if(path==='/sync/grants')return {userId:'lost-response',authorProof:'fresh-proof'};
      if(path==='/sync/batches'){
        received.push(JSON.stringify(body));if(!response){committed++;response={id:body.id,results:body.mutations.map(m=>({clientMutationId:m.clientMutationId,status:'APPLIED',receiptId:'server-receipt',recordId:m.recordId,revisionNo:1}))};}
        if(lose){lose=false;throw new TypeError('Network response lost');}return response;
      }throw new Error(path);
    }});await lostEngine.configure(lc);
    try{await lostEngine.sync();}catch{}
    check('Lost HTTP response never marks draft synced',(await lostStore.get('records','lost-record')).status==='PENDING_SYNC');
    await lostEngine.retry();
    check('Retry sends the same batch and does not duplicate commit',committed===1 && received.length===2 && received[0]===received[1]);
    check('Durable receipt marks the exact record synced',(await lostStore.get('records','lost-record')).status==='SYNCED');
    const local={id:'x',ppmFormId:'form-1',serverRevisionNo:3,lastEventSequence:'30',status:'SYNCED',dataJson:{value:3}};
    const projection={record:{id:'x',ppmFormId:'form-1',currentRevisionNo:2},revision:{revisionNo:2,dataJson:{value:2}}};
    check('Older projection cannot roll back newer revision',mergeProjection(local,projection,'40').dataJson.value===3);
    const same={record:{id:'x',ppmFormId:'form-1',currentRevisionNo:3},revision:{revisionNo:3,dataJson:{value:3}},reviewReference:{version:2,status:'APPROVED'}};
    check('Equal revision with newer event updates review metadata',mergeProjection(local,same,'31').reviewReference.status==='APPROVED');
    const pending={...local,status:'SAVED_LOCALLY',dataJson:{value:99}};const deleted={...same,deleted:true};
    const merged=mergeProjection(pending,deleted,'32');
    check('Remote deletion preserves local work as conflict',merged.dataJson.value===99 && merged.status==='CONFLICT' && merged.remoteDeleted===true);
    const bases=await OfflineStore.open({userId:'base-lineage',passphrase:'base lineage passphrase'});
    const ac={...c,user:{id:'base-lineage'},userId:'base-lineage',editorSessionId:'tab-a'};
    const ae=new SyncEngine({store:bases,request:async()=>{throw new Error('Unexpected network');}});await ae.configure(ac);
    const original=(id,form='form-1',revision=1,value='original')=>({record:{id,ppmFormId:form,currentRevisionNo:revision},revision:{revisionNo:revision,dataJson:{value}}});
    await bases.put('records','remote-race',mergeProjection(null,original('remote-race'),'1'));
    await bases.saveDraft({id:'remote-race',ppmFormId:ac.ppmFormId,editorSessionId:'tab-a',localBaseRevisionNo:1,dataJson:{value:'local edit'}});
    await bases.put('records','remote-race',mergeProjection(await bases.get('records','remote-race'),original('remote-race','form-1',2,'remote edit'),'2'));
    const rq=await bases.queueMutation(ac,{recordId:'remote-race',operationType:'UPDATE_DRAFT',dataJson:{value:'local edit'}});
    check('Remote feed never rebases an existing dirty draft',(await bases.get('queue',rq.mutationId)).mutation.baseRevisionNo===1 && (await bases.get('records','remote-race')).serverRevisionNo===2);
    const rbatch=await ae.sealBatch();await ae.applyBatch(rbatch,{id:rbatch.id,results:[{clientMutationId:rq.mutationId,status:'CONFLICT',conflictId:'remote-conflict'}]});
    await bases.put('records','tab-race',mergeProjection(null,original('tab-race'),'3'));
    await bases.saveDraft({id:'tab-race',ppmFormId:ac.ppmFormId,editorSessionId:'tab-a',localBaseRevisionNo:1,dataJson:{value:'tab A'}});
    const aq=await bases.queueMutation(ac,{recordId:'tab-race',operationType:'UPDATE_DRAFT',baseRevisionNo:1,dataJson:{value:'tab A'}});
    const ab=await ae.sealBatch();
    await bases.saveDraft({id:'tab-race',ppmFormId:ac.ppmFormId,editorSessionId:'tab-b',localBaseRevisionNo:1,dataJson:{value:'tab B'}});
    const bq=await bases.queueMutation({...ac,editorSessionId:'tab-b'},{recordId:'tab-race',operationType:'UPDATE_DRAFT',dataJson:{value:'tab B'}});
    check('Different editor never inherits another pending mutation base',(await bases.get('queue',bq.mutationId)).mutation.baseRevisionNo===1 && !(await bases.get('queue',bq.mutationId)).mutation.dependsOnMutationId);
    await ae.applyBatch(ab,{id:ab.id,results:[{clientMutationId:aq.mutationId,status:'APPLIED',receiptId:'tab-a-receipt',recordId:'tab-race',revisionNo:2}]});
    const afterA=await bases.get('records','tab-race');
    check('Own receipt does not rebase another tabs stale draft',afterA.localBaseRevisionNo===1 && afterA.serverRevisionNo===2 && afterA.dataJson.value==='tab B' && afterA.status==='PENDING_SYNC');
    const cc={...ac,ppmFormId:'form-lineage',editorSessionId:'tab-c'};await ae.configure(cc);
    await bases.put('records','own-lineage',mergeProjection(null,original('own-lineage','form-lineage'),'4'));
    await bases.saveDraft({id:'own-lineage',ppmFormId:cc.ppmFormId,editorSessionId:'tab-c',localBaseRevisionNo:1,dataJson:{value:'first local'}});
    const cq=await bases.queueMutation(cc,{recordId:'own-lineage',operationType:'UPDATE_DRAFT',dataJson:{value:'first local'}});const cb=await ae.sealBatch();
    await bases.saveDraft({id:'own-lineage',ppmFormId:cc.ppmFormId,editorSessionId:'tab-c',localBaseRevisionNo:1,dataJson:{value:'later same editor'}});
    await ae.applyBatch(cb,{id:cb.id,results:[{clientMutationId:cq.mutationId,status:'APPLIED',receiptId:'own-receipt',recordId:'own-lineage',revisionNo:2}]});
    check('Own receipt advances a proven same-editor descendant safely',(await bases.get('records','own-lineage')).localBaseRevisionNo===2 && (await bases.get('records','own-lineage')).status==='SAVED_LOCALLY');
    const dc={...ac,ppmFormId:'form-direct'};await ae.configure(dc);
    await bases.put('records','direct-tab',mergeProjection(null,original('direct-tab','form-direct'),'5'));
    const dq=await bases.queueMutation(dc,{recordId:'direct-tab',operationType:'UPDATE_DRAFT',baseRevisionNo:1,dataJson:{value:'direct A'}});const dbatch=await ae.sealBatch();
    await bases.queueMutation({...dc,editorSessionId:'tab-b'},{recordId:'direct-tab',operationType:'UPDATE_DRAFT',baseRevisionNo:1,dataJson:{value:'direct B'}});
    await ae.applyBatch(dbatch,{id:dbatch.id,results:[{clientMutationId:dq.mutationId,status:'APPLIED',receiptId:'direct-a-receipt',recordId:'direct-tab',revisionNo:2}]});
    check('Queue-only edits have distinct generations across tabs',(await bases.get('records','direct-tab')).localBaseRevisionNo===1 && (await bases.get('records','direct-tab')).dataJson.value==='direct B');
    const protectedDraft=await bases.saveDraft({id:'unqueued-draft',ppmFormId:ac.ppmFormId,editorSessionId:'tab-a',expectedLocalEditVersion:0,localBaseRevisionNo:1,dataJson:{value:'first unsent draft'}});
    await rejects('Stale cross-tab autosave cannot replace unqueued local work',()=>bases.saveDraft({id:'unqueued-draft',ppmFormId:ac.ppmFormId,editorSessionId:'tab-b',expectedLocalEditVersion:0,localBaseRevisionNo:1,dataJson:{value:'stale other draft'}}),'LOCAL_DRAFT_CHANGED');
    await rejects('Stale cross-tab queue cannot replace unqueued local work',()=>bases.queueMutation({...ac,editorSessionId:'tab-b',expectedLocalEditVersion:0},{recordId:'unqueued-draft',operationType:'UPDATE_DRAFT',baseRevisionNo:1,dataJson:{value:'stale other draft'}}),'LOCAL_DRAFT_CHANGED');
    check('Stale-save rejection retains original draft and strips guard metadata',(await bases.get('records','unqueued-draft')).dataJson.value==='first unsent draft' && !('expectedLocalEditVersion' in protectedDraft));
    const resumed=await bases.saveDraft({id:'unqueued-draft',ppmFormId:ac.ppmFormId,editorSessionId:'tab-b',expectedLocalEditVersion:protectedDraft.localEditVersion,localBaseRevisionNo:1,dataJson:{value:'explicitly resumed draft'}});
    check('Freshly loaded draft can continue in a new editor session',resumed.editorSessionId==='tab-b' && resumed.localEditVersion>protectedDraft.localEditVersion);
    await bases.lock();
    const limits=await OfflineStore.open({userId:'batch-limits',passphrase:'batch size passphrase'});
    const limitContext={...c,user:{id:'batch-limits'},userId:'batch-limits',maxBatchSize:2};const limitRequests=[];
    const limitEngine=new SyncEngine({store:limits,request:async(path,{body})=>{
      if(path==='/sync/grants')return {userId:'batch-limits',authorProof:'grant',maxBatchSize:2};
      if(path==='/sync/batches'){
        limitRequests.push(structuredClone(body));
        if(body.mutations.length>1)throw Object.assign(new Error('INVALID_BATCH_SIZE'),{error:'INVALID_BATCH_SIZE',status:422,details:{accepted:false,maxBatchSize:1}});
        return {id:body.id,results:body.mutations.map(m=>({clientMutationId:m.clientMutationId,status:'APPLIED',receiptId:'limit-'+m.recordId,recordId:m.recordId,revisionNo:1}))};
      }throw new Error(path);
    }});await limitEngine.configure(limitContext);
    for(const id of ['limit-a','limit-b'])await limits.queueMutation(limitContext,{recordId:id,operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{value:id}});
    const immutable=await limitEngine.sealBatch();await limitEngine.sync();
    check('Definitive pre-acceptance rejection safely repartitions batches',limitRequests.length===3 && limitRequests[0].mutations.length===2 && limitRequests.slice(1).every(b=>b.mutations.length===1));
    check('Repartition retains original immutable request and mutation identities',JSON.stringify((await limits.get('batches',immutable.id)).request)===JSON.stringify(immutable.request) && new Set(limitRequests.flatMap(b=>b.mutations.map(m=>m.clientMutationId))).size===2);
    check('Repartition marks synced only after durable individual receipts',(await limits.listRecords()).every(r=>r.status==='SYNCED'));
    await limitEngine.configure({...limitContext,maxBatchSize:1});
    for(const id of ['limit-c','limit-d'])await limits.queueMutation(limitContext,{recordId:id,operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{value:id}});
    check('Client honors current advertised batch size before sealing',(await limitEngine.sealBatch()).request.mutations.length===1);
    await limits.lock();
    const bs=await OfflineStore.open({userId:'bootstrap-user',passphrase:'bootstrap passphrase'});
    let pages=0,acks=0,ackSawDurable=false;
    const bc={...c,user:{id:'bootstrap-user'},userId:'bootstrap-user'};
    const snapshot={record:{id:'snapshot-record',ppmFormId:'form-1',currentRevisionNo:1},revision:{revisionNo:1,dataJson:{value:9}}};
    const be=new SyncEngine({store:bs,request:async(path,{body})=>{
      if(path==='/sync/bootstrap'){pages++;check('Partial bootstrap did not acknowledge prematurely',acks===0);return {form:{id:'form-1'},areaAssignments:[],personnel:[],connections:[],templates:[],records:pages===1?[snapshot]:[],hasMore:pages===1,pageToken:pages===1?'page-two':null,sources:[{sourcePpmFormId:'form-1',sequence:'10',outputs:[],...(pages===2?{cursorToken:'proof-10'}:{})}]};}
      if(path==='/sync/ack'){acks++;ackSawDurable=(await bs.get('records','snapshot-record'))?.dataJson.value===9;return {lastEventSequence:body.cursorToken==='proof-10'?'10':'11'};}
      if(path==='/sync/pull')return {events:[{eventType:'RECORD_REVISION',sequence:'11',payloadJson:{...snapshot,reviewReference:{version:1,status:'APPROVED'}}}],hasMore:false,nextSequence:'11',cursorToken:'proof-11'};
      throw new Error(path);
    }});await be.configure(bc);await be.bootstrap();
    check('Bootstrap acknowledges only durable complete snapshot',pages===2 && acks===2 && ackSawDurable);
    check('Pull atomically applies current review reference',(await bs.get('records','snapshot-record')).reviewReference.status==='APPROVED');
    const large='x'.repeat(250000);await bs.put('settings','large',{large});check('Encrypted values support large form payloads',(await bs.get('settings','large')).large.length===250000);
    const beforeQueue=(await bs.list('queue')).length;const write=bs.write.bind(bs);bs.write=async()=>{throw new Error('QuotaExceededError');};
    try{await bs.queueMutation(bc,{recordId:'quota-record',operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{a:1}});}catch{}
    bs.write=write;check('Failed local transaction cannot pretend queued success',(await bs.list('queue')).length===beforeQueue && await bs.get('records','quota-record')===null);
    const rejectedStore=await OfflineStore.open({userId:'reject-user',passphrase:'rejection test passphrase'});
    const rc={...c,user:{id:'reject-user'},userId:'reject-user'};
    const re=new SyncEngine({store:rejectedStore,request:async()=>{throw new Error('Unexpected network');}});await re.configure(rc);
    await rejectedStore.saveDraft({id:'rejected-record',ppmFormId:c.ppmFormId,dataJson:{value:'local'}});
    const qr=await rejectedStore.queueMutation(rc,{recordId:'rejected-record',operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{value:'local'}});
    const rb=await re.sealBatch();await re.applyBatch(rb,{id:rb.id,results:[{clientMutationId:qr.mutationId,status:'REJECTED',error:'RECOVERY_NOT_PROCESSED'}]});
    await rejects('Rejected work requires explicit reconciliation',()=>re.requeueRejected(qr.mutationId,{baseRevisionNo:0,reason:'reviewed'}),'EXPLICIT_RECONCILIATION_REQUIRED');
    const renewed=await re.requeueRejected(qr.mutationId,{baseRevisionNo:0,dataJson:{value:'reviewed local'},reason:'Compared current server state',reviewed:true});
    check('Reconciliation uses new identity and keeps rejected history',renewed.id!==qr.mutationId && (await rejectedStore.get('queue',qr.mutationId)).outcome.error==='RECOVERY_NOT_PROCESSED');
    check('Reconciliation records server-verifiable original batch reference',renewed.mutation.recoveryOfBatchId===rb.id && renewed.mutation.recoveryOfMutationId===qr.mutationId);
    await rejects('Completed reconciliation cannot enqueue twice',()=>re.requeueRejected(qr.mutationId,{baseRevisionNo:0,reason:'again',reviewed:true}),'MUTATION_NOT_RECONCILABLE');
    const multi=await OfflineStore.open({userId:'multi-user',passphrase:'multi form passphrase'});
    const mc={...c,user:{id:'multi-user'},userId:'multi-user'};const mc2={...mc,ppmFormId:'form-2'};const sent=[];
    const me=new SyncEngine({store:multi,request:async(path,{body})=>{if(path==='/sync/grants')return{userId:'multi-user',authorProof:'fresh'};if(path==='/sync/batches'){sent.push(body.ppmFormId);return{id:body.id,results:body.mutations.map(m=>({clientMutationId:m.clientMutationId,status:'APPLIED',receiptId:'receipt-'+m.recordId,recordId:m.recordId,revisionNo:1}))};}throw new Error(path);}});
    for(const context of [mc,mc2]){await multi.put('forms',context.ppmFormId,{id:context.ppmFormId});await me.configure(context);await multi.saveDraft({id:'record-'+context.ppmFormId,ppmFormId:context.ppmFormId,dataJson:{value:1}});await multi.queueMutation(context,{recordId:'record-'+context.ppmFormId,operationType:'CREATE_DRAFT',baseRevisionNo:0,dataJson:{value:1}});}
    await me.configure(mc);await me.sync();
    check('Reconnect synchronizes pending records across form contexts',new Set(sent).size===2 && (await multi.listRecords()).every(r=>r.status==='SYNCED'));
    check('Multi-form synchronization restores active editor context',me.context.ppmFormId===mc.ppmFormId);
    const second=await OfflineStore.open({userId:'multi-user',passphrase:'multi form passphrase'});const version=(await multi.exportVault()).vault.version || 0;
    multi.writeVersion=version;second.writeVersion=version;
    const raced=await Promise.allSettled([multi.write([{kind:'settings',id:'race-a',value:1}]),second.write([{kind:'settings',id:'race-b',value:2}])]);
    check('Local compare-and-swap prevents silent cross-tab overwrite',raced.filter(r=>r.status==='fulfilled').length===1 && raced.some(r=>r.status==='rejected'&&r.reason.code==='LOCAL_CONCURRENT_CHANGE'));
    await second.lock();
    const recovery=await OfflineStore.open({userId:'restore-target',passphrase:'restore safe passphrase'});await recovery.put('settings','sample',{value:'recovery-private'});const recoveryCopy=await recovery.exportVault();await recovery.lock();
    // Remove only this synthetic test vault to simulate a fresh replacement browser.
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('ppms-offline-v1');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    await new Promise((resolve,reject)=>{const tx=db.transaction(['vaults','entries'],'readwrite');tx.objectStore('vaults').delete('restore-target');for(const entry of recoveryCopy.entries)tx.objectStore('entries').delete(entry.key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    const tampered=structuredClone(recoveryCopy);tampered.entries[0].data='A'+tampered.entries[0].data.slice(1);
    await rejects('Recovery rejects modified ciphertext',()=>OfflineStore.restore(tampered,'restore safe passphrase'),'OFFLINE_BACKUP_INTEGRITY_FAILED');
    const restored=await OfflineStore.restore(recoveryCopy,'restore safe passphrase');
    check('Encrypted recovery restores original durable contents',(await restored.get('settings','sample')).value==='recovery-private');
    await rejects('Recovery refuses to overwrite existing local work',()=>OfflineStore.restore(recoveryCopy,'restore safe passphrase'),'EXISTING_VAULT_MUST_NOT_BE_OVERWRITTEN');
    await restored.lock();await rejectedStore.lock();await multi.lock();
    await store.lock();await lostStore.lock();await bs.lock();
    return {passed:tests.length,tests};
  };
  const outcome=process.argv.includes('--node') ? await run(pathToFileURL(resolve(root,'public/assets/ppms/offline.js')).href) : await page.evaluate(run,'/offline.js');
  if(browser) {
    const insecure=await browser.newPage();
    await insecure.goto(`http://ppms-uuid.test:${server.address().port}`);
    const compatibility=await insecure.evaluate(async()=>{
      const {createUuid}=await import('/uuid.js');
      const ids=Array.from({length:256},()=>createUuid());
      return {secure:isSecureContext,native:typeof crypto.randomUUID,randomBytes:typeof crypto.getRandomValues,ids};
    });
    assert.equal(compatibility.secure,false);
    assert.equal(compatibility.native,'undefined');
    assert.equal(compatibility.randomBytes,'function');
    assert.ok(compatibility.ids.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
    assert.equal(new Set(compatibility.ids).size,compatibility.ids.length);
    outcome.tests.push('Non-localhost HTTP origin generates secure UUIDs when randomUUID is naturally unavailable');
    outcome.passed++;
    await insecure.close();
  }
  outcome.environment=process.argv.includes('--node')?'Node WebCrypto with emulated IndexedDB':'Chromium with native IndexedDB/WebCrypto';
  assert.ok(outcome.passed>=20);console.log(JSON.stringify(outcome,null,2));
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
