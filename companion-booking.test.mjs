import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';

const boss = { type: 'boss', id: 'boss' };
const frontA = { type: 'frontdesk', id: 'f1' };
const now = () => '2026-10-09T04:00:00.000Z';
const clone = value => structuredClone(value);
const model = () => new DemoModel({ now });
const input = (extra = {}) => ({
  storeId: 'a', date: '2026-10-12', time: '14:00', project: '基础训练',
  items: [{ clientId: 'c1', principalId: 't1' }, { clientId: 'c5', principalId: 't5' }],
  requestId: 'companion-request-1', ...extra,
});
function api(m) {
  assert.equal(typeof m.saveAppointmentBatch, 'function', '尚未实现多人同到店的批量预约 API');
  return m.saveAppointmentBatch.bind(m);
}
const snapshot = m => JSON.stringify({ state: m.state, sequence: m.sequence });
function finances(m) {
  return JSON.stringify({
    packages: m.state.packages, services: m.state.services,
    receipts: m.state.receipts, refunds: m.state.refunds,
    remaining: m.state.clients.map(c => [c.id, m.remaining(c.id)]),
    performance: m.state.therapists.map(t => [t.id, m.performance(t.id)]),
  });
}
function rejectsWithoutMutation(m, save, data, role = boss) {
  const before = snapshot(m);
  assert.throws(() => save(data, role));
  assert.equal(snapshot(m), before, '整组失败后不能残留预约、待办、审计、幂等记录或消耗序列');
}

test('three companions receive independent appointments sharing one arrival group without consuming packages or money', () => {
  const m = model(), save = api(m), before = finances(m);
  const rows = save(input({ items: [
    { clientId: 'c1', principalId: 't1' },
    { clientId: 'c5', principalId: 't5' },
    { clientId: 'c4', principalId: 't4' },
  ] }), boss);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map(r => r.id)).size, 3);
  assert.equal(new Set(rows.map(r => r.groupId)).size, 1);
  assert.ok(rows[0].groupId);
  assert.deepEqual(rows.map(r => [r.clientId, r.principalId, r.storeId, r.date, r.time, r.status]), [
    ['c1', 't1', 'a', '2026-10-12', '14:00', 'confirmed'],
    ['c5', 't5', 'a', '2026-10-12', '14:00', 'confirmed'],
    ['c4', 't4', 'a', '2026-10-12', '14:00', 'confirmed'],
  ]);
  assert.equal(m.state.appointments.length, 7);
  assert.equal(m.state.appointmentBatches.length, 1);
  for (const row of rows) {
    assert.ok(m.state.appointments.some(a => a.id === row.id));
    for (const other of rows.filter(r => r.id !== row.id)) {
      assert.ok(!JSON.stringify(row).includes(other.clientId), '单条预约不能携带同组其他客户资料');
      assert.ok(!JSON.stringify(row).includes(other.principalId), '单条预约不能携带其他人的康复师分配');
    }
    assert.ok(!Object.hasOwn(row, 'items'));
    assert.ok(!Object.hasOwn(row, 'inputKey'));
  }
  assert.equal(finances(m), before);
});

test('front desk and therapist retain their existing client scope when creating a simultaneous group', () => {
  const desk = model();
  assert.equal(api(desk)(input(), frontA).length, 2);
  const therapist = model();
  const rows = api(therapist)(input({ items: [
    { clientId: 'c1', principalId: 't2' },
    { clientId: 'c3', principalId: 't1' },
  ] }), { type: 'therapist', id: 't1' });
  assert.deepEqual(rows.map(r => r.principalId), ['t2', 't1']);
});

test('repeated submit returns the original group and cannot alter it with changed input', () => {
  const m = model(), save = api(m), data = input();
  const first = save(data, frontA), before = snapshot(m);
  const repeated = save(clone(data), frontA);
  assert.deepEqual(repeated.map(r => r.id), first.map(r => r.id));
  assert.equal(snapshot(m), before);
  for (const change of [
    { time: '15:00' }, { date: '2026-10-13' }, { project: '阶段复评' },
    { items: [data.items[1], data.items[0]] },
  ]) rejectsWithoutMutation(m, save, { ...data, ...change }, frontA);
  m.cancelAppointment(first[0].id, '该客户临时取消', frontA);
  m.saveAppointment({ ...first[1], date: '2026-10-13', time: '16:00' }, frontA);
  const afterCancel = snapshot(m);
  const afterIndividualChanges = save(clone(data), frontA);
  assert.equal(afterIndividualChanges[0].status, 'cancelled');
  assert.equal(afterIndividualChanges[1].date, '2026-10-13');
  assert.equal(afterIndividualChanges[1].time, '16:00');
  assert.equal(snapshot(m), afterCancel, '重试不能重新创建或恢复已经取消的成员预约');
});

