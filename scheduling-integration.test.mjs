import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { ensureCustomerBooking, requestCustomerBooking, confirmCustomerBooking, customerBookingConfirmation } from './customer-booking.js';
let scheduling={};try{scheduling=await import('./schedules.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const fresh=()=>{const model=new DemoModel();assert.equal(typeof scheduling.ensureSchedules,'function');scheduling.ensureSchedules(model);ensureCustomerBooking(model);return model;};
const boss={type:'boss',id:'boss'};
const input=overrides=>({clientId:'c3',storeId:'a',principalId:'t1',date:'2026-10-09',time:'10:00',project:'虚构服务',...overrides});
const unchanged=(model,fn,pattern)=>{const before=JSON.stringify([model.state,model.sequence]);assert.throws(fn,pattern);assert.equal(JSON.stringify([model.state,model.sequence]),before);};

test('single appointment rejects therapist rest, missing schedules, wrong store and incomplete last hour atomically',()=>{
 const model=fresh();
 for(const data of [input({clientId:'c5',principalId:'t5',date:model.today}),input({date:'2026-11-01'}),input({storeId:'b'}),input({time:'18:30'})])unchanged(model,()=>model.saveAppointment(data,boss),/休息|排班|门店|下班|时段|时间/);
 const row=model.saveAppointment(input({time:'18:00'}),boss);assert.equal(row.time,'18:00');
});

test('companion batch keeps every record unchanged when one therapist is on rest',()=>{
 const model=fresh();unchanged(model,()=>model.saveAppointmentBatch({storeId:'a',date:model.today,time:'16:00',project:'虚构同行',requestId:'shift-batch',items:[{clientId:'c3',principalId:'t1'},{clientId:'c5',principalId:'t5'}]},boss),/休息/);
});

test('customer cannot apply for time while the responsible therapist is off',()=>{
 const model=fresh();unchanged(model,()=>requestCustomerBooking(model,{...input({clientId:'c5',principalId:'t5',date:model.today}),requestId:'off-request'},{type:'customer',id:'c5'}),/休息/);
});

test('pending customer request is rechecked against changed schedule before confirmation',()=>{
 const model=fresh(),row=requestCustomerBooking(model,{...input(),requestId:'before-shift-change'},{type:'customer',id:'c3'});
 const original=scheduling.scheduleStatus(model,'t1','2026-10-09');
 scheduling.saveSchedule(model,{therapistId:'t1',storeId:'a',date:'2026-10-09',status:'rest',reason:'虚构休息调整',requestId:'shift-change',expectedVersion:original.version},boss);
 assert.equal(customerBookingConfirmation(model,row.id,boss).canConfirm,false);
 unchanged(model,()=>confirmCustomerBooking(model,row.id,boss),/休息/);
});

test('client reschedule rejects hours outside the existing principal schedule and keeps original appointment',()=>{
 const model=fresh();unchanged(model,()=>model.requestReschedule('a3',{date:'2026-10-09',time:'20:00',reason:'虚构改期'},{type:'customer',id:'c3'}),/排班|下班|时段|时间/);
 assert.equal(model.state.appointments.find(row=>row.id==='a3').time,'14:00');
});

test('a service correction restores counts while an off-shift old appointment needs reassignment',()=>{
 const model=fresh(),service=model.state.services.find(row=>row.id==='s1');
 const appointment={id:'schedule-restore',clientId:service.clientId,storeId:service.storeId,principalId:service.principalId,date:model.today,time:service.time,project:service.project,status:'completed',serviceId:service.id};
 model.state.appointments.push(appointment);service.appointmentSnapshots=[{id:appointment.id,status:'confirmed',request:null,requestNote:''}];
 model.cancelAppointment('a2','虚构先处理当日未服务预约',boss);
 const schedule=scheduling.scheduleStatus(model,service.principalId,model.today);
 scheduling.saveSchedule(model,{therapistId:service.principalId,storeId:service.storeId,date:model.today,status:'rest',reason:'虚构当日服务结束后休息',requestId:'restore-shift',expectedVersion:schedule.version},boss);
 model.revokeService(service.id,'虚构更正服务登记',boss);
 assert.equal(appointment.status,'pending_reassignment');assert.match(appointment.reassignmentReason,/排班|休息/);assert.equal(service.status,'revoked');
});
