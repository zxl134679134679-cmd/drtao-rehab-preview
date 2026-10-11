import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel,ensureFranchisePreviewExamples} from './core.js';
import {ensureSchedules,requestScheduleChange,decideScheduleChange} from './schedules.js';
import {renderOperationsPanel,operationsDialog} from './operations-ui.js';
import {runtime} from './operations-test-runtime.mjs';

const boss={type:'boss',id:'boss'},manager={type:'manager',id:'m-chen-kang'},front={type:'frontdesk',id:'f1'};
function model(){const m=new DemoModel({now:()=> '2026-10-08T09:00:00Z'}).initializeOperationsWorkflow();ensureSchedules(m);ensureFranchisePreviewExamples(m);m.state.packages.find(p=>p.id==='p3').storeId='a';m.state.assessments??=[];m.state.assessments.push({id:'local-confirmed',clientId:'c3',storeId:'a',date:'2026-10-07',assessorId:'tao',status:'confirmed',confirmedBy:'boss',confirmedRole:'boss'});return m;}
const rows=(m,step,role=boss)=>m.workflowBlockersView(role).filter(r=>r.step===step);
const booking=m=>m.saveAppointment({clientId:'c3',storeId:'a',date:m.today,time:'12:00',principalId:'t-qiu-zhen',project:'本次康复',requestId:'actual-visit'},front);
function configureProduct(m){m.purchaseCommand('configure-catalog-product',{productId:'catalog-a-annual',storeId:'a',expectedVersion:0,name:'本店年卡',serviceContent:'康复训练',description:'本次冻结权益',priceMinor:300000,totalSessions:10,validityMonths:12,allowedServiceIds:['rehabilitation'],active:true,reason:'实际目录配置'},boss,'catalog-config');return m.state.productCatalog.find(p=>p.id==='catalog-a-annual');}

test('actual reschedule and reassignment blockers vanish after the original visit is confirmed again',()=>{
 const m=model(),a=booking(m);m.requestReschedule(a.id,{date:m.today,time:'13:00',reason:'本人调整时间'},{type:'customer',id:'c3'});
 assert.equal(rows(m,'reschedule')[0]?.sourceId,a.id);
 assert.deepEqual(rows(m,'reschedule')[0]?.responsible,boss);
 m.saveAppointment({id:a.id,clientId:'c3',storeId:'a',date:m.today,time:'13:00',principalId:'t-qiu-zhen',project:'本次康复'},boss);
 assert.equal(rows(m,'reschedule').length,0);
 m.state.appointments.find(p=>p.id===a.id).status='pending_reassignment';
 assert.equal(rows(m,'reassignment')[0]?.sourceId,a.id);
 m.saveAppointment({id:a.id,clientId:'c3',storeId:'a',date:m.today,time:'15:00',principalId:'t-qiu-zhen',project:'本次康复'},boss);
 assert.equal(rows(m,'reassignment').length,0);
});

test('pending staff shift requests alert only their store owner and disappear after an actual decision',()=>{
 const m=model(),shift=m.state.staffSchedules.find(s=>s.therapistId==='t-qiu-zhen'&&s.date===m.today),request=requestScheduleChange(m,{therapistId:'t-qiu-zhen',storeId:'a',date:m.today,status:'work',startTime:'10:00',endTime:'19:00',expectedVersion:shift.version,reason:'本人确认出诊调整',requestId:'pending-shift'},front);
 assert.equal(rows(m,'schedule_approval')[0]?.sourceId,request.id);
 assert.equal(rows(m,'schedule_approval',{type:'franchise_owner',id:'franchise-preview-suzhou'}).length,0);
 assert.equal(rows(m,'schedule_approval')[0]?.overdue,false);
 m.now=()=> '2026-10-08T10:00:00Z';assert.equal(rows(m,'schedule_approval')[0]?.overdue,true);
 decideScheduleChange(m,request.id,{decision:'approved',reason:'本人出诊已确认',requestId:'decide-shift'},boss);
 assert.equal(rows(m,'schedule_approval').length,0);
});

