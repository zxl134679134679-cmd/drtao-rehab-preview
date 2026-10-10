import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { renderStaff } from './staff.js';
import { ensureCustomerBooking } from './customer-booking.js';
import { renderRequestHistory, customerRequestDialog } from './customer-ui.js';

const therapist = id => ({type:'therapist',id});
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const date = value => `${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`;
const action = (label,type,id) => `<button data-action="${esc(type)}" data-id="${esc(id)}">${esc(label)}</button>`;
function context(model,role,view='clients') {
  const name=(kind,id)=>model.state[kind].find(row=>row.id===id)?.name || '待安排';
  return {model,role,view,filters:{},esc,icon:()=>'',fmt:{date},ui:{name,link:action,button:action,pair:(label,value)=>`<div>${esc(label)}：${esc(value)}</div>`}};
}
function fixture() {
  const model=new DemoModel({today:'2026-10-08',now:()=> '2026-10-08T04:00:00.000Z'});
  ensureCustomerBooking(model);
  model.state.bookingRequests.push(...['pending','confirmed','cancelled'].map((status,index)=>({
    id:`read-${status}`,clientId:'c1',storeId:'b',date:`2026-10-${12+index}`,time:'14:30',
    principalId:'t2',project:`客户选择的阶段训练${index}`,status,requestId:`read-submit-${index}`,inputKey:`read-key-${index}`,requestedBy:'c1',requestedRole:'customer',appointmentId:status==='confirmed'?'a1':undefined,requestedAt:'2026-10-08T04:00:00.000Z',
  })));
  return model;
}

test('each visible therapist customer has a booking entry even when no appointment is arranged',()=>{
  const model=fixture(),html=renderStaff(context(model,therapist('t1')));
  assert.match(html,/data-action="appointment-history" data-id="c1"[^>]*>查看预约/);
  assert.match(html,/data-action="appointment-history" data-id="c3"[^>]*>查看预约/);
  model.state.appointments=model.state.appointments.filter(row=>row.clientId!=='c3');
  const noNext=renderStaff(context(model,therapist('t1')));
  assert.match(noNext,/data-action="appointment-history" data-id="c3"[^>]*>查看预约/);
  for(const id of ['c2','c4','c5','c6'])assert.ok(!noNext.includes(`data-action="appointment-history" data-id="${id}"`));
});

test('the therapist work cards offer direct appointment details without adding mutation actions',()=>{
  const model=fixture(),html=renderStaff(context(model,therapist('t1'),'work'));
  for(const id of ['a3','a4'])assert.match(html,new RegExp(`data-action="appointment" data-id="${id}"[^>]*>预约详情`));
  assert.ok(!html.includes('data-action="appointment" data-id="a1"'));
  assert.ok(!html.includes('data-action="appointment" data-id="a2"'));
  assert.ok(!html.includes('data-action="customer-booking-confirm"'));
  const future=renderStaff(context(model,therapist('t2'),'work'));
  assert.match(future,/data-action="appointment" data-id="a1"[^>]*>预约详情/);
});

test('therapist booking request history names client, project, chosen staff, store, requested time and all request states',()=>{
  const model=fixture(),html=renderRequestHistory(context(model,therapist('t1')),'c1');
  for(const expected of ['客户预约申请','陈一诺','崂山店','周亦宁','14:30','客户选择的阶段训练0','待门店确认','申请已处理','申请已取消','已安排的预约'])assert.ok(html.includes(expected),expected);
  for(const id of ['read-pending','read-confirmed','read-cancelled'])assert.ok(html.includes(`data-action="customer-booking-detail" data-id="${id}"`));
  assert.ok(!html.includes('data-action="customer-booking-confirm"'));
  assert.ok(!html.includes('data-action="customer-booking-cancel"'));
});

test('a valid collaborator can read request history and detail while remaining unable to confirm or cancel',()=>{
  const model=fixture(),ctx=context(model,therapist('t3'));
  assert.equal(model.canSeeClient(ctx.role,'c1'),true);
  assert.match(renderRequestHistory(ctx,'c1'),/客户选择的阶段训练0/);
  const detail=customerRequestDialog('customer-booking-detail','read-pending',ctx).html;
  assert.match(detail,/陈一诺/);assert.match(detail,/客户选择的阶段训练0/);
  assert.ok(!detail.includes('data-action="customer-booking-confirm"'));
  assert.ok(!detail.includes('data-action="customer-booking-cancel"'));
  assert.throws(()=>customerRequestDialog('customer-booking-confirm','read-pending',ctx),/权限|负责康复师|排班/);
  assert.throws(()=>customerRequestDialog('customer-booking-cancel','read-pending',ctx),/本人/);
});

test('empty therapist request history still introduces arranged appointments without hiding the available entry',()=>{
  const model=fixture(),html=renderRequestHistory(context(model,therapist('t1')),'c3');
  assert.match(html,/暂无客户预约申请/);
  assert.match(html,/已安排的预约/);
  assert.ok(!html.includes('data-action="customer-booking-detail"'));
});

test('unrelated, disabled and revoked-only therapists cannot render another client request content',()=>{
  const model=fixture();
  assert.match(renderRequestHistory(context(model,therapist('t4')),'c1'),/客户选择的阶段训练0/);
  for(const role of [therapist('unknown')]){
    assert.equal(renderRequestHistory(context(model,role),'c1'),'');
    assert.throws(()=>customerRequestDialog('customer-booking-detail','read-pending',context(model,role)),/权限|不存在|停用|在职/);
  }
  model.state.therapists.find(row=>row.id==='t3').active=false;
  assert.equal(renderRequestHistory(context(model,therapist('t3')),'c1'),'');
  model.state.therapists.find(row=>row.id==='t3').active=true;
  model.state.services.find(row=>row.id==='s1').status='revoked';
  assert.match(renderRequestHistory(context(model,therapist('t3')),'c1'),/客户选择的阶段训练0/);
});

test('the customer request history retains its own existing title, own entries and empty behavior',()=>{
  const model=fixture(),ctx=context(model,{type:'customer',id:'c1'});
  const html=renderRequestHistory(ctx,'c1');
  assert.match(html,/我的预约申请/);assert.match(html,/已安排的预约/);
  assert.equal(renderRequestHistory(ctx,'c2'),'');
  model.state.bookingRequests=[];
  assert.equal(renderRequestHistory(ctx,'c1'),'');
});


test('processed therapist request details retain the submitted snapshot and lead to the current booking record',()=>{
  const model=fixture(),ctx=context(model,therapist('t3'));
  const detail=customerRequestDialog('customer-booking-detail','read-confirmed',ctx).html;
  assert.match(detail,/提交时的申请内容/);
  assert.match(detail,/10月13日 14:30/);
  assert.match(detail,/data-action="appointment-history" data-id="c1"[^>]*>查看最新预约记录/);
  assert.ok(!detail.includes('data-action="customer-booking-confirm"'));
  assert.ok(!detail.includes('data-action="customer-booking-cancel"'));
});
