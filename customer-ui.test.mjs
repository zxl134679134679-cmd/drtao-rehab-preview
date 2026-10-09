import { personnelDialog } from './staff.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel, TODAY } from './core.js';
import { confirmedTestSchedules, confirmTestShift } from './scheduling-test-fixture.mjs';
import { scheduleDialog } from './schedules-ui.js';
import { hourTimeField } from './hour-picker.js';
import { ensureCustomerBooking, requestCustomerBooking, confirmCustomerBooking, customerBookingRows } from './customer-booking.js';
import { customerBookingTypes, renderCustomerHome, customerRequestDialog, renderBookingInbox, renderRequestHistory } from './customer-ui.js';

const source = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const boss = { type: 'boss', id: 'boss' };
const customer = id => ({ type: 'customer', id });
const frontA = { type: 'frontdesk', id: 'f1' };
const frontB = { type: 'frontdesk', id: 'f2' };
const managerA = { type: 'manager', id: 'm1' };
const managerB = { type: 'manager', id: 'm2' };
const fixture = () => { const m = confirmedTestSchedules(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T04:00:00.000Z' })); ensureCustomerBooking(m); return m; };
function request(m, clientId = 'c1', fields = {}) {
  const row = m.state.clients.find(c => c.id === clientId);
  return requestCustomerBooking(m, { storeId: row.storeId, date: '2026-10-12', time: '14:30', principalId: row.ownerId,
    project: '阶段训练', requestId: `ui-${clientId}`, ...fields }, customer(clientId));
}
function originalFunction(name, next) {
  const start = source.indexOf(`function ${name}(`), end = source.indexOf(next, start);
  assert.ok(start >= 0 && end > start, `实际 app.js 的 ${name} 函数缺失`);
  return source.slice(start, end);
}
// Run real app HTML helpers, permissions and dialog dispatch. The browser's
// visual photo markup is omitted; no request, account, finance or review guard
// is replaced. DOM and download transport are outside this finite test scope.
function appReader(m, role, view = 'home') {
  const scope = { model: m, role, view, filters: {}, TODAY, hourTimeField,
    customerBookingTypes, customerRequestDialog, renderCustomerHome, renderBookingInbox, renderRequestHistory, scheduleDialog, personnelDialog,
    serviceEvidence: () => '', preferences: new Map(), Intl, Date };
  const helperNames = ['esc','find','name','icon','money','date','weekday','button','link','hidden','field','textarea','form','pair','ctx','customerCtx','clientServices','appointments','reviewFor','currentClient','canEditPlan'];
  const helpers = helperNames.map(name => {
    const line = source.split('\n').find(line => line.startsWith(`const ${name} = `));
    assert.ok(line, `实际 app.js 的 ${name} helper 缺失`);
    return line;
  });
  const begin = source.indexOf('const evaluationTypes = '), end = source.indexOf('\nfunction draftKey(', begin);
  assert.ok(begin >= 0 && end > begin, '实际 app.js 对话分派缺失');
  vm.runInNewContext([
    ...helpers,
    originalFunction('assertClient', '\nfunction assertBoss'),
    originalFunction('assertBoss', '\nfunction assertStaff'),
    originalFunction('assertStaff', '\nfunction assertService'),
    originalFunction('assertService', '\nfunction toast'),
    originalFunction('customerHome', '\nfunction customerRecords'),
    originalFunction('packageRecord', '\nfunction packageDialog'),
    originalFunction('packageDialog', '\nfunction packageHistoryDialog'),
    originalFunction('packageHistoryDialog', '\nfunction appointmentHistoryDialog'),
    originalFunction('appointmentHistoryDialog', '\nfunction serviceDialog'),
    originalFunction('serviceDialog', '\nfunction serviceEvidence'),
    originalFunction('appointmentDialog', '\nfunction reviewDialog'),
    originalFunction('reviewDialog', '\nfunction requestDialog'),
    source.slice(begin, end),
    'globalThis.reader = { open: buildDialog, home: customerHome, customerContext: customerCtx };',
  ].join('\n'), scope);
  return scope.reader;
}
const hasAction = (html, action) => html.includes(`data-action="${action}"`);

test('the actual customer home leads with booking, keeps session balance, and shows both named stores without money', () => {
  const m = fixture(), app = appReader(m, customer('c1'));
  const html = app.home();
  assert.ok(hasAction(html, 'customer-booking'));
  assert.ok(html.indexOf('data-action="customer-booking"') < html.indexOf('data-action="plan"'));
  assert.match(html, /麦岛店/); assert.match(html, /崂山店/);
  assert.match(html, /套餐剩余次数/); assert.match(html, /<strong>9<em> 次<\/em><\/strong>/);
  assert.ok(!/套餐剩余金额|充值余额|可用余额|钱包|[¥￥]/.test(html));
  for (const typeAndId of [['package','c1'],['package-history','p0'],['service-detail','s1']]) {
    const detail = app.open(...typeAndId).html;
    assert.ok(!/套餐金额|消费业绩|[¥￥]/.test(detail), typeAndId.join(':'));
  }
});

test('a pending request renders as a request, and viewing its form, home and details never consumes sessions or money', () => {
  const m = fixture(), before = JSON.stringify([m.state.packages,m.state.services,m.state.receipts,m.state.refunds,m.remaining('c2')]);
  const row = request(m, 'c2'), app = appReader(m, customer('c2'));
  const html = app.home(), dialog = app.open('customer-booking-detail',row.id).html;
  assert.match(html, /待门店确认/); assert.match(dialog, /待门店确认/);
  assert.match(dialog, /未扣次数、未收款/);
  assert.ok(!hasAction(dialog,'customer-booking-confirm'));
  assert.ok(hasAction(dialog,'customer-booking-cancel'));
  app.open('customer-booking','c2');
  assert.equal(JSON.stringify([m.state.packages,m.state.services,m.state.receipts,m.state.refunds,m.remaining('c2')]),before);
});

test('empty and exhausted customer states still present a booking entry with clear confirmation and fee expectations', () => {
  const m = fixture();
  m.state.appointments = m.state.appointments.filter(row=>row.clientId!=='c6');
  const app = appReader(m, customer('c6'));
  const html = app.home();
  assert.ok(hasAction(html,'customer-booking'));
  assert.match(html,/还没安排下一次康复/);
  assert.match(html,/本套餐次数已用完/);
  assert.match(html,/费用请与门店确认/);
  assert.ok(!hasAction(html,'review'));
  assert.match(app.open('customer-booking','c6').html,/申请不扣套餐次数、不收款/);
});

test('the real booking dialog offers the two stores and half-hour requested starts without claiming live slots', () => {
  const app = appReader(fixture(),customer('c1'));
  const html = app.open('customer-booking','c1').html;
  assert.match(html,/麦岛店/); assert.match(html,/崂山店/);
  assert.equal((html.match(/name="storeId"/g)||[]).length,2);
  assert.match(html,/<option value="09:00"/); assert.match(html,/<option value="09:30"/);
  assert.match(html,/期望开始时间/); assert.match(html,/不表示实时空位/);
  assert.ok(!/实时可约|剩余空位|提交即确认/.test(html));
  assert.throws(()=>app.open('customer-booking','c2'),/本人/);
});

test('a valid long next-step plan cannot make booking fail on an invisible, uneditable project field', () => {
  const m=fixture();
  m.state.clients.find(row=>row.id==='c1').nextStep='按计划完成阶段训练并根据复评调整下一次康复安排。'.repeat(8);
  const html=appReader(m,customer('c1')).open('customer-booking','c1').html;
  const project=/<input type="hidden" name="project" value="([^"]*)">/.exec(html)?.[1];
  assert.equal(typeof project,'string');
  assert.doesNotThrow(()=>request(m,'c1',{project}));
});

