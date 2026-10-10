import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel,ensureStorePackageExamples} from './core.js';
import {ensureEvaluations} from './evaluations.js';
import {ensurePaperIntakes} from './paper-intake.js';
let decision={};try {decision=await import('./boss-decision.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'};
const fixture=()=>ensurePaperIntakes(ensureEvaluations(ensureStorePackageExamples(new DemoModel({now:()=> '2026-10-08T08:00:00.000Z'}))));
const summary=(m,role=boss,options={})=>{assert.equal(typeof decision.bossDecisionSummary,'function');return decision.bossDecisionSummary(m,role,options);};
const receipt=(m,data={})=>m.recordReceipt({clientId:'c1',storeId:'a',date:m.today,time:'09:00',channel:'direct',method:'wechat',purpose:'single',amount:'1000',requestId:'decision-cash',...data},boss);
const snapshot=m=>JSON.stringify([m.state,m.sequence]);
test('exactly three read-only priorities use today and store independently of service filters',()=>{
 const m=fixture(),before=snapshot(m),s=summary(m,boss,{storeId:'a',from:'2020-01-01',to:'2020-01-01',therapistId:'t2'});
 assert.deepEqual(s.items.map(r=>r.id),['cash','flow','revenue']);assert.equal(s.date,m.today);assert.deepEqual(s.storeIds,['a']);assert.equal(s.comparison.today.net,0);assert.equal(snapshot(m),before);assert.match(s.items[0].summary,/核对|登记/);assert.doesNotMatch(s.items[0].summary,/漏收了|欠款|丢失/);
});
test('only real boss can call summary or detail and selected store must exist',()=>{
 const m=fixture();for(const role of [front,{type:'manager',id:'m1'},{type:'therapist',id:'t1'},{type:'customer',id:'c1'},{type:'boss',id:'f1'}]){
 assert.throws(()=>summary(m,role),/老板|权限/);assert.throws(()=>decision.bossDecisionDialog('cash',{model:m,role,filters:{}}),/老板|权限/);
 }assert.throws(()=>summary(m,boss,{storeId:'missing'}),/门店/);assert.throws(()=>decision.bossDecisionDialog('unknown',{model:m,role:boss,filters:{}}),/事项/);
});
test('cash comparison counts actual date once, refunds reduce actual day, seven full days include zeros',()=>{
 const m=fixture();receipt(m,{date:'2026-10-07',amount:'700',requestId:'yesterday'});const today=receipt(m,{amount:'1000.25'});
 m.refundReceipt({receiptId:today.id,date:m.today,time:'10:00',amount:'100.20',reason:'实际退款',requestId:'refund'},boss);
 const platform=receipt(m,{storeId:'b',clientId:'c2',channel:'douyin',method:'bank',settlementStatus:'pending',amount:'600',requestId:'pending',reference:'DY-pending'});
 const paid=m.settleReceipt(platform.id,{date:m.today,time:'11:00',amount:'550',reference:'actual',requestId:'settled'},boss);
 const revoked=receipt(m,{amount:'5',requestId:'voided'});m.voidReceipt(revoked.id,'录错',boss);
 const s=summary(m);assert.equal(s.comparison.today.netMinor,145005);assert.equal(s.comparison.yesterday.netMinor,70000);assert.equal(s.comparison.sevenDayAverage.net,100);assert.equal(s.comparison.sevenDayAverage.dayCount,7);assert.equal(s.comparison.today.receivedMinor,155025);assert.deepEqual(s.items[2].evidence.filter(r=>r.kind==='receipt'&&r.date===m.today).map(r=>r.id).sort(),[today.id,paid.id].sort());assert.match(s.items[2].summary,/截至|累计/);assert.match(s.items[2].nextStep,/全天|整天|完整一天/);assert.equal(s.comparison.percent,null,'incomplete day does not label growth');
});
test('zero and negative comparison basis never produces Infinity or fabricated profit',()=>{
 const m=fixture();receipt(m,{amount:'400'});const s=summary(m);assert.equal(s.comparison.yesterday.net,0);assert.equal(s.comparison.percent,null);assert.equal(s.comparison.sevenDayAverage.net,0);assert.doesNotMatch(JSON.stringify(s),/Infinity|NaN|利润|增长率/);
});
test('closing per-method offset difference stays urgent; stale is urgent even if net difference zero',()=>{
 const m=fixture();receipt(m);m.saveCashClosing({storeId:'a',date:m.today,version:0,actualWechat:'900',actualAlipay:'100',actualCash:'0',actualBank:'0',notes:'核对',requestId:'closing'},front);
 let s=summary(m,boss,{storeId:'a'});assert.equal(s.items[0].evidence[0].kind,'closing');assert.equal(s.items[0].status,'attention');assert.equal(s.items[0].evidence[0].amount,0);assert.match(s.items[0].evidence[0].label,/逐项|差额/);
 receipt(m,{amount:'100',requestId:'late-entry'});s=summary(m,boss,{storeId:'a'});assert.match(s.items[0].evidence[0].label,/账目已变化/);
});
test('unlinked package receipt and platform pending have actual trace and no duplicate cash creation',()=>{
 const m=fixture();const r=receipt(m,{purpose:'package'});receipt(m,{clientId:'c2',storeId:'b',purpose:'package',channel:'meituan',method:'bank',amount:'300',settlementStatus:'pending',requestId:'platform',reference:'MT-pending'});const before=snapshot(m),s=summary(m,boss,{storeId:'a'});
 assert.ok(s.items[0].evidence.some(e=>e.id===r.id&&e.kind==='receipt-link'&&e.action==='receipt-detail'));assert.ok(s.items[0].evidence.every(e=>e.storeId==='a'));assert.equal(snapshot(m),before);
});
test('arrival is unfinished flow evidence, not automatically completed or revenue; exact record links are safe',()=>{
 const m=fixture();m.state.appointments.push({id:'arrived',clientId:'c3',storeId:'a',date:m.today,time:'10:00',principalId:'t1',status:'confirmed',project:'训练',arrivalAt:'2026-10-08T02:00:00Z',arrivalBy:'f1',arrivalByRole:'frontdesk'});
 const s=summary(m,boss,{storeId:'a'}),e=s.items[1].evidence.find(e=>e.id==='arrived');assert.equal(e.kind,'arrival');assert.equal(e.action,'appointment-history');assert.equal(e.actionId,'c3');assert.equal(e.followAction,'register-appointment');assert.equal(e.followActionId,'arrived');assert.match(e.label,/核实服务完成/);assert.equal(s.comparison.today.net,0);assert.equal(s.comparison.serviceCount,0);assert.ok(e.ownerName);assert.ok(e.date);
});
test('cleared day shows routine checks instead of inventing three emergencies',()=>{
 const m=fixture();m.state.appointments=[];m.state.tasks=[];m.state.assessments=[];m.state.paperIntakes=[];m.state.bookingRequests=[];
 for(const store of m.state.stores){m.saveCashClosing({storeId:store.id,date:m.today,version:0,actualWechat:'0',actualAlipay:'0',actualCash:'0',actualBank:'0',requestId:'close-'+store.id},boss);const c=m.cashClosingSummary(boss,{storeId:store.id,date:m.today}).record;m.confirmCashClosing(c.id,{version:c.version,requestId:'confirm-'+store.id},boss);}
 const s=summary(m);assert.equal(s.items[0].status,'normal');assert.equal(s.items[1].status,'normal');assert.equal(s.items[1].count,0);assert.match(s.encouragement,/一步|件|稳|积累/);assert.doesNotMatch(s.encouragement,/优秀|增长|稳赚/);
});

test('historical unresolved closing is visible even when today is fully confirmed',()=>{
 const m=fixture();receipt(m,{date:'2026-10-07',amount:'100'});m.saveCashClosing({storeId:'a',date:'2026-10-07',version:0,actualWechat:'0',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'历史未核对',requestId:'historical-close'},front);m.saveCashClosing({storeId:'a',date:m.today,version:0,actualWechat:'0',actualAlipay:'0',actualCash:'0',actualBank:'0',requestId:'today-close'},boss);const c=m.cashClosingSummary(boss,{storeId:'a',date:m.today}).record;m.confirmCashClosing(c.id,{version:c.version,requestId:'today-confirm'},boss);const s=summary(m,boss,{storeId:'a'});assert.equal(s.items[0].status,'attention');const e=s.items[0].evidence.find(e=>e.kind==='closing');assert.equal(e.date,'2026-10-07');assert.equal(e.amount,-100);assert.ok(e.actionId.includes('2026-10-07'));
});
test('cancelled or revoked tasks are never described as pending problems',()=>{
 const m=fixture();m.state.tasks.push({id:'cancelled-task',clientId:'c3',storeId:'a',assigneeId:'t1',dueDate:'2026-10-01',title:'已取消事项',status:'cancelled'});const s=summary(m,boss,{storeId:'a'});assert.ok(!s.items[1].evidence.some(e=>e.id==='cancelled-task'));
});

test('historical issues do not hide todays independent unrecorded closing',()=>{
 const m=fixture();receipt(m,{date:'2026-10-07',amount:'100'});m.saveCashClosing({storeId:'a',date:'2026-10-07',version:0,actualWechat:'0',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'历史未核对',requestId:'historical-only'},front);const s=summary(m,boss,{storeId:'a'});assert.ok(s.items[0].evidence.some(e=>e.kind==='closing'&&e.date==='2026-10-07'));assert.ok(s.items[0].evidence.some(e=>e.kind==='closing-check'&&e.date===m.today));
});
test('indexed daily closing evidence matches core current snapshot after void and refund edits',()=>{
 const m=fixture();const a=receipt(m,{date:'2026-10-07',amount:'100'});m.saveCashClosing({storeId:'a',date:'2026-10-07',version:0,actualWechat:'100',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'旧账核对',requestId:'index-equality'},front);const refund=m.refundReceipt({receiptId:a.id,date:'2026-10-07',time:'11:00',amount:'20',reason:'实际退款',requestId:'index-refund'},boss);m.voidRefund(refund.id,'先核对原退款',boss);m.voidReceipt(a.id,'先核对原账',boss);const original=m.cashClosingSummary(boss,{storeId:'a',date:'2026-10-07'});const e=summary(m,boss,{storeId:'a'}).items[0].evidence.find(e=>e.kind==='closing'&&e.date==='2026-10-07');assert.match(e.label,/账目已变化/);assert.equal(e.amount,original.record.actualTotal-original.expectedTotal);
});
