import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { confirmedTestSchedules } from './scheduling-test-fixture.mjs';
import * as booking from './customer-booking.js';
import { customerBookingTherapists } from './booking-availability.js';
const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'},customer={type:'customer',id:'c1'};
const ready=()=>{const m=confirmedTestSchedules(new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T04:00:00.000Z'}));booking.ensureCustomerBooking(m);return m;};
const input=(extra={})=>({storeId:'a',date:'2026-10-12',time:'14:30',principalId:'t1',project:'康复服务',requestId:'exception-1',...extra});
const api=name=>{assert.equal(typeof booking[name],'function',`缺少预约处理接口 ${name}`);return booking[name];};
const snapshot=m=>JSON.stringify({state:m.state,sequence:m.sequence});
function rejectUnchanged(m,action,pattern){const old=snapshot(m);assert.throws(action,pattern);assert.equal(snapshot(m),old);}
function submit(m,extra={},role=customer){return booking.requestCustomerBooking(m,input(extra),role);}

test('request confirmation reflects current conflicts instead of showing a false actionable confirmation',()=>{
  const m=ready(),first=submit(m),second=submit(m,{requestId:'exception-2'},{type:'customer',id:'c3'});
  assert.equal(booking.customerBookingConfirmation(m,first.id,front).canConfirm,true);
  booking.confirmCustomerBooking(m,first.id,front);
  assert.equal(booking.customerBookingConfirmation(m,second.id,front).canConfirm,false);
  assert.match(booking.customerBookingConfirmation(m,second.id,front).reason,/时段|冲突|预约/);
});

test('staff can close an unarrangeable request with traceable reason without charging or creating an appointment',()=>{
  const m=ready(),row=submit(m),before=structuredClone(m.state),resolve=api('resolveCustomerBooking');
  const result=resolve(m,{id:row.id,outcome:'rejected',reason:'康复师临时调整，请选择其他时间'},front);
  assert.equal(result.status,'rejected');assert.equal(result.resolutionReason,'康复师临时调整，请选择其他时间');
  assert.equal(result.resolvedBy,'f1');assert.equal(result.resolvedRole,'frontdesk');assert.equal(result.resolvedAt,'2026-10-09T04:00:00.000Z');
  for(const key of ['appointments','packages','services','receipts','refunds'])assert.deepEqual(m.state[key],before[key]);
  assert.equal(booking.customerBookingRows(m,customer)[0].resolutionReason,result.resolutionReason);
  const old=snapshot(m);assert.deepEqual(resolve(m,{id:row.id,outcome:'rejected',reason:result.resolutionReason},front),result);assert.equal(snapshot(m),old);
  rejectUnchanged(m,()=>booking.confirmCustomerBooking(m,row.id,boss),/处理|确认|申请/);
});

test('alternative time requires customer acceptance and a separate staff confirmation',()=>{
  const m=ready(),row=submit(m),resolve=api('resolveCustomerBooking'),accept=api('acceptCustomerBookingSuggestion'),before=m.state.appointments.length;
  const suggested=resolve(m,{id:row.id,outcome:'reschedule_suggested',reason:'原时段已满，建议晚一小时',date:'2026-10-12',time:'15:30'},front);
  assert.equal(suggested.status,'reschedule_suggested');assert.equal(suggested.suggestedDate,'2026-10-12');assert.equal(suggested.suggestedTime,'15:30');
  assert.equal(suggested.date,'2026-10-12');assert.equal(suggested.time,'14:30');assert.equal(m.state.appointments.length,before);
  rejectUnchanged(m,()=>accept(m,row.id,boss),/客户|本人/);
  rejectUnchanged(m,()=>accept(m,row.id,{type:'customer',id:'c3'}),/客户|本人/);
  const accepted=accept(m,row.id,customer);assert.equal(accepted.status,'pending');assert.equal(accepted.time,'15:30');assert.equal(m.state.appointments.length,before);
  const original=booking.customerBookingRows(m,customer).find(item=>item.id===row.id);assert.equal(original.status,'suggestion_accepted');assert.equal(original.acceptedRequestId,accepted.id);
  const old=snapshot(m);assert.deepEqual(accept(m,row.id,customer),accepted);assert.equal(snapshot(m),old);
  const confirmed=booking.confirmCustomerBooking(m,accepted.id,front);assert.equal(confirmed.status,'confirmed');assert.equal(m.state.appointments.length,before+1);
});

test('suggestion acceptance rechecks current availability and cannot revive an unavailable or cancelled request',()=>{
  const m=ready(),row=submit(m),resolve=api('resolveCustomerBooking'),accept=api('acceptCustomerBookingSuggestion');
  resolve(m,{id:row.id,outcome:'reschedule_suggested',reason:'请考虑这个时间',date:'2026-10-12',time:'15:30'},front);
  m.saveAppointment({clientId:'c3',storeId:'a',date:'2026-10-12',time:'15:30',principalId:'t1',project:'康复服务'},boss);
  rejectUnchanged(m,()=>accept(m,row.id,customer),/时段|冲突|预约/);
  assert.equal(m.state.bookingRequests.find(item=>item.id===row.id).status,'reschedule_suggested');
  booking.cancelCustomerBooking(m,row.id,customer);
  rejectUnchanged(m,()=>accept(m,row.id,customer),/取消|建议|处理/);
});

test('expired requests are explicitly closed by authorized staff and future requests cannot be expired',()=>{
  const m=ready(),row=submit(m),resolve=api('resolveCustomerBooking');
  rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'expired',reason:'申请已过期'},front),/过期|日期|过去/);
  m.today='2026-10-13';const result=resolve(m,{id:row.id,outcome:'expired',reason:'到店日期已过，未确认'},front);
  assert.equal(result.status,'expired');assert.equal(result.resolvedBy,'f1');
});

