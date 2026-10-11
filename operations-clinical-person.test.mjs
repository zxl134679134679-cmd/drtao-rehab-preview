import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './core.js';
import {ensureSchedules} from './schedules.js';
import {savePaperIntake,reviewPaperIntake,amendPaperIntake,paperIntakeDialog} from './paper-intake.js';
import {recordAssessment,confirmAssessment,assessmentRows} from './evaluations.js';
import {runtime} from './operations-test-runtime.mjs';

const boss={type:'boss',id:'boss'},manager={type:'manager',id:'m-chen-kang'},front={type:'frontdesk',id:'f1'},therapist={type:'therapist',id:'t-qiu-zhen'},owner={type:'franchise_owner',id:'current-owner-a'};
const review={decision:'assessment',nextStep:'所选评估师实际核对并安排评估',assigneeId:'t-qiu-zhen',dueDate:'2026-10-09',requestId:'actual-review'};
function visit(assessorId='m-chen-kang'){
 const m=new DemoModel({now:()=> '2026-10-08T09:00:00Z'}).initializeOperationsWorkflow();ensureSchedules(m);m.state.assessments=[];m.state.frontDeskEvaluations=[];m.state.paperIntakes=[];m._client('c3').ownerId=therapist.id;m.state.packages.find(p=>p.id==='p3').storeId='a';m.state.franchiseOwners.push({id:owner.id,name:'本店经营老板测试',active:true,storeIds:['a']});
 m.saveAssessmentSchedule({assessorId,storeId:'a',date:m.today,startTime:'09:00',endTime:'19:00',reason:'本人实际确认评估出诊',requestId:'actual-assessor-shift'},boss);
 const a=m.saveAppointment({clientId:'c3',storeId:'a',date:m.today,time:'12:00',assessorId,assessmentTime:'12:00',principalId:therapist.id,project:'本次康复',requestId:'actual-appointment'},front);m.recordArrival(a.id,{requestId:'actual-arrival'},front);
 const paper=savePaperIntake(m,{clientId:'c3',storeId:'a',appointmentId:a.id,assessorId,formVersion:'initial_case_v2',initialCase:{},requestId:'actual-paper'},front);
 const assessment={clientId:'c3',storeId:'a',appointmentId:a.id,paperIntakeId:paper.id,assessorId,date:m.today,time:'12:00',type:'initial',project:'实际评估',metricName1:'动作次数',metricValue1:'5',summary:'本次实际指标记录',requestId:'actual-assessment'};
 return {m,a,paper,assessment};
}
function deniedUnchanged(m,run,pattern=/指定.*评估|本人|复核|确认/){const before=JSON.stringify(m.state);assert.throws(run,pattern);assert.equal(JSON.stringify(m.state),before);}