test('the actual customer review dialog explains boss-only privacy and starts with no selected score', () => {
  const m = fixture(), app = appReader(m,customer('c1'));
  const html = app.open('review','s1').html;
  const scoreInputs = html.match(/<input[^>]+name="score"[^>]*>/g)||[];
  assert.equal(scoreInputs.length,5);
  assert.ok(scoreInputs.every(input=>!input.includes('checked')));
  assert.match(html,/除您本人外，评分和文字反馈仅老板可查看/);
  assert.match(html,/希望老板联系我/);
  assert.throws(()=>appReader(m,customer('c2')).open('review','s1'),/权限/);
  m.submitReview('s1',{score:2,feedback:'真实体验',wantContact:false},customer('c1'));
  const reviewed = app.open('review','s1').html;
  assert.match(reviewed,/真实体验/); assert.ok(!hasAction(reviewed,'customer-booking-confirm'));
});

test('a manager sees only its store request details and the real dispatch never opens a confirmation form', () => {
  const m = fixture(), local = request(m,'c3'), foreign = request(m,'c2');
  const app = appReader(m,managerA,'manager-overview');
  const localHtml = app.open('customer-booking-detail',local.id).html;
  assert.ok(!hasAction(localHtml,'customer-booking-confirm'));
  assert.ok(!hasAction(localHtml,'customer-booking-cancel'));
  assert.throws(()=>app.open('customer-booking-detail',foreign.id),/权限/);
  assert.throws(()=>app.open('customer-booking-confirm',local.id),/店长|权限|确认/);
  const inbox = renderBookingInbox(app.customerContext());
  assert.ok(inbox.includes(local.id)); assert.ok(!inbox.includes(foreign.id));
  assert.ok(!hasAction(inbox,'customer-booking-confirm'));
  assert.throws(()=>appReader(m,managerB,'manager-overview').open('customer-booking-detail',local.id),/权限/);
});

