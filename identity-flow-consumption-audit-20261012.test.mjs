import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './core.js';
import {runtime} from './operations-test-runtime.mjs';
import {confirmTestShift} from './scheduling-test-fixture.mjs';

const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'},manager={type:'manager',id:'m-chen-kang'};
const offerings=['rehabilitation','cryotherapy','iastm','deep-stretch'];
function model(){const m=new DemoModel({now:()=> '2026-10-12T12:00:00Z'}).initializeOperationsWorkflow();m.today='2026-10-12';return m;}
function card(m){
 m.purchaseCommand('configure-catalog-product',{productId:'catalog-a-annual',storeId:'a',expectedVersion:0,name:'虚构独立复核年卡',serviceContent:'四项实际权益',description:'独立复核',priceMinor:10000,totalSessions:10,validityMonths:12,allowedServiceIds:offerings,active:true,reason:'核对虚构目录'},boss,'audit-catalog');
 const q=m.purchaseCommand('submit-purchase-quote',{storeId:'a',clientId:'c1',lines:[{productId:'catalog-a-annual',catalogVersion:1,quantity:1}],amountMinor:10000,businessRecipient:null,reason:'独立报价'},front,'audit-quote');
 m.purchaseCommand('approve-amount-application',{applicationId:q.id,expectedVersion:0,decision:'approve',reason:'本店店长一人批准'},manager,'audit-approve');
 const out=m.purchaseCommand('complete-approved-purchase',{applicationId:q.id,expectedVersion:1,existingClientId:'c1',reason:'冻结权益登记'},front,'audit-complete');
 return m.state.packages.find(p=>p.id===out.createdRecordIds[0]);
}
async function submit(m,type,data,requestId){const r=runtime(boss,type,data,m);r.scope.dialogContext.requestId=requestId;await r.run();assert.equal(r.scope.error,undefined,`${type}: ${r.scope.error}`);return r;}
const pay=(m,p,amount,date,key)=>submit(m,'record-receipt',{clientId:'c1',storeId:'a',packageId:p.id,purpose:'package',amount:String(amount),date,time:'10:00',channel:'direct',method:'cash',reference:key},key);

test('独立实际表单：后补较早到账不把新卡起算提前到尚未付清日期',async()=>{
 const m=model(),p=card(m);
 await pay(m,p,40,'2026-10-11','audit-partial-later');
 assert.equal(p.activationStatus,'pending');
 await pay(m,p,60,'2026-10-09','audit-backdated-completion');
 const live=m.state.packages.find(x=>x.id===p.id);
 assert.equal(live.activationStatus,'active');
 assert.equal(live.validFrom,'2026-10-11','10月9日只到账60元；10月11日40元到账后才付清');
 assert.equal(live.expiresOn,'2027-10-11');
 const frozen=structuredClone(live);
 await pay(m,p,60,'2026-10-09','audit-backdated-completion');
 assert.deepEqual(m.state.packages.find(x=>x.id===p.id),frozen);
});

test('独立实际表单：撤销误录退款恢复净足额实收时新卡激活并关闭待激活提示',async()=>{
 const m=model(),p=card(m);
 await pay(m,p,40,'2026-10-09','audit-refund-partial');
 const original=m.state.receipts.find(r=>r.requestId==='audit-refund-partial');
 const refund=m.refundReceipt({receiptId:original.id,date:'2026-10-10',time:'10:00',amount:20,reason:'虚构误录退款',packageAction:'keep',packageReason:'次数不变',requestId:'audit-refund-20'},boss);
 await pay(m,p,60,'2026-10-11','audit-after-refund-60');
 assert.equal(m.state.packages.find(x=>x.id===p.id).activationStatus,'pending');
 await submit(m,'void-refund',{id:refund.id,reason:'核对误录，实际未退款'},'audit-void-refund');
 const live=m.state.packages.find(x=>x.id===p.id);
 assert.equal(live.activationStatus,'active');
 assert.equal(live.validFrom,'2026-10-11');
 assert.equal(live.expiresOn,'2027-10-11');
 assert.equal(m.workflowBlockersView(boss).some(x=>x.sourceId===p.id&&x.step==='activation'),false);
});

test('独立实际表单：作废收款不提前起算；已激活卡退款、更晚补款与撤销退款不重算期限',async()=>{
 const m=model(),p=card(m);
 await pay(m,p,40,'2026-10-11','audit-valid-40');
 await pay(m,p,30,'2026-10-12','audit-error-30');
 const wrong=m.state.receipts.find(r=>r.requestId==='audit-error-30');
 await submit(m,'void-receipt',{id:wrong.id,reason:'本笔误录，实际未到账'},'audit-void-error-30');
 await pay(m,p,60,'2026-10-09','audit-valid-backdated-60');
 const live=m.state.packages.find(x=>x.id===p.id),frozen=[live.validFrom,live.expiresOn,live.activatedAt];
 assert.deepEqual(frozen.slice(0,2),['2026-10-11','2027-10-11']);
 const original=m.state.receipts.find(r=>r.requestId==='audit-valid-40');
 const refund=m.refundReceipt({receiptId:original.id,date:'2026-10-12',time:'10:00',amount:20,reason:'实际退款',packageAction:'keep',packageReason:'次数保留',requestId:'audit-active-refund'},boss);
 await pay(m,p,20,'2026-10-12','audit-active-topup');
 await submit(m,'void-refund',{id:refund.id,reason:'退款误记核对'},'audit-active-refund-void');
 const after=m.state.packages.find(x=>x.id===p.id);
 assert.deepEqual([after.validFrom,after.expiresOn,after.activatedAt],frozen);
});

