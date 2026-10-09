import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import { renderReception, receptionDialog } from './reception.js';
import { cashDialog, cashOverview } from './cash.js';

const front={type:'frontdesk',id:'f1'},boss={type:'boss',id:'boss'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=(model,role=front)=>({model,role,esc,icon:()=>'',fmt:{money:value=>`¥${Number(value).toFixed(2)}`,date:value=>value},filters:{storeId:'a'},view:'reception'});
function fixture(){
  const model=ensureStorePackageExamples(new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T08:00:00.000Z'}));
  model.state.appointments.push(
    {id:'today-wait',clientId:'c3',date:model.today,time:'14:00',storeId:'a',principalId:'t1',project:'阶段复评',status:'confirmed'},
    {id:'today-arrived',clientId:'c5',date:model.today,time:'15:00',storeId:'a',principalId:'t5',project:'基础训练',status:'confirmed',arrivalAt:'2026-10-09T06:00:00.000Z'},
    {id:'other-store',clientId:'c2',date:model.today,time:'14:00',storeId:'b',principalId:'t2',project:'基础训练',status:'confirmed'});
  return model;
}
function selected(html,name,value){return new RegExp(`<select[^>]*name="${name}"[^>]*>[\\s\\S]*?<option value="${value}" selected`).test(html);}

test('front desk sees reception and today appointments before the collapsed cash closing section',()=>{
  const model=fixture(),html=renderReception(ctx(model));
  const entry=html.indexOf('aria-label="接待入口"'),today=html.indexOf('今天的预约'),closing=html.indexOf('今日对账');
  assert.ok(entry>=0&&today>entry&&closing>today,'daily financial checks must not hide the reception workflow');
  assert.match(html,/<details\b[^>]*class="[^"]*reception-closing[^"]*"(?![^>]*\bopen)[^>]*>/);
  assert.match(html,/data-action="reception-appointment-list" data-id="waiting"/);
  assert.match(html,/data-action="reception-appointment-list" data-id="unrecorded"/);
  assert.match(html,/data-action="record-receipt" data-id="appointment:today-wait"/);
});

test('waiting and arrived statistics open only the matching local appointments',()=>{
  const model=fixture(),waiting=receptionDialog('reception-appointment-list','waiting',ctx(model)),arrived=receptionDialog('reception-appointment-list','unrecorded',ctx(model));
  assert.ok(waiting&&arrived,'statistics must lead to an actionable filtered list');
  assert.match(waiting.html,/周沐/);assert.doesNotMatch(waiting.html,/王星野|许安然/);
  assert.match(arrived.html,/王星野/);assert.doesNotMatch(arrived.html,/周沐|许安然/);
  model.state.appointments.find(a=>a.id==='today-wait').status='cancelled';
  assert.match(receptionDialog('reception-appointment-list','waiting',ctx(model)).html,/暂无|没有/);
  assert.throws(()=>receptionDialog('reception-appointment-list','waiting',ctx(model,{type:'manager',id:'m1'})),/前台|权限/);
});

test('receipt from an appointment prefills its authorized customer and store without taking a payment or consuming a session',()=>{
  const model=fixture(),before=structuredClone(model.state);
  const html=cashDialog('record-receipt','appointment:today-wait',ctx(model)).html;
  assert.ok(selected(html,'clientId','c3'));assert.ok(selected(html,'storeId','a'));
  assert.match(html,/周沐.*14:00|14:00.*周沐/);assert.match(html,/阶段复评/);assert.match(html,/核对|确认/);
  assert.match(html,/name="appointmentId"[^>]*value="today-wait"/);
  assert.match(html,/name="amount"[^>]*placeholder="0.00"/);
  assert.deepEqual(model.state,before);
  assert.throws(()=>cashDialog('record-receipt','appointment:other-store',ctx(model)),/门店|权限/);
  assert.throws(()=>cashDialog('record-receipt','appointment:missing',ctx(model,boss)),/预约|不存在/);
});

test('ordinary and package-prefilled receipts remain usable without an appointment context',()=>{
  const model=fixture(),ordinary=cashDialog('record-receipt','',ctx(model)).html,pack=cashDialog('record-receipt','p7',ctx(model)).html;
  assert.ok(selected(ordinary,'clientId',''));assert.doesNotMatch(ordinary,/name="appointmentId"/);
  assert.ok(selected(pack,'clientId','c1'));assert.ok(selected(pack,'storeId','a'));assert.match(pack,/value="p7" selected/);
});

test('boss cash summary keeps net revenue visible and folds channel details without changing totals',()=>{
  const model=fixture();
  model.recordReceipt({clientId:'c3',storeId:'a',purpose:'single',method:'wechat',channel:'direct',amount:'400',date:model.today,time:'14:00',requestId:'ease-receipt'},front);
  const html=cashOverview({...ctx(model,boss),filters:{storeId:'a',from:model.today,to:model.today}},'今天');
  assert.match(html,/<section class="cash-hero cash-hero-compact"/);
  assert.match(html,/<strong class="cash-total">¥400\.00<\/strong>/);
  assert.match(html,/<details\b[^>]*class="[^"]*cash-channel-details[^"]*"(?![^>]*\bopen)[^>]*>/);
  assert.match(html,/门店收款/);assert.match(html,/收款 ¥400\.00/);
});
