import {bookingMembers} from './companion-booking.js';
import {validateClientSearchSelection} from './client-search.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel} from './legacy-test-fixture.mjs';
import {receptionIntakeSuccess} from './reception.js';
import {DemoModel as ActualModel} from './core.js';
import {savePaperIntake,reviewPaperIntake,PAPER_SAFETY_QUESTIONS} from './paper-intake.js';
import {recordAssessment,confirmAssessment} from './evaluations.js';
import {INITIAL_CASE_FIELDS,paperIntakeSelection} from './paper-case-form.js';
import {purchaseLinesFromForm} from './package-purchase-ui.js';
import {approvedPurchaseReceipt,approvedPurchaseSettlement} from './package-purchase.js';
import {serviceResultSummary} from './workflow-ui.js';
import {confirmedTestSchedules} from './scheduling-test-fixture.mjs';
import {requestCustomerBooking,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion} from './customer-booking.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
class Data{constructor(f){this.data=f.data;}*keys(){yield*Object.keys(this.data);}*[Symbol.iterator](){yield*Object.entries(this.data);}getAll(k){return this.data[k]===undefined?[]:Array.isArray(this.data[k])?this.data[k]:[this.data[k]];}get(k){return this.data[k]??null;}has(k){return k in this.data;}}
export function runtime(role,type,data,suppliedModel){
 const model=suppliedModel||new DemoModel({now:()=> '2026-10-08T12:00:00.000Z'}),f={dataset:{form:type},data,isConnected:true,reportValidity:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
 const scope={model,role,TODAY:model.today,FormData:Data,document:{addEventListener:(n,fn)=>{if(n==='submit')scope.submit=fn;}},dialogContext:{key:'workflow',requestId:'workflow-submit',evidencePhotos:[]},drafts:new Map(),$:(s)=>s==='#network-toggle'?{checked:false}:null,sheet:{open:true},setTimeout:fn=>{fn();return 1;},saveDraft(){},advanceCustomerBookingForm:()=>true,render(){},showSuccess(title,html){scope.success={title,html};},formError:(f,msg)=>{scope.error=msg;},assertBoss:()=>model._boss(role),assertStaff:()=>{if(!['boss','therapist'].includes(role.type))throw new Error('无操作权限');},ctx:()=>({model,role,esc:v=>String(v??'')}),customerCtx:()=>({model,role}),esc:v=>String(v??''),name:(k,id)=>id==='boss'?'老板':model.state[k]?.find(r=>r.id===id)?.name||'待安排',money:v=>String(v),date:v=>v,pair:(k,v)=>k+v,button:()=>'',find:(k,id)=>model.state[k]?.find(r=>r.id===id),serviceResultSummary,receptionIntakeSuccess,purchaseLinesFromForm,approvedPurchaseReceipt,approvedPurchaseSettlement,INITIAL_CASE_FIELDS,paperIntakeSelection,savePaperIntake,reviewPaperIntake,recordAssessment,confirmAssessment,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion,toast(){},closeDialog(){},validateClientSearchSelection,bookingMembers};
 for(const n of ['updateEvidencePicker','updateReceptionIntakeChoices','updatePaperIntakeForm','updateScheduleForm','updateAppointmentAvailability','updateWorkflowForm'])scope[n]=()=>{};
 const start=source.indexOf("document.addEventListener('submit', async event =>"),end=source.indexOf('\nfunction exportPreview',start);vm.runInNewContext(source.slice(start,end),scope);
 return {model,f,scope,run:()=>scope.submit({target:f,preventDefault(){}})};
}
test('actual task form stores a handling result exactly once instead of completing silently',async()=>{
 const r=runtime({type:'therapist',id:'t1'},'task-complete',{id:'workflow-task',result:'已电话确认客户下周复评'});
 r.model.state.tasks.push({id:'workflow-task',clientId:'c3',storeId:'a',assigneeId:'t1',title:'联系客户',dueDate:r.model.today,status:'pending',type:'intake_followup'});
 await r.run();await r.run();const t=r.model.state.tasks.find(t=>t.id==='workflow-task');
 assert.equal(t.status,'completed');assert.equal(t.completionResult,'已电话确认客户下周复评');assert.equal(r.model.state.audit.filter(a=>a.type==='task_completed'&&a.taskId===t.id).length,1);assert.ok(r.scope.success||r.f.dataset.succeeded==='true');
});
test('actual boss assignment form binds the second store without changing the global owner',async()=>{
 const r=runtime({type:'boss',id:'boss'},'assign-store-therapist',{clientId:'c3',storeId:'b',therapistId:'t2',reason:'客户在崂山办卡，需要本店执行师'});await r.run();
 const c=r.model.state.clients.find(c=>c.id==='c3');assert.equal(c.storeTherapistIds?.b,'t2');assert.equal(c.ownerId,'t1');assert.ok(r.scope.success);
});
test('actual customer cancellation form keeps the original appointment slot pending staff handling',async()=>{
 const r=runtime({type:'customer',id:'c1'},'appointment-cancel-request',{id:'a1',reason:'当天临时有事'});await r.run();
 const a=r.model.state.appointments.find(a=>a.id==='a1');assert.equal(a.cancellationRequest?.status,'pending');assert.equal(a.status,'confirmed');assert.equal(a.time,'10:00');assert.ok(r.scope.success);
});


test('actual manager new single-booking form saves exactly once',async()=>{const r=runtime({type:'manager',id:'m1'},'appointment-create',{clientId:'c1',storeId:'a',date:'2026-10-12',time:'11:30',principalId:'t1',project:'阶段复评'});confirmedTestSchedules(r.model);const before=r.model.state.appointments.length;await r.run();await r.run();assert.equal(r.scope.error,undefined);assert.equal(r.f.dataset.succeeded,'true');assert.equal(r.model.state.appointments.length,before+1);assert.equal(r.model.state.audit[0].actorType,'manager');});

test('actual manager confirms requests while existing booking and business writes remain refused',async()=>{const r=runtime({type:'manager',id:'m1'},'customer-booking-confirm',{});confirmedTestSchedules(r.model);const req=requestCustomerBooking(r.model,{storeId:'a',date:'2026-10-12',time:'11:30',principalId:'t1',project:'阶段复评',requestId:'real-form-request'},{type:'customer',id:'c1'});r.f.data.id=req.id;await r.run();assert.equal(r.scope.error,undefined);assert.equal(r.model.state.bookingRequests[0].confirmedBy,'m1');for(const type of ['appointment-edit','record-receipt','customer-booking-resolve','multi-day-booking']){const d=runtime({type:'manager',id:'m1'},type,{}),before=JSON.stringify([d.model.state,d.model.sequence]);await d.run();assert.match(d.scope.error,/店长|权限/);assert.equal(JSON.stringify([d.model.state,d.model.sequence]),before);}});

// Exercise the real submit callback with real domain APIs and the actual personnel.
test('actual cross-store manager confirmation, therapist reception, first visit and selected manager assessment complete',async()=>{
 const m=confirmedTestSchedules(new ActualModel({today:'2026-10-08',now:()=> '2026-10-08T12:00:00.000Z'})),boss={type:'boss',id:'boss'},he={type:'manager',id:'m-he-zanfeng'},wu={type:'therapist',id:'t-wu-wenpei'},chen={type:'manager',id:'m-chen-kang'};
 const c=m.createReceptionClient({name:'页面链路客户',phone:'13912345678',age:32,storeId:'a',requestId:'new'},boss);
 const req=requestCustomerBooking(m,{storeId:'a',date:m.today,time:'10:00',principalId:'t-qiu-zhen',project:'基础训练',requestId:'request'},{type:'customer',id:c.id});
 const confirmation=runtime(he,'customer-booking-confirm',{id:req.id},m);await confirmation.run();assert.equal(confirmation.scope.error,undefined);assert.equal(confirmation.f.dataset.succeeded,'true');
 const a=m.state.appointments.find(a=>a.id===m.state.bookingRequests.find(r=>r.id===req.id).appointmentId);
 const arrival=runtime(wu,'record-arrival',{id:a.id,notes:'客户本人实际到店'},m);await arrival.run();assert.equal(arrival.scope.error,undefined);assert.ok(a.arrivalAt);
 const data={formVersion:'initial_case_v2',clientId:c.id,appointmentId:a.id,storeId:'a',assessorId:chen.id,occupation:'真实页面字段',sources:['internet'],medicalHistory:['surgery'],illnessDetails:'客户本次自述'};
 const intake=runtime(he,'paper-intake-create',data,m);await intake.run();assert.equal(intake.scope.error,undefined);assert.equal(intake.f.dataset.succeeded,'true');const row=m.state.paperIntakes.find(p=>p.clientId===c.id);assert.equal(row.assessorId,chen.id);assert.equal(row.formVersion,'initial_case_v2');assert.equal(row.initialCase.occupation,'真实页面字段');assert.deepEqual(row.initialCase.sources,['internet']);assert.equal('answers' in row,false);
 const review=runtime(chen,'paper-intake-review',{id:row.id,decision:'assessment',nextStep:'完成本人专业评估',assigneeId:'boss',dueDate:m.today},m);await review.run();assert.equal(review.scope.error,undefined);assert.equal(m.state.paperIntakes.find(p=>p.id===row.id).status,'reviewed');
 const assess=runtime(chen,'assessment-create',{clientId:c.id,storeId:'a',assessorId:chen.id,date:m.today,time:'10:00',type:'initial',project:'实际评估',metricName1:'活动度',metricValue1:'90',metricUnit1:'度',summary:'本次观察'},m);await assess.run();assert.equal(assess.scope.error,undefined);const assessment=m.state.assessments.find(p=>p.clientId===c.id);
 const published=runtime(chen,'assessment-confirm',{id:assessment.id},m);await published.run();assert.equal(published.scope.error,undefined);assert.equal(assessment.status,'confirmed');
 assert.equal(m.canSeeClient(he,c.id),false);assert.equal(m.canSeeClient(wu,c.id),false);assert.equal(m.state.services.filter(s=>s.clientId===c.id).length,0);
});

test('actual cancellation dispatch requires approval, permits local manager decision, and never broadens another store',async()=>{
 const m=confirmedTestSchedules(new DemoModel({today:'2026-10-08',now:()=> '2026-10-08T12:00:00Z'}));
 const front={type:'frontdesk',id:'f1'},manager={type:'manager',id:'m1'};
 const request=runtime(front,'appointment-cancel',{id:'a3',reason:'前台申请取消'},m);await request.run();assert.equal(request.scope.error,undefined);assert.equal(m.state.appointments.find(a=>a.id==='a3').status,'confirmed');assert.equal(m.state.appointments.find(a=>a.id==='a3').cancellationRequest.requestId,'workflow-submit');
 const denied=runtime(front,'appointment-cancel-handle',{id:'a3',decision:'approve',reason:'前台自己批准'},m),before=JSON.stringify(m.state);await denied.run();assert.match(denied.scope.error,/审批|老板|店长/);assert.equal(JSON.stringify(m.state),before);
 const reject=runtime(manager,'appointment-cancel-handle',{id:'a3',decision:'reject',reason:'保留客户时段'},m);await reject.run();assert.equal(reject.scope.error,undefined);assert.equal(m.state.appointments.find(a=>a.id==='a3').cancellationRequest.status,'rejected');
 const second=runtime(front,'appointment-cancel-request',{id:'a3',reason:'第二次前台申请'},m);second.scope.dialogContext.requestId='second';await second.run();assert.equal(second.scope.error,undefined);
 const approve=runtime(manager,'appointment-cancel-handle',{id:'a3',decision:'approve',reason:'已核对同意'},m);await approve.run();assert.equal(approve.scope.error,undefined);const final=JSON.stringify(m.state);await approve.run();assert.equal(JSON.stringify(m.state),final);assert.equal(m.state.appointments.find(a=>a.id==='a3').status,'cancelled');
 const cross=runtime(manager,'appointment-cancel',{id:'a1',reason:'跨店'},m);await cross.run();assert.match(cross.scope.error,/本店|权限/);
});

test('actual frontdesk customer acceptance forwards for approval and revoked accounts cannot submit or replay',async()=>{
 const m=confirmedTestSchedules(new DemoModel({today:'2026-10-08',now:()=> '2026-10-08T12:00:00Z'})),front={type:'frontdesk',id:'f1'};
 m.requestAppointmentCancellation('a3',{reason:'本人有事'},{type:'customer',id:'c3'});
 const accept=runtime(front,'appointment-cancel-handle',{id:'a3',decision:'approve',reason:'已核对，报批'},m);await accept.run();assert.equal(accept.scope.error,undefined);assert.match(accept.scope.success.title,/申请.*审批/);assert.equal(m.state.appointments.find(a=>a.id==='a3').status,'confirmed');
 const replay=runtime(front,'appointment-cancel-handle',{id:'a3',decision:'approve',reason:'已核对，报批'},m),same=JSON.stringify(m.state);await replay.run();assert.equal(replay.scope.error,undefined);assert.equal(JSON.stringify(m.state),same);
 m.state.frontDesks.find(f=>f.id==='f1').active=false;const disabled=runtime(front,'appointment-cancel-handle',{id:'a3',decision:'approve',reason:'已核对，报批'},m),before=JSON.stringify(m.state);await disabled.run();assert.match(disabled.scope.error,/在职|停用/);assert.equal(JSON.stringify(m.state),before);
 const manager={type:'manager',id:'m1'};m.state.storeManagers.find(p=>p.id==='m1').active=false;const managerBefore=JSON.stringify(m.state),approval=runtime(manager,'appointment-cancel-handle',{id:'a3',decision:'approve',reason:'批准'},m);await approval.run();assert.match(approval.scope.error,/权限|店长/);assert.equal(JSON.stringify(m.state),managerBefore);
});

test('actual employee appointment-edit submit is denied without touching stored appointment',async()=>{for(const role of [{type:'frontdesk',id:'f1'},{type:'therapist',id:'t1'}]){const r=runtime(role,'appointment-edit',{id:'a3',clientId:'c3',storeId:'a',principalId:'t1',date:'2026-10-10',time:'15:00',project:'训练'});confirmedTestSchedules(r.model);const before=JSON.stringify([r.model.state,r.model.sequence]);await r.run();assert.match(r.scope.error,/老板|修改|权限/);assert.equal(JSON.stringify([r.model.state,r.model.sequence]),before);}});

test('actual cash-closing submit preserves frontdesk initial input but refuses amendment and boss retains a new history version',async()=>{
 const front={type:'frontdesk',id:'f1'},boss={type:'boss',id:'boss'},data={storeId:'a',date:'2026-10-08',version:'0',actualWechat:'0',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'首次核对'},r=runtime(front,'cash-closing',data);await r.run();assert.equal(r.scope.error,undefined);assert.equal(r.model.state.cashClosings.length,1);const before=JSON.stringify([r.model.state,r.model.sequence]);
 const denied=runtime(front,'cash-closing',{...data,version:'1',notes:'改老记录'},r.model);denied.scope.dialogContext.requestId='closing-edit';await denied.run();assert.match(denied.scope.error,/老板|权限|修改/);assert.equal(JSON.stringify([r.model.state,r.model.sequence]),before);
 const approved=runtime(boss,'cash-closing',{...data,version:'1',notes:'老板重核'},r.model);approved.scope.dialogContext.requestId='closing-boss-edit';await approved.run();assert.equal(approved.scope.error,undefined);assert.equal(r.model.state.cashClosings.length,2);assert.equal(r.model.state.cashClosings[0].notes,'首次核对');assert.equal(r.model.state.cashClosings[1].notes,'老板重核');
});

test('actual therapist new-client submit keeps routine entry without customer phone and blocks a forged number',async()=>{
 const r=runtime({type:'therapist',id:'t1'},'reception-create-client',{name:'实际提交无电话',age:'30',storeId:'a'});
 await r.run();assert.equal(r.scope.error,undefined);assert.ok(r.scope.success);const c=r.model.state.clients.find(c=>c.name==='实际提交无电话');assert.equal(c.phone,'');assert.match(r.scope.success.html,/老板.*核对|老板.*补充/);
 const blocked=runtime({type:'therapist',id:'t1'},'reception-create-client',{name:'不能猜号码',age:'30',storeId:'a',phone:'13800000003'}),before=JSON.stringify(blocked.model.state);await blocked.run();assert.match(blocked.scope.error,/康复师.*手机号/);assert.equal(JSON.stringify(blocked.model.state),before);
});
test('actual reception selector dispatch uses fresh arrived appointment and rejects stale search selection',async()=>{const m=new ActualModel(),wu={type:'therapist',id:'t-wu-wenpei'};m.state.appointments.push({id:'picker-arrived',clientId:'c1',storeId:'a',date:m.today,time:'10:00',principalId:'t-qiu-zhen',status:'confirmed',arrivalAt:m.now()});const d={clientId:'c1',appointmentId:'picker-arrived',paperClientQuery:m._client('c1').name};const r=runtime(wu,'paper-intake-select',d,m);r.scope.openDialog=(type,id)=>{r.scope.opened={type,id};};await r.run();assert.deepEqual(r.scope.opened,{type:'staff-intake-create',id:'picker-arrived'});const denied=runtime(wu,'paper-intake-select',{...d,paperClientQuery:'不匹配'},m);denied.scope.openDialog=()=>assert.fail('must not open stale selection');await denied.run();assert.match(denied.scope.error,/当前搜索|已到店/);m.state.appointments.find(a=>a.id==='picker-arrived').cancellationRequest={status:'pending'};const revoked=runtime(wu,'paper-intake-select',d,m);await revoked.run();assert.match(revoked.scope.error,/当前搜索|已到店/);});
test('actual new paper form cannot submit therapist phone candidates and makes no write',async()=>{const m=new ActualModel(),wu={type:'therapist',id:'t-wu-wenpei'};m.state.appointments.push({id:'phone-arrived',clientId:'c1',storeId:'a',date:m.today,time:'10:00',principalId:'t-qiu-zhen',status:'confirmed',arrivalAt:m.now()});for(const phone of [m._client('c1').phone,'13912345678']){const before=JSON.stringify(m.state),r=runtime(wu,'paper-intake-create',{formVersion:'initial_case_v2',clientId:'c1',appointmentId:'phone-arrived',storeId:'a',assessorId:'tao',phone},m);await r.run();assert.match(r.scope.error,/康复师.*手机号/);assert.equal(JSON.stringify(m.state),before);}});

test('actual franchise assessment create dispatch refuses new professional record without changing old clinical evidence',async()=>{
 const m=new ActualModel({now:()=> '2026-10-08T12:00:00Z'}),boss={type:'boss',id:'boss'},f=m.addFranchiseOwner({name:'虚构临床边界加盟',phone:'13899005222',storeIds:['a'],reason:'本店经营',requestId:'assessment-owner'},boss),role={type:'franchise_owner',id:f.id};
 const before=JSON.stringify(m.state),run=runtime(role,'assessment-create',{clientId:'c3',storeId:'a',assessorId:'tao',date:m.today,time:'10:00',type:'initial',project:'康复评估',metricName1:'活动范围',metricValue1:'记录',summary:'测试',requestId:'franchise-assessment'},m);await run.run();
 assert.match(run.scope.error,/评估|权限/);assert.equal(JSON.stringify(m.state),before);
});
