import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { DemoModel } from './legacy-test-fixture.mjs';
import { confirmedTestSchedules, confirmTestShift } from './scheduling-test-fixture.mjs';

const moduleUrl = new URL('./customer-booking.js', import.meta.url);
const booking = existsSync(moduleUrl) ? await import(moduleUrl) : {};
const boss = { type: 'boss', id: 'boss' };
const customer = { type: 'customer', id: 'c1' };
const frontA = { type: 'frontdesk', id: 'f1' };
const frontB = { type: 'frontdesk', id: 'f2' };
const owner = { type: 'therapist', id: 't1' };
const managerA = { type: 'manager', id: 'm1' };
const managerB = { type: 'manager', id: 'm2' };
const model = () => confirmedTestSchedules(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T04:00:00.000Z' }));
const input = (extra = {}) => ({ storeId: 'a', date: '2026-10-12', time: '14:30', principalId: 't1', project: '康复服务', requestId: 'customer-request-1', ...extra });
const snapshot = m => JSON.stringify({ state: m.state, sequence: m.sequence });
const finance = m => JSON.stringify({ packages: m.state.packages, services: m.state.services, receipts: m.state.receipts, refunds: m.state.refunds, remaining: m.state.clients.map(c => [c.id, m.remaining(c.id)]), performance: m.state.therapists.map(t => [t.id, m.performance(t.id)]) });
function api(name) { assert.equal(typeof booking[name], 'function', `客户预约申请缺少 ${name} API`); return booking[name]; }
function ready() { const m = model(); api('ensureCustomerBooking')(m); return m; }
function submit(m, data = input(), role = customer) { return api('requestCustomerBooking')(m, data, role); }
function rejectUnchanged(m, action, pattern) { const before = snapshot(m); assert.throws(action, pattern); assert.equal(snapshot(m), before, '失败不得改变申请、预约、待办、审计或序列'); }

test('a customer submits a pending half-hour request without confirming a slot or consuming money and sessions', () => {
  const m = ready(), before = finance(m), oldAppointments = structuredClone(m.state.appointments);
  const row = submit(m);
  assert.equal(row.clientId, 'c1'); assert.equal(row.status, 'pending');
  assert.equal(row.time, '14:30'); assert.equal(row.requestedBy, 'c1'); assert.equal(row.requestedRole, 'customer');
  assert.equal(row.requestedAt, '2026-10-09T04:00:00.000Z');
  assert.equal(row.appointmentId, undefined);
  assert.deepEqual(m.state.appointments, oldAppointments); assert.equal(finance(m), before);
  assert.equal(m.state.bookingRequests.length, 1);
  const audit = m.state.audit[0]; assert.equal(audit.actorId, 'c1'); assert.equal(audit.actorType, 'customer');
});

test('a customer cannot submit for another customer or use a staff account to submit a customer request', () => {
  const m = ready();
  rejectUnchanged(m, () => submit(m, input({ clientId: 'c2' })), /本人|自己|客户/);
  for (const role of [boss, frontA, owner, managerA, { type: 'customer', id: 'missing' }]) rejectUnchanged(m, () => submit(m, input(), role), /本人|客户|权限|不存在/);
});

test('request validation rejects impossible or past dates, non-half-hour starts and inactive or unrelated assignments', () => {
  const m = ready();
  for (const data of [input({ date: '2026-02-30' }), input({ date: '2026-10-08' }), input({ time: '14:15' }), input({ time: '24:00' }), input({ storeId: 'unknown' }), input({ principalId: 'unknown' }), input({ principalId: 't5' }), input({ requestId: '' }), input({ project: 'x'.repeat(121) })]) rejectUnchanged(m, () => submit(m, data));
  m.state.therapists.find(t => t.id === 't1').active = false;
  rejectUnchanged(m, () => submit(m), /在职|停用/);
  m.state.therapists.find(t => t.id === 't1').active = true; m.state.stores.find(s => s.id === 'a').active = false;
  rejectUnchanged(m, () => submit(m), /门店|停用/);
});

test('omitting a project uses the existing customer plan and cannot override server-owned status or actors', () => {
  const m = ready();
  const row = submit(m, input({ project: undefined, status: 'confirmed', requestedBy: 'boss', appointmentId: 'a1' }));
  assert.equal(row.project, m.state.clients.find(c => c.id === 'c1').goal || m.state.clients.find(c => c.id === 'c1').phase || '康复服务');
  assert.equal(row.status, 'pending'); assert.equal(row.requestedBy, 'c1'); assert.equal(row.appointmentId, undefined);
});

test('a duplicate submit returns its original request without logging twice and a changed payload is rejected', () => {
  const m = ready(), row = submit(m), before = snapshot(m);
  assert.deepEqual(submit(m), row); assert.equal(snapshot(m), before);
  for (const change of [{ date: '2026-10-13' }, { time: '15:00' }, { project: '阶段复评' }, { storeId: 'b', principalId: 't2' }]) rejectUnchanged(m, () => submit(m, input(change)), /提交|内容|变化/);
  const other = submit(m, input({ principalId: 't5' }), { type: 'customer', id: 'c5' });
  assert.notEqual(other.id, row.id); assert.equal(other.clientId, 'c5');
});

test('pending requests do not claim real availability and can be submitted for a slot that staff must recheck', () => {
  const m = ready();
  m.saveAppointment({ clientId: 'c3', storeId: 'a', date: '2026-10-12', time: '14:00', principalId: 't1', project: '康复服务' }, boss);
  const row = submit(m); assert.equal(row.status, 'pending');
  rejectUnchanged(m, () => api('confirmCustomerBooking')(m, row.id, boss), /冲突/);
  assert.equal(m.state.bookingRequests[0].status, 'pending');
});

test('the owner confirms through the real appointment model and records the actual actor without charging', () => {
  const m = ready(), row = submit(m), before = finance(m), count = m.state.appointments.length;
  const confirmed = api('confirmCustomerBooking')(m, row.id, owner);
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.confirmedBy, 't1'); assert.equal(confirmed.confirmedRole, 'therapist');
  assert.equal(confirmed.confirmedAt, '2026-10-09T04:00:00.000Z'); assert.ok(confirmed.appointmentId);
  assert.equal(m.state.appointments.length, count + 1);
  const appointment = m.state.appointments.find(a => a.id === confirmed.appointmentId);
  assert.deepEqual([appointment.clientId, appointment.date, appointment.time, appointment.storeId, appointment.principalId, appointment.status], ['c1', '2026-10-12', '14:30', 'a', 't1', 'confirmed']);
  assert.equal(finance(m), before);
  assert.equal(m.state.audit.find(a => a.type === 'appointment_saved').actorId, 't1');
  const final = snapshot(m); assert.deepEqual(api('confirmCustomerBooking')(m, row.id, owner), confirmed); assert.equal(snapshot(m), final);
});

