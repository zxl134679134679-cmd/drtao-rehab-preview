import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel,ensureFranchisePreviewExamples} from './core.js';
const api=await import('./operations-ui.js').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
const ctx=(model,role={type:'boss',id:'boss'})=>({model,role,filters:{storeId:'a'},esc:value=>String(value??'')});
test('operations queue gives owners scoped binding actions and real current blockers without duplicating notices',()=>{
 const m=new DemoModel({now:()=> '2026-10-08T10:00:00.000Z'});ensureFranchisePreviewExamples(m);const c=ctx(m);assert.equal(typeof api.renderOperationsPanel,'function');
 const before=JSON.stringify(m.state);const html=api.renderOperationsPanel(c);assert.match(html,/流程卡点/);assert.match(html,/ops-bind-customer/);assert.match(html,/本店店长|加盟老板/);assert.equal(JSON.stringify(m.state),before);
 const local=api.renderOperationsPanel(ctx(m,{type:'franchise_owner',id:'franchise-preview-suzhou'}));assert.doesNotMatch(local,/陈一诺|许安然/);
});
test('binding and assessment shift dialogs present reviewable simulation and actual person schedule inputs',()=>{
 const m=new DemoModel();assert.equal(typeof api.operationsDialog,'function');
 const binding=api.operationsDialog('ops-bind-customer','c3',ctx(m,{type:'manager',id:'m-chen-kang'}));assert.match(binding.html,/name="simulationId"/);assert.match(binding.html,/模拟/);
 const schedule=api.operationsDialog('ops-assessor-schedule','a',ctx(m));assert.match(schedule.html,/name="assessorId"/);assert.match(schedule.html,/name="startTime"/);assert.match(schedule.html,/name="endTime"/);
});
test('service item form parsing sends unique project-specific card sources to the domain boundary',()=>{
 assert.equal(typeof api.serviceItemsFromForm,'function');const fd=new FormData();fd.set('groupMode','true');fd.append('groupService','rehabilitation');fd.append('groupService','cryotherapy');fd.set('groupSource-rehabilitation','package:p3');fd.set('groupSource-cryotherapy','package:cold');
 assert.deepEqual(api.serviceItemsFromForm(fd),[{packageId:'p3',serviceOfferingId:'rehabilitation',project:'康复训练'},{packageId:'cold',serviceOfferingId:'cryotherapy',project:'超低温冷疗'}]);
});
test('HQ can reopen existing customer simulation for rebind while local owners cannot',()=>{
 const m=new DemoModel().initializeOperationsWorkflow();m.bindingCommand('bind-customer',{clientId:'c3',storeId:'a',simulationId:'demo-c3',reason:'当面核对'},{type:'manager',id:'m-chen-kang'},'bind');
 assert.match(api.renderOperationsPanel(ctx(m)),/data-action="ops-rebind-customer" data-id="c3"/);
 assert.doesNotMatch(api.renderOperationsPanel(ctx(m,{type:'manager',id:'m-chen-kang'})),/data-action="ops-rebind-customer"/);
});
test('all group project details resolve the single head evidence without duplicating photos',()=>{
 const m=new DemoModel().initializeOperationsWorkflow();const head={id:'head',visitId:'visit',evidenceServiceId:'head',evidencePhotos:[{id:'photo'}]},detail={id:'detail',visitId:'visit',evidenceServiceId:'head',evidencePhotos:[]};m.state.services.push(head,detail);
 assert.equal(typeof api.serviceEvidenceOwner,'function');assert.equal(api.serviceEvidenceOwner(m,detail),head);assert.deepEqual(api.serviceVisitRows(m,detail),[head,detail]);
});
test('changing to a manager-assessed appointment selects that designated person on the paper form',async()=>{
 const {updateAssessorChoices}=await import('./staff-reception.js');const m=new DemoModel().initializeOperationsWorkflow();m.state.appointments.push({id:'designated',storeId:'a',assessorId:'m-chen-kang'});const select={value:'tao',innerHTML:''},label={textContent:''};const form={dataset:{form:'paper-intake-create'},elements:{assessorId:select,storeId:{value:'a'},appointmentId:{value:'designated'}},querySelector:()=>label};
 updateAssessorChoices(form,{...ctx(m),esc:v=>String(v??'')});assert.equal(select.value,'m-chen-kang');assert.equal(label.textContent,'陈康');
});
test('imported group evidence cannot redirect a local detail to another client or store',()=>{
 const m=new DemoModel().initializeOperationsWorkflow(),head={id:'foreign-head',visitId:'other-visit',clientId:'c2',storeId:'b',appointmentId:'other-ap',evidenceServiceId:'foreign-head',evidencePhotos:[{id:'private-photo'}]},detail={id:'local-detail',visitId:'local-visit',clientId:'c3',storeId:'a',appointmentId:'local-ap',evidenceServiceId:'foreign-head',evidencePhotos:[]};m.state.services.push(head,detail);
 assert.throws(()=>api.serviceEvidenceOwner(m,detail),/照片.*关联|组合.*关联/);
});
test('actual photo action rechecks current access on the resolved group evidence head',async()=>{
 const source=await readFile(new URL('./app.js',import.meta.url),'utf8'),start=source.indexOf("    if (action === 'service-photo')"),end=source.indexOf("    if (action === 'customer-booking-back')",start),head={id:'head',visitId:'visit',clientId:'c3',storeId:'a',appointmentId:'ap',evidenceServiceId:'head',evidencePhotos:[{id:'photo',dataUrl:'PRIVATE'}]},detail={...head,id:'detail',evidenceServiceId:'head',evidencePhotos:[]};
 let shown=false;const scope={action:'service-photo',id:'detail',target:{dataset:{photoId:'photo'}},assertService:()=>detail,role:{type:'therapist',id:'t-qiu-zhen'},model:{state:{services:[head,detail]},canSeeEvidence:(_r,id)=>id==='detail'},serviceEvidenceOwner:api.serviceEvidenceOwner,showPhoto:()=>{shown=true;},name:()=>'',date:()=>''};
 vm.runInNewContext(`globalThis.open=()=>{${source.slice(start,end)}};`,scope);assert.throws(()=>scope.open(),/权限/);assert.equal(shown,false);
});