test('purchase intent, approval and approved execution blockers track actual purchase transitions',()=>{
 const m=model(),p=configureProduct(m),lines=[{productId:p.id,catalogVersion:p.version,quantity:1}];
 const intent=m.purchaseCommand('submit-purchase-intent',{storeId:'a',lines},{type:'customer',id:'c3'},'intent');
 assert.equal(rows(m,'purchase_intent')[0]?.sourceId,intent.id);assert.equal(rows(m,'purchase_intent')[0]?.responsible.type,'frontdesk');
 const quote=m.purchaseCommand('submit-purchase-quote',{storeId:'a',intentId:intent.id,lines,amountMinor:300000,businessRecipient:null,reason:'本人意愿核价'},front,'quote');
 assert.equal(rows(m,'purchase_intent').length,0);assert.equal(rows(m,'amount_approval')[0]?.sourceId,quote.id);
 m.purchaseCommand('approve-amount-application',{applicationId:quote.id,expectedVersion:0,decision:'approve',reason:'本店批准'},manager,'approve');
 assert.equal(rows(m,'amount_approval').length,0);assert.equal(rows(m,'amount_execution')[0]?.sourceId,quote.id);assert.equal(rows(m,'amount_execution')[0]?.responsible.id,'f1');
 m.purchaseCommand('complete-approved-purchase',{applicationId:quote.id,expectedVersion:1,existingClientId:'c3',reason:'核对后登记'},front,'complete');
 assert.equal(rows(m,'amount_execution').length,0);assert.equal(rows(m,'activation').length,1);
});

test('approved actual cash command is visible until the frontdesk executes its frozen payload',()=>{
 const m=model(),application=m.purchaseCommand('submit-amount-application',{storeId:'a',command:'record-receipt',payload:{clientId:'c3',storeId:'a',purpose:'single',date:m.today,time:'11:00',amount:'300',channel:'direct',method:'wechat',notes:'实际到账'},reason:'金额待核对'},front,'cash-application');
 m.purchaseCommand('approve-amount-application',{applicationId:application.id,expectedVersion:0,decision:'approve',reason:'本店金额核准'},manager,'cash-approve');
 assert.equal(rows(m,'amount_execution')[0]?.sourceId,application.id);
 m.purchaseCommand('execute-approved-amount',{applicationId:application.id,expectedVersion:1},front,'cash-execute');
 assert.equal(rows(m,'amount_execution').length,0);
});

test('feedback followup is derived from the actual service store and disappears after owner resolution',()=>{
 const m=model(),review=m.submitReview('s1',{score:2,feedback:'本次需要回访',wantContact:true},{type:'customer',id:'c1'});
 const actual=rows(m,'review_followup')[0];assert.equal(actual?.sourceId,review.id);assert.equal(actual?.storeId,'b');
 assert.equal(m.state.clients.find(c=>c.id==='c1').storeId,'a','feedback follows the actual service store, not the home store');
 assert.equal(rows(m,'review_followup',{type:'franchise_owner',id:'franchise-preview-suzhou'}).length,0);
 m.closeFollowup(review.id,'已由老板本人回访核对',boss);assert.equal(rows(m,'review_followup').length,0);
});

test('cash reconciliation blockers disappear only on actual settlement and original receipt association',()=>{
 const m=model(),receipt=m.recordReceipt({clientId:'c3',storeId:'a',purpose:'package',date:m.today,time:'11:00',amount:'300',channel:'meituan',method:'bank',settlementStatus:'pending',reference:'virtual-unsettled',notes:'平台待核对',requestId:'pending-cash'},boss);
 assert.equal(rows(m,'finance_settlement')[0]?.sourceId,receipt.id);assert.equal(rows(m,'finance_link')[0]?.sourceId,receipt.id);
 m.linkReceiptPackage({receiptId:receipt.id,packageId:'p3',reason:'原套餐已核对',requestId:'associate'},boss);assert.equal(rows(m,'finance_link').length,0);
 m.settleReceipt(receipt.id,{date:m.today,time:'11:30',amount:'300',method:'bank',reference:'virtual-settlement',notes:'实际到账已核对',requestId:'settlement'},boss);assert.equal(rows(m,'finance_settlement').length,0);
});

test('cancellation owner responsibility and backup are distinct active approvers and update on withdrawal',()=>{
 const m=model(),a=booking(m);m.state.franchiseOwners.push({id:'owner-a',name:'本店加盟老板测试',active:true,storeIds:['a']});
 m.configureReceptionDuty({storeId:'a',date:m.today,primary:front,backup:manager,responseMinutes:15,reason:'本班接待交接',requestId:'duty'},boss);
 m.requestAppointmentCancellation(a.id,{reason:'本人不能到店',requestId:'cancel'},front);
 let row=rows(m,'cancellation')[0];assert.deepEqual(row?.responsible,manager);assert.deepEqual(row?.backup,{type:'franchise_owner',id:'owner-a'});
 const task=m.state.tasks.find(t=>t.appointmentId===a.id&&t.type==='appointment_cancellation');assert.equal(task.backupId,'owner-a');assert.equal(task.backupRole,'franchise_owner');
 m.state.storeManagers.find(p=>p.id===manager.id).active=false;row=rows(m,'cancellation')[0];assert.deepEqual(row?.responsible,{type:'franchise_owner',id:'owner-a'});assert.deepEqual(row?.backup,boss);
 m.handleAppointmentCancellation(a.id,{decision:'approve',reason:'本店老板核对后批准',requestId:'cancel-approved'},{type:'franchise_owner',id:'owner-a'});assert.equal(rows(m,'cancellation').length,0);
});

