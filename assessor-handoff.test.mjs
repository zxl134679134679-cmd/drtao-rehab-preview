import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import { confirmedTestSchedules } from './scheduling-test-fixture.mjs';
import { saveMultiDayBooking } from './multi-day-booking.js';
import { requestCustomerBooking, confirmCustomerBooking, customerBookingConfirmation } from './customer-booking.js';
import { savePaperIntake, reviewPaperIntake, PAPER_SAFETY_QUESTIONS } from './paper-intake.js';
import { receptionIntakeDialog, receptionIntakeSuccess } from './reception.js';
import { customerBookingTherapists } from './booking-availability.js';
const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'},qiu={type:'therapist',id:'t-qiu-zhen'},zou={type:'therapist',id:'t-zou-zonglin'};
const fresh=()=>confirmedTestSchedules(new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T04:00:00.000Z'}));
const intake=(m,extra={})=>m.createReceptionClient({name:'新客户',phone:'13912345678',age:32,storeId:'a',requestId:'new-intake',...extra},front);
const ctx=m=>({model:m,role:front,filters:{storeId:'a'},esc:String,icon:()=>''});
const reject=(m,fn,re=/权限|只读|监管|评估|治疗|人员|选择|预约/)=>{const before=JSON.stringify([m.state,m.sequence]);assert.throws(fn,re);assert.equal(JSON.stringify([m.state,m.sequence]),before);};
test('current personnel are actual staff; legacy IDs and names remain inactive historical references',()=>{
 const m=fresh();assert.deepEqual(m.state.assessors,[{id:'tao',name:'涛博士',accountRole:'boss'}]);
 assert.deepEqual(m.state.therapists.filter(t=>t.active).map(t=>[t.name,t.storeId]),[['邱振','a'],['邹宗霖','a'],['武文沛','b']]);
 assert.deepEqual(m.state.storeManagers.filter(t=>t.active).map(t=>[t.name,t.storeId]),[['陈康','a'],['何赞峰','b']]);
 assert.equal(m.state.storeManagers.find(t=>t.id==='m1').name,'麦岛店店长');assert.equal(m.state.storeManagers.find(t=>t.id==='m1').active,false);assert.equal(m.state.therapists.find(t=>t.id==='t1').name,'林予安');assert.equal(m.state.therapists.find(t=>t.id==='t1').active,false);
 assert.equal(m.state.services[0].principalId,'t2');assert.equal(m.state.clients[0].ownerId,'t1');assert.equal(m.state.therapists.some(t=>t.name==='涛博士'),false);
});
test('new clients have independent fixed assessor, no owner or therapist, and intake selects no therapist',()=>{
 const m=fresh(),c=intake(m);assert.equal(c.assessorId,'tao');assert.equal(c.ownerId,'');assert.equal(c.therapistId,undefined);
 assert.equal(m.canSeeClient(qiu,c.id),false);assert.equal(m.canSeeClient(zou,c.id),false);
 const html=receptionIntakeDialog('reception-create-client','a',ctx(m)).html;assert.doesNotMatch(html,/name="ownerId"|name="therapistId"|name="principalId"/);assert.match(html,/涛博士/);assert.match(receptionIntakeSuccess(c,ctx(m)),/预约时选择/);
 reject(m,()=>intake(m,{phone:'13912345679',ownerId:'t-qiu-zhen',requestId:'forged-owner'}));
 reject(m,()=>intake(m,{phone:'13912345679',assessorId:'other',requestId:'forged-assessor'}));
});
test('each multi-day booking independently selects its therapist and keeps prior appointments and ownership intact',()=>{
 const m=fresh(),c=intake(m),before=structuredClone(c);
 const result=saveMultiDayBooking(m,{clientId:c.id,storeId:'a',project:'基础训练',items:[{date:'2026-10-12',time:'10:00',principalId:'t-qiu-zhen'},{date:'2026-10-13',time:'11:00',principalId:'t-zou-zonglin'}],requestId:'separate-days'},front);
 assert.deepEqual(result.items.map(r=>r.principalId),['t-qiu-zhen','t-zou-zonglin']);assert.deepEqual(m._client(c.id),before);
 assert.equal(m.canSeeClient(qiu,c.id),true);assert.equal(m.canSeeClient(zou,c.id),true);
 const older=structuredClone(m.state.appointments.find(a=>a.id===result.items[0].id));
 m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-14',time:'12:00',principalId:'t-zou-zonglin',project:'训练'},front);
 assert.deepEqual(m.state.appointments.find(a=>a.id===older.id),older);assert.equal(m.canSeeClient(qiu,c.id),true);assert.equal(m.clientStoreTherapist(c.id,'a'),'');
});
test('unassigned customers can request either local therapist; confirmation creates only booking permissions',()=>{
 const m=fresh(),c=intake(m),role={type:'customer',id:c.id};assert.deepEqual(customerBookingTherapists(m,c.id,'a','2026-10-12').map(t=>t.id),['t-qiu-zhen','t-zou-zonglin']);
 const r=requestCustomerBooking(m,{storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t-qiu-zhen',project:'训练',requestId:'customer-qiu'},role);
 assert.equal(m.canSeeClient(qiu,c.id),false,'pending request does not grant chart access');
 confirmCustomerBooking(m,r.id,front);assert.equal(m.canSeeClient(qiu,c.id),true);assert.equal(m._client(c.id).ownerId,'');
 reject(m,()=>m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-13',time:'10:00',principalId:'t1',project:'历史人员新预约'},front),/在职|康复师|停用/);
});
test('Tao reviews and publishes using boss authority, independent of owner; service therapists cannot professionally review',()=>{
 const m=fresh(),c=intake(m);m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t-qiu-zhen',project:'训练'},front);
 const row=savePaperIntake(m,{clientId:c.id,storeId:'a',age:32,problem:'客户自述膝部不适',goal:'恢复运动',answers:Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(q=>[q.key,'no'])),requestId:'paper'},front);
 reject(m,()=>reviewPaperIntake(m,row.id,{decision:'assessment',nextStep:'涛博士评估',requestId:'review'},qiu));
 const reviewed=reviewPaperIntake(m,row.id,{decision:'assessment',nextStep:'涛博士评估',assigneeId:'boss',dueDate:'2026-10-12',requestId:'review'},boss);assert.equal(reviewed.review.assigneeId,'boss');
 const plan={goal:'恢复运动',phase:'训练',nextStep:'基础训练',planNotes:'经评估制定',homeAdvice:'按指导练习'};
 m.publishPlan(c.id,plan,boss);reject(m,()=>m.publishPlan(c.id,plan,qiu));
});
test('manager supervision is read-only for new appointments and booking confirmations',()=>{
 const m=fresh(),c=intake(m),manager={type:'manager',id:'m-chen-kang'};
 reject(m,()=>m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t-qiu-zhen',project:'训练'},manager));
 const r=requestCustomerBooking(m,{storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t-qiu-zhen',project:'训练',requestId:'manager-view'},{type:'customer',id:c.id});
 assert.equal(customerBookingConfirmation(m,r.id,manager).canConfirm,false);reject(m,()=>confirmCustomerBooking(m,r.id,manager));
});

test('professional assessment uses the independent assessor roster and therapist cannot confirm it even after becoming owner',async()=>{
 const {recordAssessment,confirmAssessment,evaluationDialog}=await import('./evaluations.js');
 const m=fresh(),c=intake(m),payload={clientId:c.id,storeId:'a',assessorId:'tao',date:'2026-10-09',time:'10:00',type:'initial',project:'首次评估',metricName1:'活动度',metricValue1:'90',metricUnit1:'度',summary:'涛博士实际评估',requestId:'tao-assessment'};
 const row=recordAssessment(m,payload,front);assert.equal(row.assessorId,'tao');assert.equal(row.therapistId,undefined);
 m.transferClient(c.id,'t-qiu-zhen','独立客户交接',boss);assert.equal(m._client(c.id).assessorId,'tao');
 reject(m,()=>confirmAssessment(m,row.id,qiu));assert.equal(confirmAssessment(m,row.id,boss).confirmedBy,'boss');
 reject(m,()=>recordAssessment(m,{...payload,therapistId:'t-qiu-zhen',requestId:'forged-assessor'},front));
 const html=evaluationDialog('assessment-create',c.id,ctx(m)).html;assert.match(html,/name="assessorId"/);assert.match(html,/涛博士/);assert.doesNotMatch(html,/name="therapistId"/);
 reject(m,()=>m.publishPlan(c.id,{goal:'目标',phase:'阶段',nextStep:'下一步',planNotes:'计划',homeAdvice:'指导'},qiu));
});

test('actual therapist cannot write or view another therapist booking and service even for a shared client',async()=>{
 const {staffDialog,renderStaff}=await import('./staff.js');
 const m=fresh(),c=intake(m),first=m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t-qiu-zhen',project:'邱振服务'},front);
 const second=m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-13',time:'10:00',principalId:'t-zou-zonglin',project:'邹宗霖服务'},front);
 const roleCtx={...ctx(m),role:qiu,view:'therapist-appointments'};
 const html=renderStaff(roleCtx);assert.ok(html.includes(`data-id="${first.id}"`));assert.ok(!html.includes(`data-id="${second.id}"`));
 reject(m,()=>staffDialog('appointment-edit',second.id,roleCtx));
 reject(m,()=>m.saveAppointment({...second,time:'11:00'},qiu));reject(m,()=>m.cancelAppointment(second.id,'客户变更',qiu));
 reject(m,()=>m.markNoShow(second.id,'未到店',qiu));
});

test('intake with no owner supports companion booking using current local personnel without prior client permissions',async()=>{
 const {appointmentBatchDialog}=await import('./companion-booking.js');const m=fresh(),first=intake(m),second=intake(m,{name:'同行客户',phone:'13912345679',requestId:'second-intake'});
 const html=appointmentBatchDialog(first.id,ctx(m)).html;assert.match(html,/value="t-qiu-zhen"/);assert.match(html,/value="t-zou-zonglin"/);assert.doesNotMatch(html,/value="t1"/);
 const rows=m.saveAppointmentBatch({storeId:'a',date:'2026-10-12',time:'10:00',project:'同行训练',items:[{clientId:first.id,principalId:'t-qiu-zhen'},{clientId:second.id,principalId:'t-zou-zonglin'}],requestId:'group'},front);
 assert.equal(rows.length,2);assert.equal(m._client(first.id).ownerId,'');assert.equal(m._client(second.id).ownerId,'');
});

test('assigning a current therapist as customer owner never grants assessment, professional review or plan publishing',async()=>{
 const {staffDialog}=await import('./staff.js'),{evaluationDialog}=await import('./evaluations.js');const m=fresh();m.transferClient('c3','t-qiu-zhen','明确客户跟进负责人',boss);
 const plan={goal:'恢复运动',phase:'训练',nextStep:'继续',planNotes:'计划',homeAdvice:'指导'};reject(m,()=>m.publishPlan('c3',plan,qiu));
 reject(m,()=>staffDialog('edit-plan','c3',{...ctx(m),role:qiu}));reject(m,()=>evaluationDialog('assessment-create','c3',{...ctx(m),role:qiu}));
 const row=savePaperIntake(m,{clientId:'c3',storeId:'a',age:32,problem:'自述问题',goal:'目标',answers:Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(q=>[q.key,'no'])),requestId:'legacy-client-new-paper'},front);
 reject(m,()=>reviewPaperIntake(m,row.id,{decision:'assessment',nextStep:'评估',assigneeId:'boss',dueDate:m.today,requestId:'invalid-review'},qiu));
});


test('cancelled or no-show appointments without services revoke appointment chart permission and live appointments are store scoped',()=>{
 const m=fresh(),c=intake(m),first=m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-12',time:'10:00',principalId:qiu.id,project:'训练'},front);
 assert.equal(m.canSeeClient(qiu,c.id),true);assert.equal(m._therapistClientWorkAllowed(qiu.id,c.id,'a'),true);assert.equal(m._therapistClientWorkAllowed(qiu.id,c.id,'b'),false);
 m.cancelAppointment(first.id,'客户取消',front);assert.equal(m.canSeeClient(qiu,c.id),false);
 const second=m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-13',time:'10:00',principalId:qiu.id,project:'训练'},front);
 m.state.appointments.find(a=>a.id===second.id).status='no_show';assert.equal(m.canSeeClient(qiu,c.id),false);
 const third=m.saveAppointment({clientId:c.id,storeId:'a',date:'2026-10-14',time:'10:00',principalId:qiu.id,project:'训练'},front);assert.equal(m.canSeeClient(qiu,c.id),true);
 m.cancelAppointment(third.id,'取消剩余预约',front);assert.equal(m.canSeeClient(qiu,c.id),false);
});
test('own completed service retains chart access only in its store; another therapist or store photos remain private',()=>{
 const m=fresh(),c=intake(m);
 m.state.services.push({id:'actual-qiu-service',clientId:c.id,storeId:'a',principalId:qiu.id,participantIds:[],status:'valid'},
 {id:'actual-zou-service',clientId:c.id,storeId:'a',principalId:zou.id,participantIds:[],status:'valid'},
 {id:'actual-wu-service',clientId:c.id,storeId:'b',principalId:'t-wu-wenpei',participantIds:[],status:'valid'});
 assert.equal(m.canSeeClient(qiu,c.id),true);assert.equal(m._therapistClientWorkAllowed(qiu.id,c.id,'a'),true);assert.equal(m._therapistClientWorkAllowed(qiu.id,c.id,'b'),false);
 assert.equal(m.canSeeEvidence(qiu,'actual-qiu-service'),true);assert.equal(m.canSeeEvidence(qiu,'actual-zou-service'),false);assert.equal(m.canSeeEvidence(qiu,'actual-wu-service'),false);
 assert.equal(m.canSeeEvidence(zou,'actual-qiu-service'),false);assert.equal(m.canSeeEvidence({type:'manager',id:'m-chen-kang'},'actual-wu-service'),false);
});


test('new treatment booking defaults to training and manager assessment screens keep the independent Tao assessor',async()=>{
 const {staffDialog}=await import('./staff.js'),{recordAssessment}=await import('./evaluations.js'),{managerDialog,renderManager}=await import('./manager.js');
 const m=fresh(),c=intake(m);assert.match(staffDialog('appointment-create',c.id,ctx(m)).html,/name="project"[^>]*value="康复训练"/);
 const row=recordAssessment(m,{clientId:c.id,storeId:'a',assessorId:'tao',date:'2026-10-09',time:'10:00',type:'initial',project:'专业评估',metricName1:'活动度',metricValue1:'90',summary:'涛博士评估',requestId:'manager-assessor'},front);
 const managerCtx={...ctx(m),role:{type:'manager',id:'m-chen-kang'},view:'manager-overview'};
 assert.equal(m.managerSnapshot(managerCtx.role).clients.find(x=>x.id===c.id).assessorId,'tao');
 assert.equal(m.managerSnapshot(managerCtx.role).assessments.find(x=>x.id===row.id).assessorId,'tao');
 assert.match(managerDialog('manager-assessment',row.id,managerCtx).html,/评估师[\s\S]*涛博士/);const managerHtml=renderManager(managerCtx);assert.match(managerHtml,/待 涛博士 确认/);assert.doesNotMatch(managerHtml,/可代客户新建|店长可核对并确认/);assert.match(managerHtml,/监管只读/);
});