test('an authorized front desk confirms using its own identity while foreign managers and participants have no confirmation write right', () => {
  const m = ready(), row = submit(m);
  for (const role of [customer, frontB, managerB, { type: 'therapist', id: 't2' }, { type: 'therapist', id: 't5' }, { type: 'boss', id: 'wrong' }]) rejectUnchanged(m, () => api('confirmCustomerBooking')(m, row.id, role), /权限|负责|本人|门店|老板|只读/);
  const confirmed = api('confirmCustomerBooking')(m, row.id, frontA);
  assert.equal(confirmed.confirmedBy, 'f1'); assert.equal(confirmed.confirmedRole, 'frontdesk');
  assert.equal(m.state.audit.find(a => a.type === 'appointment_saved').actorId, 'f1');
});

test('cross-store front desk confirmation keeps the real existing client visibility boundary', () => {
  const m = ready();
  confirmTestShift(m, { therapistId: 't1', storeId: 'b', date: '2026-10-12' });
  // This customer has no B-store history. A pending request does not grant the
  // B-store front desk new authority over the customer's shared archive.
  const row = submit(m, input({ storeId: 'b' }), { type: 'customer', id: 'c3' });
  assert.equal(api('customerBookingRows')(m, frontB).length, 1);
  rejectUnchanged(m, () => api('confirmCustomerBooking')(m, row.id, frontB), /客户.*权限|权限/);
  const confirmed = api('confirmCustomerBooking')(m, row.id, boss);
  assert.equal(confirmed.confirmedRole, 'boss'); assert.equal(confirmed.confirmedBy, 'boss');
});

