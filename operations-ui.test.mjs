import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DemoModel,ensureFranchisePreviewExamples} from './core.js';
import {ensureSchedules} from './schedules.js';
import {savePaperIntake,reviewPaperIntake,paperIntakeDialog} from './paper-intake.js';
import {recordAssessment,confirmAssessment,evaluationDialog} from './evaluations.js';
import {bossDecisionDialog} from './boss-decision.js';
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

const hq={type:'boss',id:'boss'},selectedManager={type:'manager',id:'m-chen-kang'},localOwner={type:'franchise_owner',id:'current-owner-a'},actualFront={type:'frontdesk',id:'f1'};
function actualClinicalVisit(selected='m-chen-kang'){
 const m=new DemoModel({now:()=> '2026-10-08T09:00:00.000Z'}).initializeOperationsWorkflow();ensureSchedules(m);
 m.state.appointments=[];m.state.assessments=[];m.state.frontDeskEvaluations=[];m.state.paperIntakes=[];
 m._client('c3').ownerId='t-qiu-zhen';m.state.packages.find(p=>p.id==='p3').storeId='a';
 m.state.franchiseOwners.push({id:localOwner.id,name:'本店经营老板测试',active:true,storeIds:['a']});
 m.saveAssessmentSchedule({assessorId:selected,storeId:'a',date:m.today,startTime:'09:00',endTime:'19:00',reason:'本人实际确认评估出诊',requestId:'queue-assessor-shift'},hq);
 const appointment=m.saveAppointment({clientId:'c3',storeId:'a',date:m.today,time:'12:00',assessorId:selected,assessmentTime:'12:00',principalId:'t-qiu-zhen',project:'本次康复',requestId:'queue-appointment'},actualFront);
 m.recordArrival(appointment.id,{requestId:'queue-arrival'},actualFront);
 const paper=savePaperIntake(m,{clientId:'c3',storeId:'a',appointmentId:appointment.id,assessorId:selected,formVersion:'initial_case_v2',initialCase:{},requestId:'queue-paper'},actualFront);
 const review=()=>reviewPaperIntake(m,paper.id,{decision:'assessment',nextStep:'本人核对后安排本次评估',assigneeId:'t-qiu-zhen',dueDate:'2026-10-09',requestId:'queue-review'},selected==='tao'?hq:selectedManager);
 const record=()=>recordAssessment(m,{clientId:'c3',storeId:'a',appointmentId:appointment.id,paperIntakeId:paper.id,assessorId:selected,date:m.today,time:'12:00',type:'initial',project:'实际评估',metricName1:'动作次数',metricValue1:'5',summary:'本次实际指标记录',requestId:'queue-assessment'},actualFront);
 return {m,appointment,paper,review,record};
}
const clinicalCards=(html,label)=>[...html.matchAll(/<article class="record-item">([\s\S]*?)<\/article>/g)].map(match=>match[1]).filter(html=>html.includes('步骤 '+label));
const hasAction=(html,type,id)=>html.includes('data-action="'+type+'" data-id="'+id+'"');
for(const [name,role] of [['总部经营老板',hq],['当前本店加盟老板',localOwner]]){
 test(`${name}对另一位实际评估师的待复核表只给原记录查看`,()=>{
  const {m,paper}=actualClinicalVisit(),before=JSON.stringify(m.state),html=api.renderOperationsPanel(ctx(m,role)),cards=clinicalCards(html,'接待复核');
  assert.equal(cards.length,1);assert.ok(hasAction(cards[0],'paper-intake-detail',paper.id));
  assert.doesNotMatch(cards[0],/data-action="paper-intake-review"|data-action="paper-intake-create"/);
  assert.throws(()=>paperIntakeDialog('paper-intake-review',paper.id,ctx(m,role)),/指定.*评估|本人|复核/);
  assert.ok(paperIntakeDialog('paper-intake-detail',paper.id,ctx(m,role)).html);assert.equal(JSON.stringify(m.state),before);
 });
 test(`${name}对另一位本人尚未登记的评估只给本次接待查看`,()=>{
  const {m,paper,review}=actualClinicalVisit();review();const html=api.renderOperationsPanel(ctx(m,role)),cards=clinicalCards(html,'本人评估确认');
  assert.equal(cards.length,1);assert.ok(hasAction(cards[0],'paper-intake-detail',paper.id));
  assert.doesNotMatch(cards[0],/data-action="staff-assessment-create"|data-action="assessment-confirm"/);
  assert.ok(m.workflowBlockersView(role).some(row=>row.step==='assessment'),'真实未完成评估仍提示老板');
 });
 test(`${name}对另一位本人待确认评估只给实际评估详情`,()=>{
  const {m,review,record}=actualClinicalVisit();review();const assessment=record(),before=JSON.stringify(m.state),html=api.renderOperationsPanel(ctx(m,role)),cards=clinicalCards(html,'本人评估确认');
  assert.equal(cards.length,1);assert.ok(hasAction(cards[0],'assessment-detail',assessment.id));
  assert.doesNotMatch(cards[0],/data-action="staff-assessment-create"|data-action="assessment-confirm"/);
  assert.throws(()=>evaluationDialog('assessment-confirm',assessment.id,ctx(m,role)),/权限|确认/);
  assert.ok(evaluationDialog('assessment-detail',assessment.id,ctx(m,role)).html);assert.equal(JSON.stringify(m.state),before);
  const decisions=bossDecisionDialog('flow',ctx(m,hq)).html;assert.ok(hasAction(decisions,'assessment-detail',assessment.id));assert.doesNotMatch(decisions,/data-action="assessment-confirm"|data-action="paper-intake-review"/);
 });
}
for(const [name,selected,role] of [['陈康本人','m-chen-kang',selectedManager],['王勤涛总部本人','tao',hq]])test(`${name}可从卡点完成复核、本人登记入口及确认前台代录评估`,()=>{
 const {m,paper,review,record}=actualClinicalVisit(selected);
 let cards=clinicalCards(api.renderOperationsPanel(ctx(m,role)),'接待复核');assert.ok(hasAction(cards[0],'paper-intake-review',paper.id));assert.match(paperIntakeDialog('paper-intake-review',paper.id,ctx(m,role)).html,/data-form="paper-intake-review"/);
 review();cards=clinicalCards(api.renderOperationsPanel(ctx(m,role)),'本人评估确认');assert.ok(hasAction(cards[0],'staff-assessment-create','c3:a'));assert.match(evaluationDialog('assessment-create','c3',ctx(m,role)).html,/data-form="assessment-create"/);
 const assessment=record();assert.equal(assessment.recordedRole,'frontdesk');assert.equal(assessment.recordedBy,actualFront.id);
 cards=clinicalCards(api.renderOperationsPanel(ctx(m,role)),'本人评估确认');assert.ok(hasAction(cards[0],'assessment-confirm',assessment.id));assert.match(evaluationDialog('assessment-confirm',assessment.id,ctx(m,role)).html,/data-form="assessment-confirm"/);
 assert.equal(confirmAssessment(m,assessment.id,role).status,'confirmed');assert.equal(clinicalCards(api.renderOperationsPanel(ctx(m,role)),'本人评估确认').length,0);
});
test('评估师停用后卡点回到原记录查看，不能显示本人确认入口',()=>{
 const {m,review,record}=actualClinicalVisit('tao');review();const assessment=record();m.state.assessors.find(p=>p.id==='tao').active=false;
 const cards=clinicalCards(api.renderOperationsPanel(ctx(m,hq)),'本人评估确认');assert.equal(cards.length,1);assert.ok(hasAction(cards[0],'assessment-detail',assessment.id));assert.doesNotMatch(cards[0],/data-action="assessment-confirm"/);
 assert.throws(()=>confirmAssessment(m,assessment.id,hq),/权限|确认/);
});