test('retrying a previous group cannot bypass newly removed client or store permissions', () => {
  const desk = model(), deskSave = api(desk), data = input();
  deskSave(data, frontA);
  desk.state.frontDesks.find(f => f.id === 'f1').storeIds = ['b'];
  rejectsWithoutMutation(desk, deskSave, clone(data), frontA);
  const therapist = model(), therapistSave = api(therapist);
  const therapistData = input({ items: [
    { clientId: 'c1', principalId: 't2' },
    { clientId: 'c3', principalId: 't1' },
  ] });
  therapistSave(therapistData, { type: 'therapist', id: 't1' });
  therapist.transferClient('c3', 't5', '调整客户负责人', boss);
  rejectsWithoutMutation(therapist, therapistSave, clone(therapistData), { type: 'therapist', id: 't1' });
});

test('a front desk retry cannot expose a member individually moved to another unauthorized store', () => {
  const m = model(), save = api(m), data = input();
  const rows = save(data, frontA);
  m.saveAppointment({ ...rows[1], storeId: 'b', date: '2026-10-13', time: '16:00' }, boss);
  assert.deepEqual(m.frontDeskStoreIds(frontA), ['a']);
  assert.equal(m.canSeeClient(frontA, 'c5'), true, '客户归属仍在 A 店，门店操作权限须另行检查');
  assert.equal(m.state.appointments.find(a => a.id === rows[1].id).storeId, 'b');
  rejectsWithoutMutation(m, save, clone(data), frontA);
});

test('idempotency is scoped by both actor type and actor id', () => {
  const m = model(), save = api(m);
  // Different role types may have the same identifier. Their independently
  // authorized requests must not be mistaken for one another.
  m.state.frontDesks.push({ id: 'boss', name: '标识与老板相同的示例前台', storeIds: ['a'], active: true });
  const first = save(input(), boss);
  const second = save(input({ time: '15:00' }), { type: 'frontdesk', id: 'boss' });
  const third = save(input({ time: '16:00' }), frontA);
  assert.equal(new Set([first[0].groupId, second[0].groupId, third[0].groupId]).size, 3);
  assert.equal(m.state.appointmentBatches.length, 3);
  assert.equal(m.state.appointments.length, 10);
});

test('a failure in a later member leaves no earlier appointment or audit record behind', () => {
  const m = model(), save = api(m);
  for (const items of [
    [{ clientId: 'c1', principalId: 't1' }, { clientId: 'missing', principalId: 't5' }],
    [{ clientId: 'c1', principalId: 't1' }, { clientId: 'c5', principalId: 't4' }],
  ]) rejectsWithoutMutation(m, save, input({ items }));
  m.state.therapists.find(t => t.id === 't5').active = false;
  rejectsWithoutMutation(m, save, input());
});

test('duplicate clients and duplicate therapists cannot create overlapping members in one group', () => {
  const m = model(), save = api(m);
  rejectsWithoutMutation(m, save, input({ items: [
    { clientId: 'c1', principalId: 't1' }, { clientId: 'c1', principalId: 't2' },
  ] }));
  rejectsWithoutMutation(m, save, input({ items: [
    { clientId: 'c1', principalId: 't1' }, { clientId: 'c3', principalId: 't1' },
  ] }));
});

test('customers, forged staff, inactive staff and front desks outside their store or client scope cannot book a group', () => {
  const m = model(), save = api(m);
  for (const role of [
    { type: 'customer', id: 'c1' }, { type: 'boss', id: 't1' },
    { type: 'therapist', id: 'missing' }, { type: 'frontdesk', id: 'missing' },
    { type: 'therapist', id: 't4' }, null,
  ]) rejectsWithoutMutation(m, save, input(), role);
  rejectsWithoutMutation(m, save, input({ storeId: 'b' }), frontA);
  rejectsWithoutMutation(m, save, input({ items: [
    { clientId: 'c1', principalId: 't1' }, { clientId: 'c4', principalId: 't4' },
  ] }), frontA);
  m.state.frontDesks.find(f => f.id === 'f1').active = false;
  rejectsWithoutMutation(m, save, input(), frontA);
  m.state.therapists.find(t => t.id === 't1').active = false;
  rejectsWithoutMutation(m, save, input(), { type: 'therapist', id: 't1' });
});

test('group booking keeps the existing sixty-minute conflict across different stores and allows the exact boundary', () => {
  const m = model(), save = api(m);
  m.saveAppointment({ clientId: 'c5', principalId: 't5', storeId: 'b', date: '2026-10-12', time: '14:30', project: '跨店训练' }, boss);
  rejectsWithoutMutation(m, save, input());
  m.saveAppointment({ clientId: 'c3', principalId: 't1', storeId: 'b', date: '2026-10-13', time: '14:30', project: '跨店训练' }, boss);
  rejectsWithoutMutation(m, save, input({ date: '2026-10-13' }));
  const boundary = model(), boundarySave = api(boundary);
  boundary.saveAppointment({ clientId: 'c5', principalId: 't5', storeId: 'b', date: '2026-10-12', time: '13:00', project: '跨店训练' }, boss);
  assert.equal(boundarySave(input(), boss).length, 2);
});