test('confirmation revalidates active personnel, active stores and date instead of trusting the earlier request', () => {
  for (const mutate of [m => { m.state.therapists.find(t => t.id === 't1').active = false; }, m => { m.state.stores.find(s => s.id === 'a').active = false; }, m => { m.today = '2026-10-13'; }]) {
    const m = ready(), row = submit(m); mutate(m);
    rejectUnchanged(m, () => api('confirmCustomerBooking')(m, row.id, boss));
    assert.equal(m.state.bookingRequests[0].status, 'pending');
  }
});

test('only the customer can cancel their pending request and retrying submission cannot revive it', () => {
  const m = ready(), row = submit(m), before = finance(m);
  for (const role of [boss, owner, frontA, managerA, { type: 'customer', id: 'c2' }]) rejectUnchanged(m, () => api('cancelCustomerBooking')(m, row.id, role), /本人|自己|权限|客户/);
  const cancelled = api('cancelCustomerBooking')(m, row.id, customer);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.cancelledBy, 'c1'); assert.equal(cancelled.cancelledRole, 'customer');
  assert.equal(cancelled.cancelledAt, '2026-10-09T04:00:00.000Z'); assert.equal(finance(m), before);
  const final = snapshot(m); assert.deepEqual(submit(m), cancelled); assert.equal(snapshot(m), final);
  rejectUnchanged(m, () => api('confirmCustomerBooking')(m, row.id, boss), /取消|待确认|未处理/);
});

test('a confirmed request cannot be cancelled as a pending request or re-created on retry', () => {
  const m = ready(), row = submit(m), confirmed = api('confirmCustomerBooking')(m, row.id, boss);
  rejectUnchanged(m, () => api('cancelCustomerBooking')(m, row.id, customer), /已确认|待确认|未处理/);
  const final = snapshot(m); assert.deepEqual(submit(m), confirmed); assert.equal(snapshot(m), final);
});

test('customer and staff request readers preserve client or assigned-store visibility without internal payload keys', () => {
  const m = ready(), a = submit(m), b = submit(m, input({ storeId: 'b', principalId: 't2', requestId: 'second-request' }));
  submit(m, input({ principalId: 't5', requestId: 'other-customer-request' }), { type: 'customer', id: 'c5' });
  const rows = role => api('customerBookingRows')(m, role);
  assert.deepEqual(rows(customer).map(r => r.id), [a.id, b.id]);
  assert.equal(rows({ type: 'customer', id: 'c5' }).length, 1);
  assert.deepEqual(rows(frontB).map(r => r.id), [b.id]);
  assert.deepEqual(rows(managerB).map(r => r.id), [b.id]);
  assert.equal(rows(frontA).length, 2); assert.equal(rows(managerA).length, 2);
  assert.deepEqual(rows(owner).map(r => r.id), [a.id, b.id]);
  assert.deepEqual(rows({ type: 'therapist', id: 't2' }).map(r => r.id), [a.id, b.id], '有效服务参与人员可读取申请，但确认权限仍仅属于负责康复师');
  assert.equal(rows(boss).length, 3);
  for (const row of rows(customer)) { assert.ok(!Object.hasOwn(row, 'inputKey')); assert.ok(!Object.hasOwn(row, 'requestId')); }
  rows(customer)[0].status = 'cancelled'; assert.equal(m.state.bookingRequests[0].status, 'pending', '读结果不能修改内部状态');
  for (const role of [{ type: 'customer', id: 'missing' }, { type: 'manager', id: 'missing' }, { type: 'frontdesk', id: 'missing' }, { type: 'therapist', id: 'missing' }, { type: 'boss', id: 'wrong' }, null]) assert.throws(() => rows(role), /权限|客户|停用|不存在|店长|老板|在职/);
});