test('only the actual selected assessor reviews the paper; headquarters and local owner cannot substitute',()=>{
 const {m,paper}=visit();for(const actor of [boss,owner,therapist])deniedUnchanged(m,()=>reviewPaperIntake(m,paper.id,review,actor));
 const actual=reviewPaperIntake(m,paper.id,review,manager);assert.equal(actual.reviewedRole,manager.type);assert.equal(actual.reviewedBy,manager.id);assert.equal(actual.status,'reviewed');
});
test('headquarters legitimately reviews and confirms only when Wang Qintao is the selected assessor',()=>{
 const {m,paper,assessment}=visit('tao');deniedUnchanged(m,()=>reviewPaperIntake(m,paper.id,review,owner));
 assert.equal(reviewPaperIntake(m,paper.id,review,boss).reviewedBy,'boss');const actual=recordAssessment(m,assessment,front);assert.equal(confirmAssessment(m,actual.id,boss).status,'confirmed');assert.equal(m.serviceReadiness(assessment).ready,true);
});
test('imported delegated review evidence cannot unlock initial assessment or service and stays visible as a blocker',()=>{
 const {m,a,paper,assessment}=visit(),stored=m.state.paperIntakes.find(p=>p.id===paper.id);Object.assign(stored,{status:'reviewed',reviewedRole:'boss',reviewedBy:'boss',reviewedAt:m.now()});
 m.state.assessments.push({...assessment,id:'old-delegated-paper-assessment',status:'confirmed',confirmedRole:manager.type,confirmedBy:manager.id});
 assert.equal(m.serviceReadiness(assessment).ready,false);assert.ok(m.workflowBlockersView(boss).some(r=>r.step==='intake'&&r.sourceId===a.id));
 deniedUnchanged(m,()=>recordAssessment(m,assessment,front));
 deniedUnchanged(m,()=>m.registerService({...assessment,packageId:'p3',principalId:therapist.id,notes:'不能借旧代复核放行',requestId:'invalid-service'},therapist));
 assert.equal(stored.reviewedBy,'boss','the original imported signer is not rewritten');
});
test('owner amendment retains prior review evidence and returns the same paper to its selected person for review',()=>{
 const {m,paper,assessment}=visit();const reviewed=reviewPaperIntake(m,paper.id,review,manager),oldTask=reviewed.review.taskId;
 const corrected=amendPaperIntake(m,{id:paper.id,expectedVersion:0,initialCase:{...paper.initialCase,occupation:'核对后的职业'},reason:'更正已存客户自述',requestId:'actual-amendment'},owner);
 assert.equal(corrected.status,'pending');assert.equal(corrected.assessorId,manager.id);assert.equal(corrected.createdBy,front.id);assert.equal(corrected.reviewedBy,undefined);assert.equal(corrected.history[0].before.reviewedBy,manager.id);assert.equal(corrected.history[0].before.status,'reviewed');assert.notEqual(m.state.tasks.find(t=>t.id===oldTask).status,'pending');
 deniedUnchanged(m,()=>recordAssessment(m,assessment,front));deniedUnchanged(m,()=>reviewPaperIntake(m,paper.id,{...review,requestId:'owner-after-amend'},owner));
 assert.equal(reviewPaperIntake(m,paper.id,{...review,requestId:'person-after-amend'},manager).status,'reviewed');const actual=recordAssessment(m,assessment,front);assert.equal(confirmAssessment(m,actual.id,manager).status,'confirmed');assert.equal(m.serviceReadiness(assessment).ready,true);
});
test('current initialized imports without a selected assessor cannot acquire new owner confirmation',()=>{
 const {m}=visit();m.state.assessments.push({id:'missing-person',clientId:'c3',storeId:'a',date:m.today,time:'12:00',type:'initial',project:'原始旧记录',metrics:[{name:'指标',value:'5'}],summary:'缺本人证据',status:'pending',recordedRole:'frontdesk',recordedBy:'f1'});
 for(const actor of [boss,owner])deniedUnchanged(m,()=>confirmAssessment(m,'missing-person',actor));assert.ok(assessmentRows(m,boss).some(a=>a.id==='missing-person'&&a.status==='pending'));
});
test('the existing paper review dialog exposes the review action only to the selected assessor',()=>{
 const {m,paper}=visit(),ctx=role=>({model:m,role,esc:v=>String(v??'')});for(const actor of [boss,owner])assert.throws(()=>paperIntakeDialog('paper-intake-review',paper.id,ctx(actor)),/指定.*评估|本人|复核/);
 assert.match(paperIntakeDialog('paper-intake-review',paper.id,ctx(manager)).html,/data-form="paper-intake-review"/);
});
test('the actual app form dispatcher denies delegated review and succeeds with the selected assessor',async()=>{
 const {m,paper}=visit(),before=JSON.stringify(m.state),forged=runtime(boss,'paper-intake-review',{id:paper.id,...review},m);await forged.run();assert.match(forged.scope.error||'',/指定.*评估|本人|复核/);assert.equal(JSON.stringify(m.state),before);
 const actual=runtime(manager,'paper-intake-review',{id:paper.id,...review},m);await actual.run();assert.equal(actual.scope.error,undefined);assert.ok(actual.scope.success);assert.equal(m.state.paperIntakes.find(p=>p.id===paper.id).reviewedBy,manager.id);
});