test('a foreign-store front desk may read a basic request but cannot reach the private client or confirmation form', () => {
  const m = fixture();
  confirmTestShift(m, { therapistId: 't1', storeId: 'b', date: '2026-10-12' });
  const client = m.state.clients.find(row=>row.id==='c3');
  client.goal='不应泄露的康复目标';client.openingNotes='不应泄露的纸质病史';
  assert.equal(m.canSeeClient(frontB,'c3'),false);
  const row = request(m,'c3',{storeId:'b'}), app = appReader(m,frontB,'reception');
  const html = app.open('customer-booking-detail',row.id).html;
  assert.match(html,/阶段训练/);assert.match(html,/崂山店/);
  for (const secret of [client.goal,client.openingNotes,client.phone]) assert.ok(!html.includes(secret),secret);
  assert.ok(!hasAction(html,'customer-booking-confirm'));
  assert.throws(()=>app.open('customer-booking-confirm',row.id),/权限|负责|确认/);
  assert.throws(()=>app.open('client-detail','c3'),/康复师|老板|操作/);
  assert.ok(!hasAction(renderBookingInbox(app.customerContext()),'customer-booking-confirm'));
});

test('the authorized store front desk and boss get a confirmation action with a clear no-charge explanation', () => {
  const m = fixture(), row = request(m,'c3');
  for (const [role,view] of [[frontA,'reception'],[boss,'overview']]) {
    const app = appReader(m,role,view);
    assert.ok(hasAction(app.open('customer-booking-detail',row.id).html,'customer-booking-confirm'));
    assert.ok(hasAction(renderBookingInbox(app.customerContext()),'customer-booking-confirm'));
    const form = app.open('customer-booking-confirm',row.id).html;
    assert.match(form,/不扣次数、不记收款/);assert.match(form,/核对当天排班/);
  }
});

test('customer, store, plan and request text remain escaped when the actual helpers render them', () => {
  const m = fixture(), payload='<img src=x onerror="alert(1)">';
  const client=m.state.clients.find(row=>row.id==='c1');
  client.name=payload;client.goal=payload;client.phase=payload;client.nextStep=payload;
  m.state.stores.find(row=>row.id==='a').name=payload;
  m.state.therapists.find(row=>row.id==='t1').name=payload;
  const row=request(m,'c1',{project:payload}),app=appReader(m,customer('c1'));
  for (const html of [app.home(),app.open('customer-booking','c1').html,app.open('customer-booking-detail',row.id).html]) {
    assert.ok(!html.includes(payload));assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  }
});

test('confirmed application details remain submission history after the real appointment is moved', () => {
  const m=fixture();
  m.cancelAppointment('a1','此场景只保留新预约作为下一次服务',boss);
  const row=request(m,'c1'),confirmed=confirmCustomerBooking(m,row.id,boss);
  confirmTestShift(m, { therapistId: 't1', storeId: 'b', date: '2026-10-13' });
  m.saveAppointment({id:confirmed.appointmentId,clientId:'c1',storeId:'b',date:'2026-10-13',time:'16:30',principalId:'t1',project:'阶段训练'},boss);
  const app=appReader(m,customer('c1')),html=app.open('customer-booking-detail',row.id).html;
  assert.match(html,/提交时|历史申请|申请已处理/);
  assert.match(html,/最新预约|预约记录/);
  assert.ok(!html.includes('门店已确认这次安排'));
  assert.ok(!hasAction(html,'appointment'));
  assert.ok(hasAction(html,'appointment-history'));
  const home=app.home();assert.match(home,/10月13日 · 16:30/);
});

test('an actual cancelled appointment detail cannot instruct arrival or offer a reschedule action', () => {
  const m=fixture(),row=request(m,'c1'),confirmed=confirmCustomerBooking(m,row.id,boss);
  m.cancelAppointment(confirmed.appointmentId,'客户不方便到店',boss);
  const dialog=appReader(m,customer('c1')).open('appointment',confirmed.appointmentId),html=dialog.html;
  assert.match(dialog.title+html,/已取消/);
  assert.ok(!html.includes('按当前服务安排到店'));
  assert.ok(!hasAction(html,'reschedule'));
});

test('an appointment requiring reassignment is shown as unconfirmed and cannot offer an arrival instruction', () => {
  const m=fixture(),row=request(m,'c3'),confirmed=confirmCustomerBooking(m,row.id,boss);
  m.transferClient('c3','t3','客户更换负责康复师',boss);
  const appointment=m.state.appointments.find(a=>a.id===confirmed.appointmentId);
  assert.equal(appointment.status,'pending_reassignment');
  const html=appReader(m,customer('c3')).open('appointment',confirmed.appointmentId).html;
  assert.match(html,/待确认|重新确认|等待.*安排/);
  assert.ok(!html.includes('按当前服务安排到店'));
  assert.ok(!hasAction(html,'reschedule'));
});
