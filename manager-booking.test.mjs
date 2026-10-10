import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import { confirmedTestSchedules, confirmTestShift } from './scheduling-test-fixture.mjs';
import { requestCustomerBooking, confirmCustomerBooking, customerBookingConfirmation, resolveCustomerBooking, customerBookingHandling } from './customer-booking.js';
import { renderStaff, staffDialog } from './staff.js';
import { renderManager } from './manager.js';
const manager = {type:'manager',id:'m1'}, boss={type:'boss',id:'boss'};
const fixture=()=>confirmedTestSchedules(new DemoModel({now:()=> '2026-10-09T04:00:00.000Z'}));
const input=extra=>({clientId:'c1',storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t1',project:'阶段复评',...extra});
const denied=(model,run)=>{const before=JSON.stringify([model.state,model.sequence]);assert.throws(run,/权限|本店|店长|仅|只读|停用|在职/);assert.equal(JSON.stringify([model.state,model.sequence]),before);};
const context=(model,role)=>({model,role,filters:{}});

test('manager can create a single local booking without changing packages, cash or existing appointments',()=>{
 const m=fixture(),before=structuredClone(m.state);
 const row=m.saveAppointment(input(),{...manager,storeId:'b',storeIds:['a','b']});
 assert.equal(row.storeId,'a');assert.equal(row.status,'confirmed');
 assert.deepEqual(m.state.packages,before.packages);assert.deepEqual(m.state.receipts,before.receipts);assert.deepEqual(m.state.services,before.services);
 assert.deepEqual(m.state.appointments.filter(a=>a.id!==row.id),before.appointments);
 assert.equal(m.state.audit[0].actorType,'manager');assert.equal(m.state.audit[0].actorId,'m1');
});

test('manager creation stays tied to the active account store, client and confirmed shift',()=>{
 const m=fixture();
 denied(m,()=>m.saveAppointment(input({storeId:'b',principalId:'t2'}),manager));
 denied(m,()=>m.saveAppointment(input({clientId:'c2',principalId:'t2'}),manager));
 for(const role of [{type:'manager',id:'unknown'},{type:'boss',id:'m1'}])denied(m,()=>m.saveAppointment(input(),role));
 m.state.storeManagers.find(r=>r.id==='m1').active=false;denied(m,()=>m.saveAppointment(input(),manager));
 m.state.storeManagers.find(r=>r.id==='m1').active=true;
 confirmTestShift(m,{therapistId:'t1',storeId:'a',date:'2026-10-12',startTime:'09:00',endTime:'10:30'});
 assert.throws(()=>m.saveAppointment(input(),manager),/排班|上班|下班|时段|60/);
 assert.throws(()=>m.saveAppointment(input({principalId:'t4'}),manager),/授权|康复师|负责/);
});

test('manager cannot edit, cancel, mark no-show, create a group or process a cancellation through the booking exception',()=>{
 const m=fixture(),row=m.saveAppointment(input(),boss);
 const actions=[()=>m.saveAppointment(input({id:row.id,time:'11:00'}),manager),()=>m.cancelAppointment(row.id,'行程改变',manager),()=>m.markNoShow('a3','未到店',manager),()=>m.recordArrival('a3',{requestId:'manager-arrival'},manager),()=>m.handleAppointmentCancellation(row.id,{decision:'approve',reason:'取消'},manager),()=>m.saveAppointmentBatch({storeId:'a',date:'2026-10-12',time:'12:00',project:'复评',items:[{clientId:'c1',principalId:'t1'},{clientId:'c5',principalId:'t5'}],requestId:'manager-group'},manager)];
 actions.forEach(run=>denied(m,run));
});

test('manager can confirm a pending local client request once and confirmation preserves role provenance',()=>{
 const m=fixture(),req=requestCustomerBooking(m,{...input(),requestId:'manager-confirm'},{type:'customer',id:'c1'});
 assert.equal(customerBookingConfirmation(m,req.id,manager).canConfirm,true);
 const done=confirmCustomerBooking(m,req.id,manager),before=JSON.stringify([m.state,m.sequence]);
 assert.equal(done.status,'confirmed');assert.equal(done.confirmedRole,'manager');assert.equal(done.confirmedBy,'m1');
 assert.equal(m.state.appointments.find(a=>a.id===done.appointmentId).storeId,'a');
 assert.equal(confirmCustomerBooking(m,req.id,manager).appointmentId,done.appointmentId);assert.equal(JSON.stringify([m.state,m.sequence]),before);
 denied(m,()=>resolveCustomerBooking(m,{id:req.id,outcome:'rejected',reason:'无法安排'},manager));
});

test('manager confirmation rejects foreign requests and conflicts atomically, and has no resolution permission',()=>{
 const m=fixture(),local=requestCustomerBooking(m,{...input(),requestId:'local-request'},{type:'customer',id:'c1'});
 const foreign=requestCustomerBooking(m,{...input({clientId:'c2',storeId:'b',principalId:'t2'}),requestId:'foreign-request'},{type:'customer',id:'c2'});
 denied(m,()=>confirmCustomerBooking(m,foreign.id,manager));
 assert.equal(customerBookingHandling(m,local.id,manager).canHandle,false);
 denied(m,()=>resolveCustomerBooking(m,{id:local.id,outcome:'reschedule_suggested',date:'2026-10-13',time:'11:00',reason:'建议改期'},manager));
 m.saveAppointment(input(),boss);const before=JSON.stringify([m.state,m.sequence]);
 assert.throws(()=>confirmCustomerBooking(m,local.id,manager),/冲突/);assert.equal(JSON.stringify([m.state,m.sequence]),before);
});

test('manager booking dialog exposes only its local clients and store and denies all other staff dialogs',()=>{
 const m=fixture(),html=staffDialog('appointment-create','c1',context(m,manager)).html;
 assert.match(html,/data-form="appointment-create"/);assert.match(html,/value="a"/);assert.doesNotMatch(html,/<option value="b"/);assert.doesNotMatch(html,/<option value="c2"/);
 for(const type of ['appointment-edit','register','register-appointment','edit-plan'])denied(m,()=>staffDialog(type,'a3',context(m,manager)));
 denied(m,()=>staffDialog('appointment-create','c2',context(m,manager)));
});


test('therapist work home exposes the own current shift beside the actual appointment and service-photo entry',()=>{
 const m=fixture(),ctx={model:m,role:{type:'therapist',id:'t1'},view:'work',filters:{},esc:String,icon:()=>''};
 const html=renderStaff(ctx);assert.match(html,/本人今日排班/);assert.match(html,/00:00–23:30/);assert.match(html,/data-action="register"/);assert.match(html,/data-action="client-detail"/);
 const shift=m.state.staffSchedules.find(r=>r.therapistId==='t1'&&r.date===m.today);Object.assign(shift,{status:'rest',startTime:'',endTime:''});
 assert.match(renderStaff(ctx),/本人今日排班[\s\S]*休息/);
});


test('manager overview exposes a local booking entry, current appointments and pending request confirmation',()=>{
 const m=fixture();requestCustomerBooking(m,{...input(),requestId:'home-request'},{type:'customer',id:'c1'});
 const html=renderManager({model:m,role:manager,view:'manager-overview',filters:{},esc:String,icon:()=>'',fmt:{money:String,date:String}});
 assert.match(html,/data-action="appointment-create"/);assert.match(html,/今天的安排/);assert.match(html,/data-action="customer-booking-confirm"/);
 assert.doesNotMatch(html,/data-action="appointment-edit"|data-action="register"|data-action="reception-create-client"/);
});

test('manager cannot submit any existing-appointment identifier field, including falsy values',()=>{
 for(const id of ['',null,false,0,undefined]){const m=fixture();denied(m,()=>m.saveAppointment(input({id}),manager));}
});

test('manager cannot book or confirm an other-store therapist even when the boss confirmed a visiting shift locally',()=>{
 const m=fixture();confirmTestShift(m,{therapistId:'t2',storeId:'a',date:'2026-10-12'});
 denied(m,()=>m.saveAppointment(input({principalId:'t2'}),manager));
 const req=requestCustomerBooking(m,{...input({principalId:'t2'}),requestId:'visiting-therapist'},{type:'customer',id:'c1'});
 assert.equal(customerBookingConfirmation(m,req.id,manager).canConfirm,false);
 denied(m,()=>confirmCustomerBooking(m,req.id,manager));
});

test('manager confirmation replay checks current request staff and the live appointment scope without mutating history',()=>{
 for(const mutate of [m=>{m.state.therapists.find(t=>t.id==='t1').active=false;},(m,row)=>{m.state.appointments.find(a=>a.id===row.appointmentId).storeId='b';},(m,row)=>{m.state.appointments.find(a=>a.id===row.appointmentId).principalId='t2';},m=>{m.state.clients.find(c=>c.id==='c1').ownerId='t4';m.state.services[0].status='revoked';}]){
  const m=fixture(),req=requestCustomerBooking(m,{...input(),requestId:'replay-permission'},{type:'customer',id:'c1'}),row=confirmCustomerBooking(m,req.id,manager);
  mutate(m,row);denied(m,()=>confirmCustomerBooking(m,req.id,manager));
 }
});

test('direct booking destinations expose scoped future bookings and keep manager confirmations in the booking page',()=>{
 const m=fixture(),row=m.saveAppointment(input(),boss);requestCustomerBooking(m,{...input({time:'12:30'}),requestId:'booking-tab-request'},{type:'customer',id:'c1'});
 const ctx={model:m,role:manager,view:'manager-appointments',filters:{},esc:String,icon:()=>'',fmt:{money:String,date:String}};
 const managerHtml=renderManager(ctx);assert.match(managerHtml,/本店预约/);assert.ok(managerHtml.includes(`data-id="${row.id}"`));assert.match(managerHtml,/data-action="customer-booking-confirm"/);
 const therapistHtml=renderStaff({...ctx,role:{type:'therapist',id:'t1'},view:'therapist-appointments'});assert.match(therapistHtml,/我的预约/);assert.ok(therapistHtml.includes(`data-id="${row.id}"`));assert.doesNotMatch(therapistHtml,/何知行|许安然/);
});
