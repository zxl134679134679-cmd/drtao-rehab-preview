import test from 'node:test';import assert from 'node:assert/strict';
import {DemoModel as ActualModel} from './core.js';import {DemoModel} from './legacy-test-fixture.mjs';
import {confirmedTestSchedules} from './scheduling-test-fixture.mjs';import {bookingAvailability,customerBookingTherapists} from './booking-availability.js';
import {personnelDialog,renderStaff} from './staff.js';import {recordAssessment} from './evaluations.js';import {savePaperIntake} from './paper-intake.js';
const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'},therapist={type:'therapist',id:'t1'},manager={type:'manager',id:'m1'};
const fresh=()=>confirmedTestSchedules(new DemoModel({today:'2026-10-08',now:()=> '2026-10-08T12:00:00Z'}));
const snap=m=>JSON.stringify([m.state,m.sequence]);const denied=(m,fn,re=/老板|权限|修改/)=>{const before=snap(m);assert.throws(fn,re);assert.equal(snap(m),before);};
const ctx=(model,role=boss)=>({model,role,view:'team',filters:{},esc:String,icon:()=>'',fmt:{money:String,date:String}});
test('Suzhou is selectable with Wang as default assessor, but no staff or schedules are invented',()=>{
 const m=new ActualModel(),store=m.state.stores.find(s=>s.id==='store-suzhou');assert.equal(store?.name,'苏州店');assert.equal(store.address,'');
 assert.deepEqual(m.assessorRows(store.id).map(p=>p.name),['王勤涛']);assert.deepEqual(m.assessorRows('a').map(p=>p.name),['王勤涛','陈康','邱振','邹宗霖']);
 assert.equal(m.state.therapists.filter(t=>t.storeId===store.id).length,0);assert.equal(m.state.storeManagers.filter(t=>t.storeId===store.id).length,0);assert.equal(m.state.clients.filter(c=>c.storeId===store.id).length,0);
 const c=m.createReceptionClient({name:'苏州虚构验收',phone:'13899094411',age:30,storeId:store.id,requestId:'sz'},boss);assert.equal(c.assessorId,'tao');assert.equal(c.ownerId,'');
 assert.deepEqual(customerBookingTherapists(m,c.id,store.id,'2026-10-12'),[]);assert.equal(bookingAvailability(m,{clientId:c.id,storeId:store.id,principalId:'t-qiu-zhen',date:'2026-10-12',time:'10:00'}).available,false);
 assert.match(renderStaff(ctx(m)),/苏州店/);assert.match(renderStaff(ctx(m)),/待配置/);
});
test('boss edits store name and address with stable id, version, original values, reason and replay safety',()=>{
 const m=fresh(),before=structuredClone([m.state.appointments,m.state.services,m.state.clients]),data={id:'a',name:'麦岛店 · 核对',address:'已核对门店地址',expectedVersion:0,reason:'老板核对',requestId:'store-edit'};
 const row=m.updateStore(data,boss);assert.equal(row.id,'a');assert.equal(row.profileVersion,1);assert.equal(row.history[0].before.name,'麦岛店');assert.equal(row.history[0].reason,'老板核对');assert.equal(row.history[0].changedBy,'boss');
 assert.deepEqual([m.state.appointments,m.state.services,m.state.clients],before);const saved=snap(m);m.updateStore(data,boss);assert.equal(snap(m),saved);
 denied(m,()=>m.updateStore({...data,address:'另一个地址'},boss),/提交|变化/);denied(m,()=>m.updateStore({...data,requestId:'stale'},boss),/版本/);
 for(const role of [front,therapist,manager,{type:'boss',id:'wrong'}])denied(m,()=>m.updateStore({...data,expectedVersion:1,requestId:'other'},role));
 denied(m,()=>m.updateStore({...data,name:'崂山店',expectedVersion:1,requestId:'duplicate'},boss),/重复/);
 const html=personnelDialog('edit-store','a',ctx(m)).html;assert.match(html,/name="expectedVersion" value="1"/);assert.match(html,/name="reason"/);assert.match(html,/原资料|历史/);
});
test('existing appointment edits belong to boss while employee new booking and cancellation remain authorized',()=>{
 const m=fresh(),a=m.state.appointments.find(a=>a.id==='a3');for(const role of [front,therapist,manager])denied(m,()=>m.saveAppointment({...a,time:'15:00'},role));
 assert.equal(m.saveAppointment({...a,time:'15:00'},boss).time,'15:00');const input={clientId:'c3',storeId:'a',principalId:'t1',date:'2026-10-12',time:'11:00',project:'训练',requestId:'single'};
 const row=m.saveAppointment(input,front),saved=snap(m);assert.equal(m.saveAppointment(input,front).id,row.id);assert.equal(snap(m),saved);denied(m,()=>m.saveAppointment({...input,time:'12:00'},front),/提交|变化/);
 assert.equal(m.cancelAppointment(row.id,'前台申请',front).cancellationRequest.status,'pending');assert.equal(m.handleAppointmentCancellation(row.id,{decision:'approve',reason:'本店批准'},manager).status,'cancelled');
});
test('legacy owner cannot edit an existing plan or pass record identifiers as new clinical input',()=>{
 const m=fresh(),data={goal:'新目标',phase:'新阶段',nextStep:'下一步',planNotes:'计划',homeAdvice:'指导'};denied(m,()=>m.publishPlan('c3',data,therapist));
 assert.equal(m.publishPlan('c3',data,boss).goal,'新目标');
 denied(m,()=>recordAssessment(m,{id:'existing',clientId:'c3',storeId:'a',date:m.today,time:'11:00',type:'initial',therapistId:'t1',project:'评估',metricName1:'活动',metricValue1:'1',summary:'本次',requestId:'amend'},therapist),/已有|新建|修改/);
 denied(m,()=>savePaperIntake(m,{id:'existing',clientId:'c3',storeId:'a',requestId:'amend'},front),/已有|新建|修改/);
});

test('assessor roster does not retain a moved employee in the old store or turn arbitrary identity into Wang',()=>{const m=new ActualModel();m.state.therapists.find(p=>p.id==='t-qiu-zhen').storeId='b';assert.deepEqual(m.assessorRows('a').map(p=>p.name),['王勤涛','陈康','邹宗霖']);m.state.assessors.push({id:'fake-tao',name:'冒名',accountRole:'boss',accountId:'boss',storeIds:['a']});assert.equal(m.assessorRows('a').some(p=>p.id==='fake-tao'),false);});

test('disabled assessor row and reassigned canonical staff do not acquire a new-store assessment identity',()=>{const m=new ActualModel();m.state.assessors.find(a=>a.id==='tao').active=false;assert.equal(m.assessorRows('store-suzhou').length,0);const q=m.state.therapists.find(t=>t.id==='t-qiu-zhen');q.storeId='store-suzhou';m.state.assessors.find(a=>a.id===q.id).storeIds=['store-suzhou'];assert.equal(m.assessorRows('store-suzhou').length,0);});
