import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel} from './core.js';
import {serviceResultSummary} from './workflow-ui.js';
import {confirmedTestSchedules} from './scheduling-test-fixture.mjs';
import {requestCustomerBooking,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion} from './customer-booking.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
class Data{constructor(f){this.data=f.data;}*[Symbol.iterator](){yield*Object.entries(this.data);}getAll(k){return this.data[k]===undefined?[]:[this.data[k]];}has(k){return k in this.data;}}
function runtime(role,type,data){
 const model=new DemoModel({now:()=> '2026-10-08T12:00:00.000Z'}),f={dataset:{form:type},data,isConnected:true,reportValidity:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
 const scope={model,role,TODAY:model.today,FormData:Data,document:{addEventListener:(n,fn)=>{if(n==='submit')scope.submit=fn;}},dialogContext:{key:'workflow',requestId:'workflow-submit',evidencePhotos:[]},drafts:new Map(),$:(s)=>s==='#network-toggle'?{checked:false}:null,sheet:{open:true},setTimeout:fn=>{fn();return 1;},saveDraft(){},advanceCustomerBookingForm:()=>true,render(){},showSuccess(title,html){scope.success={title,html};},formError:(f,msg)=>{scope.error=msg;},assertBoss:()=>model._boss(role),assertStaff:()=>{if(!['boss','therapist'].includes(role.type))throw new Error('无操作权限');},ctx:()=>({model,role}),customerCtx:()=>({model,role}),esc:v=>String(v??''),name:(k,id)=>id==='boss'?'老板':model.state[k]?.find(r=>r.id===id)?.name||'待安排',money:v=>String(v),date:v=>v,pair:(k,v)=>k+v,button:()=>'',find:(k,id)=>model.state[k]?.find(r=>r.id===id),serviceResultSummary,confirmCustomerBooking,resolveCustomerBooking,acceptCustomerBookingSuggestion,toast(){},closeDialog(){}};
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


test('actual manager single-booking form saves once with the real manager identity',async()=>{
 const r=runtime({type:'manager',id:'m1'},'appointment-create',{clientId:'c1',storeId:'a',date:'2026-10-12',time:'11:30',principalId:'t1',project:'阶段复评'});confirmedTestSchedules(r.model);
 const before=r.model.state.appointments.length;await r.run();await r.run();
 assert.equal(r.model.state.appointments.length,before+1);assert.equal(r.f.dataset.succeeded,'true');assert.equal(r.model.state.audit[0].actorType,'manager');assert.equal(r.scope.error,undefined);
});

test('actual manager pending-confirmation form confirms once and keeps unrelated submit types refused',async()=>{
 const r=runtime({type:'manager',id:'m1'},'customer-booking-confirm',{});confirmedTestSchedules(r.model);
 const req=requestCustomerBooking(r.model,{clientId:'c1',storeId:'a',date:'2026-10-12',time:'11:30',principalId:'t1',project:'阶段复评',requestId:'real-form-request'},{type:'customer',id:'c1'});r.f.data.id=req.id;
 const before=r.model.state.appointments.length;await r.run();await r.run();assert.equal(r.model.state.appointments.length,before+1);assert.equal(r.model.state.bookingRequests[0].confirmedRole,'manager');assert.equal(r.scope.error,undefined);
 for(const [type,data] of [['appointment-edit',{id:'a3'}],['appointment-cancel',{id:'a3',reason:'取消'}],['record-receipt',{}],['customer-booking-resolve',{id:req.id,outcome:'rejected',reason:'不能安排'}]]){
  const denied=runtime({type:'manager',id:'m1'},type,data),snapshot=JSON.stringify([denied.model.state,denied.model.sequence]);await denied.run();assert.match(denied.scope.error,/店长|权限/);assert.equal(JSON.stringify([denied.model.state,denied.model.sequence]),snapshot);
 }
});