test('expanded queue rendering filters the requested authorized store without mutating notices or exposing feedback',()=>{
 const m=model(),p=configureProduct(m);m.purchaseCommand('submit-purchase-intent',{storeId:'a',lines:[{productId:p.id,catalogVersion:p.version,quantity:1}]},{type:'customer',id:'c3'},'visible-intent');
 m.submitReview('s1',{score:2,feedback:'PRIVATE_FEEDBACK',wantContact:true},{type:'customer',id:'c1'});
 const before=JSON.stringify(m.state),html=renderOperationsPanel({model:m,role:boss,filters:{}});assert.match(html,/购买意愿待门店核价/);assert.match(html,/反馈待老板跟进/);assert.match(html,/责任人/);assert.doesNotMatch(html,/PRIVATE_FEEDBACK/);
 assert.equal(JSON.stringify(m.state),before);assert.deepEqual(m.workflowBlockersView(boss),m.workflowBlockersView(boss));assert.equal(JSON.stringify(m.state),before);
 const foreign=renderOperationsPanel({model:m,role:boss,filters:{storeId:'store-suzhou'}});assert.doesNotMatch(foreign,/购买意愿待门店核价|反馈待老板跟进/);
 const managerHtml=renderOperationsPanel({model:m,role:manager,filters:{storeId:'a'}});assert.doesNotMatch(managerHtml,/反馈待老板跟进|PRIVATE_FEEDBACK/);
});

test('current franchise owner resolves feedback through the actual operations form dispatcher within service-store scope',async()=>{
 const m=model(),review=m.submitReview('s1',{score:2,feedback:'PRIVATE_FEEDBACK',wantContact:true},{type:'customer',id:'c1'}),owner={type:'franchise_owner',id:'owner-b'};
 m.state.franchiseOwners.push({id:owner.id,name:'崂山当前老板测试',active:true,storeIds:['b']});
 const before=JSON.stringify(m.state);assert.throws(()=>operationsDialog('ops-review-followup',review.id,{model:m,role:{type:'franchise_owner',id:'franchise-preview-suzhou'}}),/权限|授权|门店/);assert.equal(JSON.stringify(m.state),before);
 const dialog=operationsDialog('ops-review-followup',review.id,{model:m,role:owner});assert.match(dialog.html,/name="reviewId"/);assert.doesNotMatch(dialog.html,/PRIVATE_FEEDBACK/);
 const html=renderOperationsPanel({model:m,role:owner,filters:{storeId:'b'}});assert.match(html,/data-action="ops-review-followup"/);
 const app=runtime(owner,'ops-review-followup',{reviewId:review.id,reason:'老板实际回访并核对处理结果'},m);await app.run();assert.equal(app.scope.error,undefined);assert.ok(app.scope.success);assert.equal(rows(m,'review_followup',owner).length,0);assert.equal(m.state.reviews.find(r=>r.id===review.id).resolvedBy,owner.id);
});

test('a duty cannot disguise the same responsible identity as its own backup with extra display fields',()=>{
 const m=model(),before=JSON.stringify(m.state);assert.throws(()=>m.configureReceptionDuty({storeId:'a',date:m.today,primary:manager,backup:{...manager,label:'替补显示名'},responseMinutes:30,reason:'实际主备核对',requestId:'duplicate-identity'},boss),/不同/);assert.equal(JSON.stringify(m.state),before);
});

test('usable paid single-service rights remove the billing blocker and revocation restores it',()=>{
 const m=model();assert.ok(rows(m,'billing_setup').some(r=>r.clientId==='c6'));
 const receipt=m.recordReceipt({clientId:'c6',storeId:'a',purpose:'single',date:m.today,time:'11:00',amount:'300',channel:'direct',method:'wechat',notes:'实际单次到账',requestId:'actual-single-rights'},boss);
 assert.equal(rows(m,'billing_setup').some(r=>r.clientId==='c6'),false);
 m.voidReceipt(receipt.id,'老板核对后撤销错误原到账',boss);assert.equal(rows(m,'billing_setup').some(r=>r.clientId==='c6'),true);
});