test('disabled or moved staff lose reader and repeat-confirm access immediately', () => {
  const m = ready(), row = submit(m); api('confirmCustomerBooking')(m, row.id, frontA);
  m.state.frontDesks.find(f => f.id === 'f1').storeIds = ['b'];
  assert.equal(api('customerBookingRows')(m, frontA).length, 0);
  rejectUnchanged(m, () => api('confirmCustomerBooking')(m, row.id, frontA), /权限|门店/);
  m.state.storeManagers.find(f => f.id === 'm1').active = false;
  assert.throws(() => api('customerBookingRows')(m, managerA), /店长|权限/);
});

test('a reconstructed preview retains pending requests without colliding identifiers or altering earlier services', () => {
  const m = ready(), originalServices = structuredClone(m.state.services), first = submit(m);
  const restored = new DemoModel({ today: m.today, now: m.now, state: m.state, sequence: 0 });
  api('ensureCustomerBooking')(restored);
  const second = submit(restored, input({ requestId: 'restored-second', time: '16:00' }));
  assert.notEqual(first.id, second.id); assert.equal(new Set(restored.state.bookingRequests.map(r => r.id)).size, 2);
  assert.deepEqual(restored.state.services, originalServices);
});

test('malformed existing request collections are rejected without silently resetting records', () => {
  const m = model(); m.state.bookingRequests = { bad: true };
  const ensure = api('ensureCustomerBooking');
  const before = snapshot(m); assert.throws(() => ensure(m), /预约|申请|集合|记录/); assert.equal(snapshot(m), before);
});

test('reopening the same request binds its new submit key without another appointment, audit, charge or sequence', () => {
  const m = ready(), first = submit(m), before = structuredClone(m.state), beforeSequence = m.sequence, beforeFinance = finance(m);
  assert.deepEqual(submit(m, input({ requestId: 'reopened-dialog' })), first);
  assert.equal(m.state.bookingRequests.length, 1);
  assert.deepEqual(m.state.bookingRequests[0].requestAliases, ['reopened-dialog']);
  assert.equal(m.sequence, beforeSequence); assert.equal(finance(m), beforeFinance);
  for (const collection of Object.keys(before).filter(key => key !== 'bookingRequests')) assert.deepEqual(m.state[collection], before[collection]);
  const afterAlias = snapshot(m);
  assert.deepEqual(submit(m, input({ requestId: 'reopened-dialog' })), first);
  assert.equal(snapshot(m), afterAlias, '相同别名重试不能重复保存别名或修改任何记录');
  rejectUnchanged(m, () => submit(m, input({ requestId: 'reopened-dialog', time: '16:00' })), /提交|内容|变化/);
  rejectUnchanged(m, () => submit(m, input({ time: '16:00' })), /提交|内容|变化/);
});

test('an already confirmed real appointment prevents a second request even if it came from another workflow', () => {
  const m = ready();
  m.saveAppointment({ clientId: 'c1', storeId: 'a', date: '2026-10-12', time: '14:30', principalId: 't1', project: '康复服务' }, boss);
  rejectUnchanged(m, () => submit(m), /已有|已安排|已确认|重复/);
  const other = ready(), row = submit(other); api('confirmCustomerBooking')(other, row.id, boss);
  rejectUnchanged(other, () => submit(other, input({ requestId: 'reopened-confirmed' })), /已有|已安排|已确认|重复/);
});

test('a safe confirmation hint hides unavailable actions while preserving cross-store and owner authority', () => {
  const m = ready();
  confirmTestShift(m, { therapistId: 't1', storeId: 'b', date: '2026-10-12' });
  const row = submit(m, input({ storeId: 'b' }), { type: 'customer', id: 'c3' });
  const permission = role => api('customerBookingConfirmation')(m, row.id, role);
  assert.equal(permission(frontB).canConfirm, false); assert.match(permission(frontB).reason, /负责人|老板/);
  assert.equal(permission(owner).canConfirm, true); assert.equal(permission(boss).canConfirm, true);
  assert.equal(permission(managerB).canConfirm, false);
  assert.throws(() => permission(frontA), /权限|门店|查看/);
  api('confirmCustomerBooking')(m, row.id, boss);
  assert.equal(permission(boss).canConfirm, false);
});

