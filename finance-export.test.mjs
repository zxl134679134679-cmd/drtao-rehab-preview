import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel, ensureStorePackageExamples } from './legacy-test-fixture.mjs';
import { receptionStores } from './reception.js';
import { ensureEvaluations, assessmentRows, frontDeskEvaluationRows } from './evaluations.js';
import { ensureCustomerBooking, customerBookingRows } from './customer-booking.js';
import { ensurePaperIntakes, paperIntakeRows } from './paper-intake.js';
import { ensureSchedules, scheduleRows, scheduleRequestRows, bossScheduleNotifications } from './schedules.js';

const boss={type:'boss',id:'boss'}, source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const internal=new Set(['inputKey','requestId','requestType','confirmRequestId','confirmInputKey','ledgerFingerprint']);
function forbidden(value){return !value||typeof value!=='object'?[]:Object.entries(value).flatMap(([key,child])=>[...(internal.has(key)?[key]:[]),...forbidden(child)]);}
function actual(name,next){const start=source.indexOf(`function ${name}(`),end=source.indexOf(next,start);assert.ok(start>=0&&end>start);return source.slice(start,end);}
async function exported(model,role){
 let download;
 const scope={model,role,ctx:()=>({model,role,filters:{}}),receptionStores,assessmentRows,frontDeskEvaluationRows,customerBookingRows,paperIntakeRows,scheduleRows,scheduleRequestRows,bossScheduleNotifications,Blob,URL:{createObjectURL:b=>{download=b;return 'blob:finance-test';},revokeObjectURL(){}},document:{createElement:()=>({click(){}})},setTimeout(){},toast(){}};
 vm.runInNewContext(`${actual('assertBoss','\nfunction assertStaff')}\n${actual('exportPreview','\n// Use the layout breakpoint')}\nglobalThis.download=exportPreview;`,scope);
 scope.download();return JSON.parse(await download.text()).数据;
}
function fixture(){
 const model=new DemoModel({now:()=> '2026-10-09T04:00:00.000Z'});
 ensureStorePackageExamples(model);ensureEvaluations(model);ensureCustomerBooking(model);ensurePaperIntakes(model);ensureSchedules(model);
 for(const storeId of ['a','b']){
   const pack=model.state.packages.find(p=>p.clientId==='c1'&&p.storeId===storeId);
   const receipt=model.recordReceipt({clientId:'c1',storeId,packageId:pack.id,date:model.today,time:'10:00',amount:storeId==='a'?1234:5678,purpose:'package',method:'wechat',requestId:`finance-secret-receipt-${storeId}`},boss);
   const row=model.saveCashClosing({storeId,date:model.today,actualWechat:receipt.amount,actualAlipay:0,actualCash:0,actualBank:0,notes:`finance-day-${storeId}`,version:0,requestId:`finance-secret-closing-${storeId}`},boss);
   model.confirmCashClosing(row.id,{version:row.version,requestId:`finance-secret-confirm-${storeId}`},boss);
 }
 return model;
}
test('boss export keeps daily confirmation evidence but omits financial replay and ledger fingerprints',async()=>{
 const model=fixture(),data=await exported(model,boss);
 assert.equal(data.cashClosings.length,2);
 assert.deepEqual(forbidden(data.cashClosings),[]);assert.deepEqual(forbidden(data.receipts),[]);assert.deepEqual(forbidden(data.refunds),[]);
 assert.ok(!JSON.stringify(data).includes('finance-secret-'));
 assert.ok(data.cashClosings.every(row=>row.status==='confirmed'&&row.confirmedBy==='boss'));
});
test('frontdesk and manager export local daily and package linkage records without replay metadata',async()=>{
 const model=fixture();
 for(const role of [{type:'frontdesk',id:'f1'},{type:'manager',id:'m1'}]){
  const data=await exported(model,role);
  assert.ok(data.cashClosings.length>0);
  assert.ok(data.cashClosings.every(row=>row.storeId==='a'));
  assert.ok(data.receipts.every(row=>row.storeId==='a'));
  assert.ok(data.receipts.some(row=>row.packageId===model.state.packages.find(p=>p.clientId==='c1'&&p.storeId==='a').id));
  assert.deepEqual(forbidden(data.cashClosings),[]);assert.deepEqual(forbidden(data.receipts),[]);
  assert.ok(!JSON.stringify(data).includes('finance-day-b'));
 }
});
test('customer export retains ended package status and excludes management cash amounts or refund reasons',async()=>{
 const model=fixture(),receipt=model.state.receipts.find(r=>r.storeId==='b');
 model.refundReceipt({receiptId:receipt.id,amount:100,date:model.today,time:'11:00',reason:'finance-private-refund-reason',packageAction:'close',packageReason:'finance-private-package-reason',requestId:'finance-secret-refund'},boss);
 const data=await exported(model,{type:'customer',id:'c1'}),pack=data.packages.find(p=>p.id===receipt.packageId),encoded=JSON.stringify(data);
 assert.equal(pack.closed,true);assert.equal(pack.remaining,0);
 for(const field of ['cashClosings','receipts','refunds'])assert.ok(!Object.hasOwn(data,field));
 for(const text of ['finance-private-','finance-secret-','finance-day-'])assert.ok(!encoded.includes(text));
 assert.ok(!Object.hasOwn(pack,'amount')&&!Object.hasOwn(pack,'closedReason'));
});