test('managers remain read only and customers or unrelated staff cannot resolve requests',()=>{
  const m=ready(),row=submit(m),resolve=api('resolveCustomerBooking');
  for(const role of [customer,{type:'manager',id:'m1'},{type:'frontdesk',id:'f2'},{type:'therapist',id:'t3'}])rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'rejected',reason:'不能安排'},role),/权限|负责|只读|门店|老板/);
  rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'rejected',reason:''},front),/原因|有效|填写/);
  rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'wrong',reason:'不能安排'},front),/处理|结果|有效/);
  rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'reschedule_suggested',reason:'不改',date:row.date,time:row.time},front),/不同|原|调整|改变/);
});

test('a store assigned execution therapist makes first cross store booking possible without changing archive ownership',()=>{
  const m=ready();assert.equal(typeof m.assignStoreTherapist,'function','缺少本店执行康复师授权');
  assert.deepEqual(customerBookingTherapists(m,'c3','b','2026-10-12'),[]);
  m.assignStoreTherapist({clientId:'c3',storeId:'b',therapistId:'t2',reason:'崂山店首诊由周亦宁服务'},boss);
  assert.equal(m.state.clients.find(item=>item.id==='c3').ownerId,'t1');
  assert.deepEqual(customerBookingTherapists(m,'c3','b','2026-10-12').map(item=>item.id),['t2']);
  const row=submit(m,{storeId:'b',principalId:'t2'},{type:'customer',id:'c3'});
  assert.equal(booking.customerBookingConfirmation(m,row.id,{type:'therapist',id:'t2'}).canConfirm,true);
  const confirmed=booking.confirmCustomerBooking(m,row.id,{type:'therapist',id:'t2'});assert.equal(confirmed.confirmedBy,'t2');
});

test('invalid suggestion details fail atomically and rejected retries cannot reopen the request',()=>{
  const m=ready(),row=submit(m),resolve=api('resolveCustomerBooking');
  for(const extra of [{date:'2026-10-08',time:'15:30'},{date:'2026-02-30',time:'15:30'},{date:'2026-10-12',time:'15:15'},{date:'2026-10-12',time:'24:00'}])rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'reschedule_suggested',reason:'建议调整',...extra},front));
  const rejected=resolve(m,{id:row.id,outcome:'rejected',reason:'今天无空位'},boss),old=snapshot(m);
  assert.deepEqual(submit(m),rejected);assert.equal(snapshot(m),old);
  rejectUnchanged(m,()=>resolve(m,{id:row.id,outcome:'expired',reason:'另一个处理结果'},boss),/处理|重复/);
});