test('独立实际表单：退款结束的新卡阻止新款；撤销结束恢复后仍待付清并按实际到账日起算',async()=>{
 const m=model(),p=card(m);
 await pay(m,p,40,'2026-10-09','audit-closed-40');
 const original=m.state.receipts.find(r=>r.requestId==='audit-closed-40');
 const refund=m.refundReceipt({receiptId:original.id,date:'2026-10-10',time:'10:00',amount:20,reason:'虚构退款结束',packageAction:'close',packageReason:'结束待激活卡',requestId:'audit-close-refund'},boss);
 const before=structuredClone(m.state),blocked=runtime(boss,'record-receipt',{clientId:'c1',storeId:'a',packageId:p.id,purpose:'package',amount:'80',date:'2026-10-11',time:'10:00',method:'cash',channel:'direct'},m);blocked.scope.dialogContext.requestId='audit-closed-80';await blocked.run();assert.match(blocked.scope.error,/已结束|不可关联/);assert.deepEqual(m.state,before);
 let live=m.state.packages.find(x=>x.id===p.id);assert.equal(live.closed,true);assert.equal(live.activationStatus,'pending');assert.equal(live.validFrom,null);
 await submit(m,'void-refund',{id:refund.id,reason:'核对误录结束，恢复原卡'},'audit-closed-refund-void');
 live=m.state.packages.find(x=>x.id===p.id);assert.equal(live.closed,false);assert.equal(live.activationStatus,'pending');assert.equal(live.validFrom,null);
 await pay(m,p,60,'2026-10-11','audit-restored-60');live=m.state.packages.find(x=>x.id===p.id);assert.equal(live.activationStatus,'active');assert.equal(live.validFrom,'2026-10-11');assert.equal(live.expiresOn,'2027-10-11');
});

for(let n=1;n<=4;n++)test(`独立实际FormData：${n}项卡与已到账单次原子组合，重试、整组撤销、退款后余次业绩实收一致`,async()=>{
 const m=model(),p=card(m);await pay(m,p,100,m.today,`audit-matrix-card-${n}`);
 const therapist={type:'therapist',id:'t-qiu-zhen'};m.state.clients.find(c=>c.id==='c1').ownerId=therapist.id;
 confirmTestShift(m,{therapistId:therapist.id,storeId:'a',date:m.today});
 m.state.assessments??=[];m.state.assessments.push({id:'audit-matrix-prior',clientId:'c1',storeId:'a',assessorId:'tao',date:'2026-10-11',status:'confirmed',confirmedBy:'boss',confirmedRole:'boss'});
 const a={id:`audit-matrix-visit-${n}`,clientId:'c1',storeId:'a',date:m.today,time:'12:00',principalId:therapist.id,project:'独立组合服务',status:'confirmed',initialAssessmentRequired:false,arrivalAt:'2026-10-12T03:00:00Z'};m.state.appointments.push(a);
 const data={clientId:'c1',storeId:'a',appointmentId:a.id,date:a.date,time:a.time,principalId:therapist.id,project:a.project,notes:'每项实际服务',groupMode:'true',groupService:offerings.slice(0,n)};const singleIds=[];
 for(let index=0;index<n;index++){
  if(index%2===0)data[`groupSource-${offerings[index]}`]=`package:${p.id}`;
  else{await submit(m,'record-receipt',{clientId:'c1',storeId:'a',purpose:'single',amount:'10',date:m.today,time:'10:00',channel:'direct',method:'cash',reference:`audit-matrix-single-${index}`},`audit-matrix-single-${index}`);const r=m.state.receipts.find(r=>r.requestId===`audit-matrix-single-${index}`);singleIds.push(r.id);data[`groupSource-${offerings[index]}`]=`receipt:${r.id}`;}
 }
 const submitVisit=async key=>{const r=runtime(therapist,'register-appointment',data,m);r.scope.dialogContext.requestId=key;r.scope.dialogContext.evidencePhotos=[{id:'audit-evidence',name:'virtual.png',width:1,height:1,dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrGQAAAAASUVORK5CYII='}];await r.run();assert.equal(r.scope.error,undefined,r.scope.error);return r;};
 await submitVisit(`audit-matrix-service-${n}`);const visit=m.state.serviceVisits.find(v=>v.requestId===`audit-matrix-service-${n}`),rows=m.state.services.filter(s=>s.visitId===visit.id);assert.equal(rows.length,n);assert.equal(m.packageRemaining(p.id),10-Math.ceil(n/2));assert.equal(rows.filter(r=>r.evidencePhotos.length).length,1);assert.equal(rows.filter(r=>r.appointmentSnapshots.length).length,1);assert.equal(m.performance(therapist.id,{clientId:'c1',from:m.today,to:m.today}),10*n);
 for(const id of singleIds)assert.equal(m.state.services.filter(s=>s.receiptId===id&&s.status==='valid').length,1);
 const saved=structuredClone(m.state);await submitVisit(`audit-matrix-service-${n}`);assert.deepEqual(m.state,saved);
 m.revokeService(visit.serviceIds.at(-1),'整次误登记核对',boss);assert.equal(m.packageRemaining(p.id),10);assert.equal(m.performance(therapist.id,{clientId:'c1',from:m.today,to:m.today}),0);assert.equal(m.state.appointments.find(x=>x.id===a.id).status,'confirmed');
 for(const id of singleIds){assert.equal(m._singleReceiptAvailable(m.state.receipts.find(r=>r.id===id)),true);m.refundReceipt({receiptId:id,date:m.today,time:'11:00',amount:10,reason:'单次实际退款',requestId:`audit-matrix-refund-${id}`},boss);}
 assert.equal(m.cashSummary({clientId:'c1',storeId:'a'},boss).netMinor,10000);assert.equal(m.packageRemaining(p.id),10);assert.equal(m.performance(therapist.id,{clientId:'c1',from:m.today,to:m.today}),0);
});
