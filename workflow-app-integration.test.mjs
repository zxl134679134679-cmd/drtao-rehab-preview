import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel} from './legacy-test-fixture.mjs';
import {DemoModel as ActualModel} from './core.js';
import {savePaperIntake,reviewPaperIntake,PAPER_SAFETY_QUESTIONS} from './paper-intake.js';
import {recordAssessment,confirmAssessment} from './evaluations.js';
import {serviceResultSummary} from './workflow-ui.js';
import {confirmedTestSchedules} from './scheduling-test-fixture.mjs';
import {requestCustomerBooking,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion} from './customer-booking.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
class Data{constructor(f){this.data=f.data;}*[Symbol.iterator](){yield*Object.entries(this.data);}getAll(k){return this.data[k]===undefined?[]:[this.data[k]];}has(k){return k in this.data;}}
function runtime(role,type,data,suppliedModel){
 const model=suppliedModel||new DemoModel({now:()=> '2026-10-08T12:00:00.000Z'}),f={dataset:{form:type},data,isConnected:true,reportValidity:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
 const scope={model,role,TODAY:model.today,FormData:Data,document:{addEventListener:(n,fn)=>{if(n==='submit')scope.submit=fn;}},dialogContext:{key:'workflow',requestId:'workflow-submit',evidencePhotos:[]},drafts:new Map(),$:(s)=>s==='#network-toggle'?{checked:false}:null,sheet:{open:true},setTimeout:fn=>{fn();return 1;},saveDraft(){},advanceCustomerBookingForm:()=>true,render(){},showSuccess(title,html){scope.success={title,html};},formError:(f,msg)=>{scope.error=msg;},assertBoss:()=>model._boss(role),assertStaff:()=>{if(!['boss','therapist'].includes(role.type))throw new Error('无操作权限');},ctx:()=>({model,role}),customerCtx:()=>({model,role}),esc:v=>String(v??''),name:(k,id)=>id==='boss'?'老板':model.state[k]?.find(r=>r.id===id)?.name||'待安排',money:v=>String(v),date:v=>v,pair:(k,v)=>k+v,button:()=>'',find:(k,id)=>model.state[k]?.find(r=>r.id===id),serviceResultSummary,savePaperIntake,reviewPaperIntake,recordAssessment,confirmAssessment,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion,toast(){},closeDialog(){}};
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
 const data={clientId:c.id,appointmentId:a.id,storeId:'a',assessorId:chen.id,age:'32',problem:'客户本次自述',goal:'本次目标',...Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(q=>['answer_'+q.key,'no']))};
 const intake=runtime(he,'paper-intake-create',data,m);await intake.run();assert.equal(intake.scope.error,undefined);assert.equal(intake.f.dataset.succeeded,'true');const row=m.state.paperIntakes.find(p=>p.clientId===c.id);assert.equal(row.assessorId,chen.id);
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
