import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel} from './core.js';
import {restoreAssessorDraft} from './staff-reception.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('actual app shared new-booking constrainer loads real therapists and follows store changes',()=>{
 const model=new DemoModel(),role={type:'manager',id:'m-he-zanfeng'},select={value:'',innerHTML:''},store={value:'a'},form={dataset:{form:'appointment-create',staffReception:'true'},elements:{storeId:store},querySelector:s=>s==='[name="clientId"]'?{value:'c1'}:s==='[name="principalId"]'?select:s==='.assignment-note'?{}:null};
 const priorVisibility=model.canSeeClient(role,'c1');
 const scope={model,role,$:()=>form,esc:String,find:(kind,id)=>model.state[kind]?.find(p=>p.id===id)};
 const start=source.indexOf('function constrainStaffChoices('),end=source.indexOf("\nsheet.addEventListener('cancel'",start);vm.runInNewContext(source.slice(start,end)+'\nglobalThis.run=constrainStaffChoices;',scope);
 scope.run('staff-booking-create','');assert.match(select.innerHTML,/邱振/);assert.match(select.innerHTML,/邹宗霖/);assert.doesNotMatch(select.innerHTML,/武文沛/);assert.equal(model.canSeeClient(role,'c1'),priorVisibility);
 store.value='b';scope.run('appointment-create','');assert.match(select.innerHTML,/武文沛/);assert.doesNotMatch(select.innerHTML,/邱振|邹宗霖/);
});
test('reopened draft restores its lawful store assessor after option rebuilding and rejects a stale person',()=>{
 const model=new DemoModel(),select={value:'',innerHTML:''},form={dataset:{form:'reception-create-client'},elements:{storeId:{value:'b'},assessorId:select}},ctx={model,esc:String};
 restoreAssessorDraft(form,{entries:[['storeId','b'],['assessorId','m-he-zanfeng']]},ctx);assert.equal(select.value,'m-he-zanfeng');
 restoreAssessorDraft(form,{entries:[['assessorId','m-chen-kang']]},ctx);assert.equal(select.value,'m-he-zanfeng');
 model.state.storeManagers.find(p=>p.id==='m-he-zanfeng').active=false;restoreAssessorDraft(form,{entries:[['assessorId','m-he-zanfeng']]},ctx);assert.equal(select.value,'tao');
});

test('shared appointment cards retain basic cancellation status for every staff while local approval alone is actionable',async()=>{
 const {renderStaffReception}=await import('./staff-reception.js'),{workflowDialog}=await import('./workflow-ui.js');
 const model=new DemoModel(),boss={type:'boss',id:'boss'},chen={type:'manager',id:'m-chen-kang'},he={type:'manager',id:'m-he-zanfeng'},qiu={type:'therapist',id:'t-qiu-zhen'},front={type:'frontdesk',id:'f1'};
 model.state.appointments.push({id:'actual-cancel',clientId:'c1',storeId:'a',date:model.today,time:'15:00',project:'训练',principalId:qiu.id,status:'confirmed'});
 const ctx=role=>({model,role,esc:String});
 assert.match(workflowDialog('appointment-cancel-request','actual-cancel',ctx(front)).html,/老板或本店店长批准前/);
 model.cancelAppointment('actual-cancel','申请',front,{requestId:'r'});
 for(const role of [front,he,qiu]){const html=renderStaffReception(ctx(role));assert.match(html,/取消待处理 \/ 审批/);assert.doesNotMatch(html,/data-action="(?:staff-arrival|appointment-cancel-handle)" data-id="actual-cancel"/);}
 assert.match(renderStaffReception(ctx(chen)),/data-action="appointment-cancel-handle" data-id="actual-cancel"/);
 model.handleAppointmentCancellation('actual-cancel',{decision:'approve',reason:'同意'},chen);
 const html=renderStaffReception(ctx(he));assert.match(html,/已取消/);assert.match(html,/data-action="staff-appointment" data-id="actual-cancel"/);assert.doesNotMatch(html,/data-action="staff-arrival" data-id="actual-cancel"/);
});
