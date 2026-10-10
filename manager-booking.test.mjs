import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { confirmedTestSchedules, confirmTestShift } from './scheduling-test-fixture.mjs';
import { requestCustomerBooking, confirmCustomerBooking, customerBookingConfirmation, resolveCustomerBooking, customerBookingHandling } from './customer-booking.js';
import { renderStaff, staffDialog } from './staff.js';
import { renderManager } from './manager.js';
const manager = {type:'manager',id:'m1'}, boss={type:'boss',id:'boss'};
const fixture=()=>confirmedTestSchedules(new DemoModel({now:()=> '2026-10-09T04:00:00.000Z'}));
const input=extra=>({clientId:'c1',storeId:'a',date:'2026-10-12',time:'10:00',principalId:'t1',project:'阶段复评',...extra});
const denied=(model,run)=>{const before=JSON.stringify([model.state,model.sequence]);assert.throws(run,/权限|本店|店长|仅|只读|停用|在职/);assert.equal(JSON.stringify([model.state,model.sequence]),before);};
const context=(model,role)=>({model,role,filters:{}});

test('manager cannot create even a local booking; boss writes preserve financial records',()=>{const m=fixture(),before=structuredClone(m.state);denied(m,()=>m.saveAppointment(input(),manager));const row=m.saveAppointment(input(),boss);assert.equal(row.status,'confirmed');assert.deepEqual(m.state.packages,before.packages);assert.deepEqual(m.state.receipts,before.receipts);assert.equal(m.state.audit[0].actorType,'boss');});

test('manager creation rejects local, foreign, forged and inactive identities atomically',()=>{const m=fixture();for(const extra of [{},{storeId:'b',principalId:'t2'},{clientId:'c2',principalId:'t2'}])denied(m,()=>m.saveAppointment(input(extra),manager));for(const role of [{type:'manager',id:'unknown'},{type:'boss',id:'m1'}])denied(m,()=>m.saveAppointment(input(),role));m.state.storeManagers[0].active=false;denied(m,()=>m.saveAppointment(input(),manager));});

test('manager cannot edit, cancel, mark no-show, create a group or process a cancellation through the booking exception',()=>{
 const m=fixture(),row=m.saveAppointment(input(),boss);
 const actions=[()=>m.saveAppointment(input({id:row.id,time:'11:00'}),manager),()=>m.cancelAppointment(row.id,'行程改变',manager),()=>m.markNoShow('a3','未到店',manager),()=>m.recordArrival('a3',{requestId:'manager-arrival'},manager),()=>m.handleAppointmentCancellation(row.id,{decision:'approve',reason:'取消'},manager),()=>m.saveAppointmentBatch({storeId:'a',date:'2026-10-12',time:'12:00',project:'复评',items:[{clientId:'c1',principalId:'t1'},{clientId:'c5',principalId:'t5'}],requestId:'manager-group'},manager)];
 actions.forEach(run=>denied(m,run));
});

test('manager pending requests are read-only; authorized front desk confirmation preserves provenance',()=>{const m=fixture(),req=requestCustomerBooking(m,{...input(),requestId:'confirm'},{type:'customer',id:'c1'});assert.equal(customerBookingConfirmation(m,req.id,manager).canConfirm,false);denied(m,()=>confirmCustomerBooking(m,req.id,manager));const done=confirmCustomerBooking(m,req.id,{type:'frontdesk',id:'f1'});assert.equal(done.confirmedRole,'frontdesk');assert.equal(done.confirmedBy,'f1');});

test('manager cannot confirm or resolve local or foreign requests even with valid availability',()=>{const m=fixture();const local=requestCustomerBooking(m,{...input(),requestId:'local'},{type:'customer',id:'c1'}),foreign=requestCustomerBooking(m,{...input({storeId:'b',clientId:'c2',principalId:'t2'}),requestId:'foreign'},{type:'customer',id:'c2'});for(const req of [local,foreign])denied(m,()=>confirmCustomerBooking(m,req.id,manager));assert.equal(customerBookingHandling(m,local.id,manager).canHandle,false);denied(m,()=>resolveCustomerBooking(m,{id:local.id,outcome:'rejected',reason:'拒绝'},manager));});

test('manager cannot open any staff write dialog including local new booking',()=>{const m=fixture();for(const type of ['appointment-create','appointment-edit','register','register-appointment','edit-plan'])denied(m,()=>staffDialog(type,'c1',context(m,manager)));});

test('therapist work home exposes the own current shift beside the actual appointment and service-photo entry',()=>{
 const m=fixture(),ctx={model:m,role:{type:'therapist',id:'t1'},view:'work',filters:{},esc:String,icon:()=>''};
 const html=renderStaff(ctx);assert.match(html,/本人今日排班/);assert.match(html,/00:00–23:30/);assert.match(html,/data-action="register"/);assert.match(html,/data-action="client-detail"/);
 const shift=m.state.staffSchedules.find(r=>r.therapistId==='t1'&&r.date===m.today);Object.assign(shift,{status:'rest',startTime:'',endTime:''});
 assert.match(renderStaff(ctx),/本人今日排班[\s\S]*休息/);
});


test('manager overview exposes current appointments and requests with no booking or confirmation controls',()=>{const m=fixture();requestCustomerBooking(m,{...input(),requestId:'home-request'},{type:'customer',id:'c1'});const html=renderManager({model:m,role:manager,view:'manager-overview',filters:{},esc:String,icon:()=>'',fmt:{money:String,date:String}});assert.match(html,/今天的安排/);assert.doesNotMatch(html,/data-action="appointment-create"|data-action="customer-booking-confirm"|data-action="appointment-edit"|data-action="register"/);});

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

test('manager cannot replay a frontdesk-confirmed booking or acquire write access from its history',()=>{const m=fixture(),req=requestCustomerBooking(m,{...input(),requestId:'replay'},{type:'customer',id:'c1'});confirmCustomerBooking(m,req.id,{type:'frontdesk',id:'f1'});denied(m,()=>confirmCustomerBooking(m,req.id,manager));});

test('direct booking destinations expose scoped future bookings and keep manager booking page read-only',()=>{
 const m=fixture(),row=m.saveAppointment(input(),boss);requestCustomerBooking(m,{...input({time:'12:30'}),requestId:'booking-tab-request'},{type:'customer',id:'c1'});
 const ctx={model:m,role:manager,view:'manager-appointments',filters:{},esc:String,icon:()=>'',fmt:{money:String,date:String}};
 const managerHtml=renderManager(ctx);assert.match(managerHtml,/本店预约/);assert.ok(managerHtml.includes(`data-id="${row.id}"`));assert.doesNotMatch(managerHtml,/data-action="customer-booking-confirm"/);
 const therapistHtml=renderStaff({...ctx,role:{type:'therapist',id:'t1'},view:'therapist-appointments'});assert.match(therapistHtml,/我的预约/);assert.ok(therapistHtml.includes(`data-id="${row.id}"`));assert.doesNotMatch(therapistHtml,/何知行|许安然/);
});
