import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { confirmedTestSchedules } from './scheduling-test-fixture.mjs';
import { ensureCustomerBooking, requestCustomerBooking } from './customer-booking.js';
import { renderCustomerHome, renderBookingInbox, customerRequestDialog, customerBookingTypes, renderRequestHistory } from './customer-ui.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date=value=>`${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;
const action=(label,type,id)=>`<button data-action="${esc(type)}" data-id="${esc(id)}">${esc(label)}</button>`;
const ready=()=>{const m=confirmedTestSchedules(new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T04:00:00.000Z'}));ensureCustomerBooking(m);return m;};
function context(model,role,view='reception') {const name=(kind,id)=>model.state[kind].find(row=>row.id===id)?.name||'待安排';return {model,role,view,esc,icon:()=>'',fmt:{date},ui:{name,link:action,button:action,pair:(label,value)=>`<div>${esc(label)}：${esc(value)}</div>`,appointments:id=>model.state.appointments.filter(row=>row.clientId===id&&['confirmed','reschedule_requested'].includes(row.status)),clientServices:()=>[],reviewFor:()=>null,hidden:(key,value)=>`<input type="hidden" name="${esc(key)}" value="${esc(value)}">`,field:(label,key,value='',type='text',attrs='')=>`<label>${esc(label)}<input name="${esc(key)}" type="${esc(type)}" value="${esc(value)}" ${attrs}></label>`,form:(type,html,submit)=>`<form data-form="${esc(type)}">${html}<button type="submit">${esc(submit)}</button></form>`,hourTimeField:()=>'<select name="time" required><option value="">请选择时间</option></select>'}};}
function request(model){return requestCustomerBooking(model,{storeId:'a',date:'2026-10-12',time:'14:30',principalId:'t1',project:'康复服务',requestId:'ui-1'},{type:'customer',id:'c1'});}

test('customer homepage offers cancellation request for a confirmed upcoming appointment',()=>{
  const m=ready(),html=renderCustomerHome(context(m,{type:'customer',id:'c1'}));
  assert.match(html,/data-action="appointment-cancel-request" data-id="a1"/);assert.match(html,/申请取消/);
});

test('front desk can explicitly handle an unavailable request instead of only seeing a blocked confirmation',()=>{
  const m=ready(),row=request(m);m.saveAppointment({clientId:'c3',storeId:'a',date:'2026-10-12',time:'14:30',principalId:'t1',project:'康复服务'},{type:'boss',id:'boss'});
  const html=renderBookingInbox(context(m,{type:'frontdesk',id:'f1'}));
  assert.match(html,new RegExp(`data-action="customer-booking-resolve" data-id="${row.id}"`));assert.match(html,/处理申请/);assert.ok(!html.includes('data-action="customer-booking-confirm"'));
});

test('request resolution form offers reason and optional alternative while keeping managers read only',()=>{
  const m=ready(),row=request(m);assert.equal(customerBookingTypes.has('customer-booking-resolve'),true);
  const dialog=customerRequestDialog('customer-booking-resolve',row.id,context(m,{type:'frontdesk',id:'f1'}));
  assert.match(dialog.html,/name="outcome"/);assert.match(dialog.html,/name="reason"/);assert.match(dialog.html,/建议其他时间/);assert.match(dialog.html,/无法安排/);assert.match(dialog.html,/客户接受/);
  assert.throws(()=>customerRequestDialog('customer-booking-resolve',row.id,context(m,{type:'manager',id:'m1'})),/只读|权限|老板|负责/);
});

test('customers can read suggested time, reason and handling actor before explicitly accepting',()=>{
  const m=ready(),row=request(m),source=m.state.bookingRequests.find(item=>item.id===row.id);
  Object.assign(source,{status:'reschedule_suggested',resolutionReason:'原时段已满 <请改时间>',resolvedBy:'f1',resolvedRole:'frontdesk',resolvedAt:'2026-10-09T04:00:00.000Z',suggestedDate:'2026-10-12',suggestedTime:'15:30'});
  const ctx=context(m,{type:'customer',id:'c1'}),detail=customerRequestDialog('customer-booking-detail',row.id,ctx).html;
  assert.match(detail,/15:30/);assert.match(detail,/14:30/);assert.match(detail,/待您接受/);assert.match(detail,/麦岛店前台/);assert.match(detail,/原时段已满 &lt;请改时间&gt;/);assert.match(detail,/data-action="customer-booking-accept"/);
  const html=renderCustomerHome(ctx);assert.match(html,/门店建议/);assert.match(html,/15:30/);
  const acceptance=customerRequestDialog('customer-booking-accept',row.id,ctx).html;assert.match(acceptance,/仍需门店确认/);
});

test('processed requests remain discoverable in customer history and staff recent results',()=>{
  const m=ready(),row=request(m);Object.assign(m.state.bookingRequests[0],{status:'rejected',resolutionReason:'当天已满',resolvedBy:'f1',resolvedRole:'frontdesk',resolvedAt:'2026-10-09T04:00:00.000Z'});
  const history=renderRequestHistory(context(m,{type:'customer',id:'c1'}),'c1');assert.match(history,/无法安排/);assert.match(history,new RegExp(row.id));
  const inbox=renderBookingInbox(context(m,{type:'frontdesk',id:'f1'}));assert.match(inbox,/最近处理结果/);assert.match(inbox,/无法安排/);
});

test('customer pending cancellation displays retained original appointment and hides duplicate change actions',()=>{
  const m=ready();m.state.appointments.find(row=>row.id==='a1').cancellationRequest={status:'pending',reason:'时间不方便'};
  const html=renderCustomerHome(context(m,{type:'customer',id:'c1'}));assert.match(html,/取消申请待门店处理/);assert.match(html,/原预约仍保留/);assert.ok(!html.includes('data-action="appointment-cancel-request"'));assert.ok(!html.includes('data-action="reschedule"'));
});

test('front desk can find older handled results in client request history within its assigned store',()=>{
  const m=ready();
  for(let day=12;day<19;day++)requestCustomerBooking(m,{storeId:'a',date:`2026-10-${day}`,time:'14:30',principalId:'t1',project:'康复服务',requestId:`older-ui-${day}`},{type:'customer',id:'c1'});
  Object.assign(m.state.bookingRequests[0],{status:'rejected',resolutionReason:'原预约时段已满',resolvedBy:'f1',resolvedRole:'frontdesk',resolvedAt:'2026-10-09T04:00:00.000Z'});
  const history=renderRequestHistory(context(m,{type:'frontdesk',id:'f1'}),'c1');assert.match(history,/客户预约申请/);assert.match(history,new RegExp(m.state.bookingRequests[0].id));assert.match(history,/无法安排/);
  const other=renderRequestHistory(context(m,{type:'frontdesk',id:'f2'}),'c1');assert.ok(other.includes(m.state.bookingRequests[0].id));
});

test('staff can open an expiry-only form after an unaccepted suggested date passes',()=>{
  const m=ready(),row=request(m);Object.assign(m.state.bookingRequests[0],{status:'reschedule_suggested',resolutionReason:'建议周二',resolvedBy:'f1',resolvedRole:'frontdesk',resolvedAt:'2026-10-09T04:00:00.000Z',suggestedDate:'2026-10-13',suggestedTime:'15:30'});m.today='2026-10-14';
  const ctx=context(m,{type:'frontdesk',id:'f1'}),dialog=customerRequestDialog('customer-booking-resolve',row.id,ctx);
  assert.match(dialog.html,/value="expired"/);assert.ok(!dialog.html.includes('value="reschedule_suggested"'));assert.ok(!dialog.html.includes('value="rejected"'));
  assert.match(customerRequestDialog('customer-booking-detail',row.id,ctx).html,/data-action="customer-booking-resolve"/);
});