test('the customer can request either store with their existing owner without mistaking home store for an available shift', () => {
  const m = ready(), before = finance(m);
  confirmTestShift(m, { therapistId: 't1', storeId: 'b', date: '2026-10-12' });
  assert.equal(m.state.therapists.find(t => t.id === 't1').storeId, 'a');
  const row = submit(m, input({ storeId: 'b', principalId: undefined }));
  assert.equal(row.principalId, 't1'); assert.equal(row.storeId, 'b'); assert.equal(row.status, 'pending');
  assert.equal(row.appointmentId, undefined);
  const confirmed = api('confirmCustomerBooking')(m, row.id, boss);
  const appointment = m.state.appointments.find(a => a.id === confirmed.appointmentId);
  assert.equal(appointment.storeId, 'b'); assert.equal(appointment.principalId, 't1');
  assert.equal(finance(m), before);
});

test('an incomplete old plan still permits a simple request using a neutral service label', () => {
  const m = ready(), client = m.state.clients.find(c => c.id === 'c1');
  client.goal = ''; client.phase = '';
  const row = submit(m, input({ project: undefined }));
  assert.equal(row.project, '康复服务'); assert.equal(row.status, 'pending');
});

test('request aliases remain internal and cannot revive a confirmed or cancelled request on retry', () => {
  for (const finish of ['confirmed', 'cancelled']) {
    const m = ready(), first = submit(m);
    const aliasInput = input({ requestId: 'private-alias-key' }); submit(m, aliasInput);
    const ended = finish === 'confirmed' ? api('confirmCustomerBooking')(m, first.id, boss) : api('cancelCustomerBooking')(m, first.id, customer);
    const before = snapshot(m), repeated = submit(m, aliasInput);
    assert.deepEqual(repeated, ended); assert.equal(snapshot(m), before);
    rejectUnchanged(m, () => submit(m, { ...aliasInput, time: '16:00' }), /提交|内容|变化/);
    for (const role of [customer, boss, frontA, managerA, owner]) {
      const rows = api('customerBookingRows')(m, role);
      assert.ok(!JSON.stringify(rows).includes('private-alias-key'));
      assert.ok(rows.every(row => !Object.hasOwn(row, 'requestAliases')));
    }
  }
});

test('existing alias validation rejects collisions within each customer without resetting records', () => {
  const ensure = api('ensureCustomerBooking');
  for (const aliases of [['customer-request-1'], ['repeat', 'repeat'], [''], [' padded '], 'not-an-array', null]) {
    const m = ready(); submit(m); m.state.bookingRequests[0].requestAliases = aliases;
    const before = snapshot(m); assert.throws(() => ensure(m), /申请|提交|别名|重复|有效/); assert.equal(snapshot(m), before);
  }
  const m = ready(); submit(m); submit(m, input({ requestId: 'another-original', time: '16:00' }));
  m.state.bookingRequests[0].requestAliases = ['another-original'];
  const before = snapshot(m); assert.throws(() => ensure(m), /重复|提交|别名/); assert.equal(snapshot(m), before);
  const other = ready(); submit(other); submit(other, input({ principalId: 't5', requestId: 'another-client-key' }), { type: 'customer', id: 'c5' });
  other.state.bookingRequests[0].requestAliases = ['another-client-key'];
  assert.doesNotThrow(() => ensure(other), '不同客户的提交标识仍独立，不得互相占用');
});

test('reconstructed preview retains alias-to-payload binding and its original request record', () => {
  const m = ready(), row = submit(m), aliasInput = input({ requestId: 'restored-alias' }); submit(m, aliasInput);
  const restored = new DemoModel({ today: m.today, now: m.now, state: m.state, sequence: 0 });
  api('ensureCustomerBooking')(restored);
  const before = snapshot(restored);
  assert.deepEqual(submit(restored, aliasInput), row); assert.equal(snapshot(restored), before);
  rejectUnchanged(restored, () => submit(restored, { ...aliasInput, time: '16:00' }), /提交|内容|变化/);
});