test('companions can start at a half hour without charging or skipping conflict checks', () => {
  const m = model(), save = api(m), before = finances(m);
  const rows = save(input({time:'14:30'}), frontA);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.time === '14:30'));
  assert.equal(finances(m), before);
  rejectsWithoutMutation(m, save, input({time:'15:00',requestId:'half-hour-conflict'}));
});

test('group bookings require valid whole or half hours, a real date, a project, a request id and at least two members', () => {
  const m = model(), save = api(m);
  for (const change of [
    { time: '14:04' }, { time: '24:00' }, { time: '14点' }, { time: null },
    { date: '2026-02-30' }, { date: '2026-10-07' }, { date: null },
    { project: '' }, { project: 123 }, { requestId: '' }, { requestId: 'r'.repeat(81) },
    { storeId: 'missing' }, { items: [] }, { items: [input().items[0]] }, { items: null },
    { items: [input().items[0], null] },
  ]) rejectsWithoutMutation(m, save, input(change));
  // Existing single-appointment historical minute precision is preserved.
  const single = m.saveAppointment({ clientId: 'c1', principalId: 't1', storeId: 'a', date: '2026-10-14', time: '14:04', project: '单人历史分钟安排' }, boss);
  assert.equal(single.time, '14:04');
});

test('twenty separately assigned clients can book together but a twenty-first client cannot leave a partial group', () => {
  const m = model(), save = api(m), items = [];
  for (let n = 1; n <= 21; n++) {
    const clientId = `group-client-${n}`, principalId = `group-therapist-${n}`;
    m.state.therapists.push({ id: principalId, name: `示例康复师 ${n}`, storeId: 'a', active: true });
    m.state.clients.push({ ...clone(m.state.clients[0]), id: clientId, name: `示例同行客户 ${n}`, ownerId: principalId, storeId: 'a' });
    items.push({ clientId, principalId });
  }
  rejectsWithoutMutation(m, save, input({ items }));
  const rows = save(input({ items: items.slice(0, 20) }), boss);
  assert.equal(rows.length, 20);
  assert.equal(new Set(rows.map(r => r.id)).size, 20);
  assert.equal(new Set(rows.map(r => r.groupId)).size, 1);
  assert.equal(m.state.appointments.length, 24);
});

test('cancel, reschedule, arrival and service completion affect only the selected member and their own package', () => {
  const m = model(), save = api(m);
  const [cancelled, rescheduled, served] = save(input({ date: m.today, time: '16:00', items: [
    { clientId: 'c1', principalId: 't1' },
    { clientId: 'c5', principalId: 't5' },
    { clientId: 'c4', principalId: 't4' },
  ] }), boss);
  const remainingBefore = ['c1', 'c5', 'c4'].map(id => m.remaining(id));
  m.cancelAppointment(cancelled.id, '一位朋友临时取消', boss);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(rescheduled.status, 'confirmed');
  assert.equal(served.status, 'confirmed');
  m.requestReschedule(rescheduled.id, { date: '2026-10-10', time: '15:00', reason: '本人改到周六' }, { type: 'customer', id: 'c5' });
  assert.equal(rescheduled.status, 'reschedule_requested');
  assert.equal(served.status, 'confirmed');
  m.recordArrival(served.id, { requestId: 'individual-arrival', notes: '仅赵清禾到店' }, boss);
  assert.ok(served.arrivalAt);
  assert.ok(!rescheduled.arrivalAt);
  m.saveAppointment({ ...rescheduled, date: '2026-10-10', time: '15:00' }, boss);
  assert.equal(rescheduled.status, 'confirmed');
  const row = m.registerService({
    appointmentId: served.id, clientId: 'c4', principalId: 't4', participantIds: [],
    storeId: 'a', date: m.today, time: '16:00', project: '基础训练', notes: '仅此客户完成本次训练',
    requestId: 'individual-service', evidencePhotos: [{
      id: 'individual-photo', name: '示例留底.png', width: 1, height: 1,
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    }],
  }, boss);
  assert.equal(row.amount, 300);
  assert.equal(served.status, 'completed');
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(rescheduled.status, 'confirmed');
  assert.equal(rescheduled.date, '2026-10-10');
  assert.deepEqual(['c1', 'c5', 'c4'].map(id => m.remaining(id)), [remainingBefore[0], remainingBefore[1], remainingBefore[2] - 1]);
  assert.equal(m.performance('t4'), 300);
  assert.equal(m.performance('t1'), 0);
  assert.equal(m.performance('t5'), 0);
});

test('a clock failure during staged saving cannot commit an earlier member or consume ids', () => {
  let calls = 0, fail = false;
  const m = new DemoModel({ now: () => {
    if (fail && ++calls === 3) throw new Error('测试时钟暂时不可用');
    return '2026-10-09T04:00:00.000Z';
  } });
  const save = api(m);
  fail = true;
  rejectsWithoutMutation(m, save, input({ items: [
    { clientId: 'c1', principalId: 't1' },
    { clientId: 'c5', principalId: 't5' },
    { clientId: 'c4', principalId: 't4' },
  ] }));
});
