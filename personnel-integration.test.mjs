import {workflowTypes,workflowDialog} from './workflow-ui.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel } from './core.js';
import * as staff from './staff.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const boss={type:'boss',id:'boss'};
const roles=[{type:'customer',id:'c1'},{type:'frontdesk',id:'f1'},{type:'therapist',id:'t1'},{type:'manager',id:'m1'},{type:'boss',id:'wrong'}];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function dialogs(model,role){
 const scope={workflowTypes,workflowDialog,model,role,personnelDialog:staff.personnelDialog,staffDialog:staff.staffDialog,scheduleDialog:()=>null,customerBookingTypes:new Set(),ctx:()=>({model,role,filters:{},esc})};
 const begin=source.indexOf('const evaluationTypes = '),end=source.indexOf('\nfunction draftKey(',begin);
 const guardStart=source.indexOf('function assertBoss('),guardEnd=source.indexOf('\nfunction assertService',guardStart);
 vm.runInNewContext(source.slice(guardStart,guardEnd)+'\n'+source.slice(begin,end)+'\nglobalThis.open=buildDialog;',scope);
 return scope.open;
}
class FakeData{
 constructor(form){this.data=form.data;}
 *[Symbol.iterator](){for(const [key,value]of Object.entries(this.data))for(const item of Array.isArray(value)?value:[value])yield[key,item];}
 getAll(key){const value=this.data[key];return value===undefined?[]:Array.isArray(value)?value:[value];}
 has(key){return key in this.data;}
}
function submitRuntime(model,role,simulateFailure=false){
 const button={disabled:false,textContent:'保存人员资料',dataset:{}},error={setAttribute(){}};
 const f={dataset:{form:'edit-frontdesk'},isConnected:true,data:{id:'f1',name:'示例前台新姓名',phone:'13900000011',notes:'示例人员备注',storeIds:['a','b'],active:'true',reason:'示例更正前台资料',expectedVersion:'0'},reportValidity:()=>true,querySelector:()=>error,querySelectorAll:()=>[button]};
 f.closest=()=>f;
 const toggle={checked:simulateFailure},context={requestId:'profile-ui-edit',key:'personnel-edit'};
 const scope={workflowTypes,workflowDialog,model,role,ctx:()=>({model,role,filters:{},esc}),dialogContext:context,FormData:FakeData,drafts:new Map(),document:{addEventListener(type,fn){scope.submit=fn;}},$:()=>toggle,setTimeout:resolve=>resolve(),saveDraft(){},updateEvidencePicker(){},updateReceptionIntakeChoices(){},updatePaperIntakeForm(){},updateScheduleForm(){},updateAppointmentAvailability(){},render(){scope.rendered=true;},showSuccess(title,html){scope.success={title,html};},formError(form,message){scope.error=message;},toast(message){scope.error=message;},closeDialog(){},esc,name:(kind,id)=>model.state[kind].find(row=>row.id===id)?.name||id,button:label=>label,pair:(label,value)=>`${label}: ${value}`};
 const start=source.indexOf("document.addEventListener('submit', async event => {"),end=source.indexOf('\nfunction exportPreview(',start);
 assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(start,end),scope);
 return {scope,f,event:{target:f,preventDefault(){}}};
}
test('actual boss dialog dispatch provides add and edit forms for all three personnel roles',()=>{
 const model=new DemoModel(),open=dialogs(model,boss);
 for(const [kind,id]of[['therapist','t1'],['frontdesk','f1'],['manager','m1']]){
  assert.match(open(`add-${kind}`,'').html,/name="phone"/);
  assert.match(open(`edit-${kind}`,id).html,/name="expectedVersion"/);
  assert.match(open(`edit-${kind}`,id).html,/name="reason"/);
 }
});
test('non-boss roles cannot open personnel edit or add dialogs through actual dispatch',()=>{
 const model=new DemoModel();
 for(const role of roles)for(const [kind,id]of[['therapist','t1'],['frontdesk','f1'],['manager','m1']]){
  assert.throws(()=>dialogs(model,role)(`edit-${kind}`,id),/老板|权限/);
  assert.throws(()=>dialogs(model,role)(`add-${kind}`,''),/老板|权限/);
 }
});
test('actual edit submit accepts store arrays and status, prevents double save and updates once',async()=>{
 const model=new DemoModel(),{scope,f,event}=submitRuntime(model,boss);
 await Promise.all([scope.submit(event),scope.submit(event)]);
 assert.equal(scope.error,undefined);assert.ok(scope.success);
 const person=model.state.frontDesks.find(row=>row.id==='f1');
 assert.equal(person.name,f.data.name);assert.equal(person.phone,f.data.phone);assert.equal(person.active,true);assert.deepEqual(person.storeIds,['a','b']);assert.equal(person.profileVersion,1);
 assert.equal(model.state.audit.filter(row=>row.type==='frontdesk_updated').length,1);
});
test('actual posted personnel edit is denied to every non-boss role without changing state',async()=>{
 for(const role of roles){const model=new DemoModel(),before=JSON.stringify([model.state,model.sequence]),{scope,event}=submitRuntime(model,role);await scope.submit(event);assert.match(scope.error,/老板|权限|店长/);assert.equal(JSON.stringify([model.state,model.sequence]),before);}
});
test('simulated edit failure preserves the form and changes no personnel until retry',async()=>{
 const model=new DemoModel(),before=JSON.stringify([model.state,model.sequence]),{scope,f,event}=submitRuntime(model,boss,true);
 await scope.submit(event);assert.match(scope.error,/未保存|未改变|失败/);assert.equal(JSON.stringify([model.state,model.sequence]),before);assert.equal(f.data.name,'示例前台新姓名');
 delete scope.error;await scope.submit(event);assert.equal(scope.error,undefined);assert.ok(scope.success);assert.equal(model.state.frontDesks.find(row=>row.id==='f1').profileVersion,1);
});