test('reconstruction preserves suggested and accepted outcome links without exposing internal resolution keys',()=>{
  const m=ready(),row=submit(m),resolve=api('resolveCustomerBooking'),accept=api('acceptCustomerBookingSuggestion');
  resolve(m,{id:row.id,outcome:'reschedule_suggested',reason:'建议其他时段',date:'2026-10-12',time:'15:30'},front);
  const reconstructed=new DemoModel({today:m.today,now:m.now,state:m.state,sequence:m.sequence});booking.ensureCustomerBooking(reconstructed);
  const accepted=accept(reconstructed,row.id,customer);
  const reopened=new DemoModel({today:m.today,now:m.now,state:reconstructed.state,sequence:0});booking.ensureCustomerBooking(reopened);
  const before=snapshot(reopened);assert.deepEqual(accept(reopened,row.id,customer),accepted);assert.equal(snapshot(reopened),before);
  assert.ok(booking.customerBookingRows(reopened,customer).every(item=>!Object.hasOwn(item,'resolutionKey')));
});


test('authorized staff conflict explanation asks for another time instead of misleading permission escalation',()=>{
  const m=ready(),row=submit(m);m.saveAppointment({clientId:'c3',storeId:'a',date:'2026-10-12',time:'14:30',principalId:'t1',project:'康复服务'},boss);
  const hint=booking.customerBookingConfirmation(m,row.id,front);assert.equal(hint.canConfirm,false);assert.match(hint.reason,/时段|冲突/);assert.doesNotMatch(hint.reason,/负责人或老板确认/);
});

test('unaccepted suggested requests can be closed after their suggested date passes',()=>{
  const m=ready(),row=submit(m);api('resolveCustomerBooking')(m,{id:row.id,outcome:'reschedule_suggested',reason:'建议周二',date:'2026-10-13',time:'15:30'},front);
  m.today='2026-10-13';rejectUnchanged(m,()=>api('resolveCustomerBooking')(m,{id:row.id,outcome:'expired',reason:'日期已过'},front),/日期|过期|过去|已经处理/);
  m.today='2026-10-14';assert.equal(api('customerBookingHandling')(m,row.id,front).canHandle,true);
  assert.equal(api('resolveCustomerBooking')(m,{id:row.id,outcome:'expired',reason:'建议日期已过，客户尚未接受'},front).status,'expired');
});

test('store execution archive visibility does not make customer therapist options writable at another store',()=>{
  const m=ready();m.assignStoreTherapist({clientId:'c3',storeId:'b',therapistId:'t2',reason:'仅在崂山店执行'},boss);
  const shift=m.state.staffSchedules.find(row=>row.therapistId==='t2'&&row.date==='2026-10-12');shift.storeId='a';
  assert.equal(m.canSeeClient({type:'therapist',id:'t2'},'c3'),true);
  assert.ok(!customerBookingTherapists(m,'c3','a','2026-10-12').some(row=>row.id==='t2'));
  rejectUnchanged(m,()=>submit(m,{storeId:'a',principalId:'t2'},{type:'customer',id:'c3'}),/门店|安排|康复师|权限/);
});

test('an execution therapist may handle their own store assignment while another requested therapist stays read only',()=>{
  const m=ready();m.assignStoreTherapist({clientId:'c3',storeId:'b',therapistId:'t2',reason:'在崂山店执行'},boss);
  const shift=m.state.staffSchedules.find(row=>row.therapistId==='t1'&&row.date==='2026-10-12');shift.storeId='b';
  const row=submit(m,{storeId:'b',principalId:'t1'},{type:'customer',id:'c3'}),execution={type:'therapist',id:'t2'};
  assert.equal(booking.customerBookingConfirmation(m,row.id,execution).canConfirm,false);
  rejectUnchanged(m,()=>api('resolveCustomerBooking')(m,{id:row.id,outcome:'rejected',reason:'不能安排'},execution),/负责|执行|权限/);
});
