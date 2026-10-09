import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import { confirmedTestSchedules } from './scheduling-test-fixture.mjs';

const daily = await import('./daily-operations.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const boss = { type: 'boss', id: 'boss' };
const managerA = { type: 'manager', id: 'm1' };
const managerB = { type: 'manager', id: 'm2' };
const frontA = { type: 'frontdesk', id: 'f1' };
const frontB = { type: 'frontdesk', id: 'f2' };
const model = () => confirmedTestSchedules(ensureStorePackageExamples(new DemoModel({ now: () => '2026-10-08T12:00:00.000Z' })));
const summary = (m, role = boss, options = {}) => {
  assert.equal(typeof daily.dailyOperationsSummary, 'function', '缺少每日店务汇总 API');
  return daily.dailyOperationsSummary(m, role, options);
};
const serial = m => JSON.stringify({ state: m.state, sequence: m.sequence });
const photo = () => ({ id: 'daily-photo', name: '服务留底.png', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' });
const receipt = (m, extra = {}, role = boss) => m.recordReceipt({ clientId: 'c1', storeId: 'a', date: m.today, time: '09:00', purpose: 'package', method: 'wechat', amount: '1000', requestId: 'daily-receipt', ...extra }, role);
const book = (m, extra = {}) => m.saveAppointment({ clientId: 'c5', storeId: 'a', date: m.today, time: '10:00', principalId: 't5', project: '基础训练', ...extra }, boss);
const arrive = (m, id, stamp, role) => { m.now = () => stamp; return m.recordArrival(id, { requestId: `arrival-${id}`, notes: '实际到店' }, role); };
const intake = (m, extra = {}, role = frontA) => m.createReceptionClient({ name: '新建档客户', phone: '13910000101', age: '35', problem: '首次到店登记', storeId: 'a', ownerId: 't1', requestId: 'daily-new-client', ...extra }, role);

test('daily operations defaults to today and keeps seeded service performance separate from actual cash', () => {
  const m = model(), before = serial(m), view = summary(m);
  assert.equal(view.from, '2026-10-08'); assert.equal(view.to, '2026-10-08'); assert.equal(view.date, '2026-10-08');
  assert.equal(view.dayCount, 1); assert.equal(view.receptionScope, 'store-day-deduplicated');
  assert.deepEqual(view.storeIds, ['a', 'b']);
  assert.equal(view.income.net, 0); assert.equal(view.serviceCount, 1); assert.equal(view.consumedSessions, 1);
  assert.equal(view.receptionCount, 0); assert.equal(view.newClientCount, 0);
  assert.deepEqual(view.serviceIds, ['s1']);
  assert.equal(view.stores.find(row => row.storeId === 'a').serviceCount, 0);
  assert.equal(view.stores.find(row => row.storeId === 'b').serviceCount, 1);
  assert.equal(serial(m), before, '汇总不能初始化、补写记录或修改业务编号');
});

test('actual cash uses valid receipts minus refunds with one platform settlement and safe record ID traces', () => {
  const m = model(), direct = receipt(m, { amount: '1000.25' });
  const pending = receipt(m, { clientId: 'c2', storeId: 'b', channel: 'douyin', reference: 'DY-daily', method: 'bank', settlementStatus: 'pending', amount: '500', requestId: 'daily-pending' });
  const unrelatedPending = receipt(m, { clientId: 'c2', storeId: 'b', channel: 'meituan', reference: 'MT-daily', method: 'bank', settlementStatus: 'pending', amount: '300', requestId: 'daily-mt-pending' });
  const settlement = m.settleReceipt(pending.id, { date: m.today, time: '11:00', amount: '450.10', reference: 'DY-daily-paid', requestId: 'daily-settle' }, boss);
  const refund = m.refundReceipt({ receiptId: direct.id, date: m.today, time: '12:00', amount: '100.20', reason: '已实际退款', requestId: 'daily-refund' }, boss);
  const voided = receipt(m, { amount: '5', requestId: 'daily-void' }); m.voidReceipt(voided.id, '误录收款', boss);
  const view = summary(m);
  assert.equal(view.income.receivedMinor, 145035); assert.equal(view.income.refundedMinor, 10020);
  assert.equal(view.income.netMinor, 135015); assert.equal(view.income.net, 1350.15);
  assert.equal(view.income.pendingMinor, 30000);
  assert.deepEqual(view.income.receiptIds.sort(), [direct.id, settlement.id].sort());
  assert.deepEqual(view.income.refundIds, [refund.id]); assert.deepEqual(view.income.pendingReceiptIds, [unrelatedPending.id]);
  assert.equal(view.stores.find(row => row.storeId === 'a').income.netMinor, 90005);
  assert.equal(view.stores.find(row => row.storeId === 'b').income.netMinor, 45010);
  assert.equal('receipts' in view.income, false); assert.equal('channels' in view.income, false);
});

test('completed package and single services count separately from sessions with no duplicated collaboration credit', () => {
  const m = model();
  const pack = m.registerService({ clientId: 'c3', storeId: 'a', date: m.today, time: '09:00', project: '训练', principalId: 't1', participantIds: ['t2', 't3', 't2', 't1'], notes: '实际完成', evidencePhotos: [photo()], requestId: 'daily-package-service' }, boss);
  const singleReceipt = receipt(m, { clientId: 'c6', purpose: 'single', method: 'cash', amount: '400', requestId: 'daily-single-cash' });
  const single = m.registerService({ clientId: 'c6', storeId: 'a', date: m.today, time: '11:00', project: '单次训练', principalId: 't5', participantIds: [], notes: '单次已完成', evidencePhotos: [photo()], billingMode: 'single', receiptId: singleReceipt.id, requestId: 'daily-single-service' }, boss);
  const view = summary(m);
  assert.equal(view.serviceCount, 3); assert.equal(view.consumedSessions, 2);
  const by = id => view.therapists.find(row => row.therapistId === id);
  assert.equal(by('t1').serviceCount, 1); assert.equal(by('t1').collaborationCount, 1);
  assert.equal(by('t2').serviceCount, 1); assert.equal(by('t2').collaborationCount, 1);
  assert.equal(by('t3').serviceCount, 0); assert.equal(by('t3').collaborationCount, 2);
  assert.equal(by('t5').serviceCount, 1); assert.deepEqual(by('t5').serviceIds, [single.id]);
  assert.deepEqual(by('t2').collaborationServiceIds, [pack.id]);
  assert.equal(view.income.net, 400, '套餐服务业绩不能再计入已到账收入');
  assert.equal(summary(m, boss, { therapistId: 't1' }).serviceCount, 3, '人员筛选不能改写门店总工作量');
  m.revokeService(pack.id, '误录服务，保留退款流程独立', boss);
  const after = summary(m);
  assert.equal(after.serviceCount, 2); assert.equal(after.consumedSessions, 1); assert.equal(after.income.net, 400);
  assert.equal(after.serviceIds.includes(pack.id), false);
});

test('actual receptionist arrivals deduplicate each customer in each store and credit only the earliest receptionist', () => {
  const m = model(), third = m.addFrontDesk({ name: '麦岛晚班前台', storeIds: ['a'] }, boss), frontThird = { type: 'frontdesk', id: third.id };
  const repeated = book(m, { clientId: 'c3', principalId: 't1', time: '17:00' });
  const other = book(m); const ownerArrival = book(m, { clientId: 'c6', principalId: 't5', time: '12:00' });
  arrive(m, 'a3', '2026-10-08T01:00:00.000Z', frontA);
  arrive(m, repeated.id, '2026-10-08T06:00:00.000Z', frontThird);
  arrive(m, other.id, '2026-10-08T02:00:00.000Z', frontThird);
  arrive(m, ownerArrival.id, '2026-10-08T03:00:00.000Z', boss);
  arrive(m, 'a2', '2026-10-08T02:30:00.000Z', frontB);
  const before = serial(m), view = summary(m);
  assert.equal(view.receptionCount, 4);
  assert.equal(view.frontDesks.find(row => row.frontDeskId === 'f1').receptionCount, 1);
  assert.equal(view.frontDesks.find(row => row.frontDeskId === third.id).receptionCount, 1, '同客当天后一次签到不能算到另一个前台');
  assert.equal(view.frontDesks.find(row => row.frontDeskId === 'f2').receptionCount, 1);
  assert.equal(view.unassignedReception.receptionCount, 1);
  assert.deepEqual(view.unassignedReception.appointmentIds, [ownerArrival.id]);
  assert.equal(view.stores.find(row => row.storeId === 'a').receptionCount, 3);
  assert.equal(view.stores.find(row => row.storeId === 'b').receptionCount, 1);
  assert.equal(serial(m), before);
});

test('Shanghai arrival day controls counts independently of appointment day and ranges count distinct store days', () => {
  const m = model();
  arrive(m, 'a3', '2026-10-08T15:59:00.000Z', frontA);
  const tomorrow = book(m, { clientId: 'c3', principalId: 't1', date: '2026-10-09', time: '09:00' });
  m.today = '2026-10-09';
  arrive(m, tomorrow.id, '2026-10-08T16:01:00.000Z', frontA);
  // The stored appointment date can be corrected later; the real arrival remains on its Shanghai business day.
  m.state.appointments.find(row => row.id === tomorrow.id).date = '2026-10-08';
  assert.equal(summary(m, boss, { date: '2026-10-08' }).receptionCount, 1);
  assert.equal(summary(m, boss, { date: '2026-10-09' }).receptionCount, 1);
  const range = summary(m, boss, { from: '2026-10-08', to: '2026-10-09' });
  assert.equal(range.receptionCount, 2); assert.equal(range.frontDesks.find(row => row.frontDeskId === 'f1').receptionCount, 2);
  assert.equal(range.dayCount, 2); assert.equal(range.date, '');
  assert.equal(summary(m, boss, { from: '2026-10-08' }).dayCount, 1);
  assert.equal(summary(m, boss, { to: '2026-10-08' }).date, '2026-10-08');
});

test('a same-day customer received by both stores counts once in each store without exposing it as a unique all-store person', () => {
  const m = model(); m.assignStoreTherapist({ clientId: 'c3', storeId: 'b', therapistId: 't2', reason: '安排本店评估' }, boss);
  const otherStore = book(m, { clientId: 'c3', storeId: 'b', principalId: 't2', time: '17:00' });
  arrive(m, 'a3', '2026-10-08T01:00:00.000Z', frontA);
  arrive(m, otherStore.id, '2026-10-08T07:00:00.000Z', frontB);
  const view = summary(m);
  assert.equal(view.receptionCount, 2); assert.equal(view.receptionScope, 'store-day-deduplicated');
  assert.deepEqual(view.stores.map(row => row.receptionCount), [1, 1]);
});

test('new client files have separate per-front-desk counts and old archive migration never inflates new clients or arrivals', () => {
  const m = model(); m.now = () => '2026-10-08T01:00:00.000Z';
  const first = intake(m); assert.equal(intake(m).id, first.id);
  const other = intake(m, { phone: '13910000102', storeId: 'b', ownerId: 't2', requestId: 'boss-new-client' }, boss);
  const imported = m.importOpening({ name: '历史客户', phone: '13910000103', ownerId: 't1', storeId: 'a', amount: '3000', total: '10', remaining: '8', notes: '核对纸质期初档案' }, boss);
  m.now = () => '2026-10-08T16:01:00.000Z';
  const next = intake(m, { phone: '13910000104', requestId: 'tomorrow-new-client' });
  const view = summary(m);
  assert.equal(view.newClientCount, 2); assert.deepEqual(view.newClientIds.sort(), [first.id, other.id].sort());
  assert.equal(view.newClientIds.includes(imported.id), false); assert.equal(view.newClientIds.includes(next.id), false);
  assert.equal(view.frontDesks.find(row => row.frontDeskId === 'f1').newClientCount, 1);
  assert.deepEqual(view.frontDesks.find(row => row.frontDeskId === 'f1').newClientIds, [first.id]);
  assert.equal(view.receptionCount, 0, '建档不能推断已到店接待');
  assert.equal(summary(m, boss, { from: '2026-10-08', to: '2026-10-09' }).newClientCount, 3);
});

test('true boss and active local manager identities are required and store claims cannot expose another store', () => {
  const m = model(); receipt(m);
  for (const role of [null, { type: 'boss', id: 'forged' }, frontA, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, { type: 'manager', id: 'missing' }]) {
    assert.throws(() => summary(m, role), /权限|老板|店长|在职/);
  }
  const a = summary(m, { ...managerA, storeId: 'b', storeIds: ['b'] });
  assert.equal(a.storeId, 'a'); assert.deepEqual(a.storeIds, ['a']); assert.equal(a.income.net, 1000);
  assert.equal(a.serviceCount, 0); assert.equal(summary(m, managerB).serviceCount, 1);
  assert.throws(() => summary(m, managerA, { storeId: 'b' }), /权限|本店|门店/);
  assert.throws(() => summary(m, boss, { storeId: 'missing' }), /门店/);
  m.state.storeManagers.find(row => row.id === 'm1').active = false;
  assert.throws(() => summary(m, managerA), /权限|店长|在职/);
});

test('invalid calendar ranges are rejected while empty daily records return explicit zeros', () => {
  const m = model();
  for (const options of [{ date: '2026-02-30' }, { from: '2026-10-10', to: '2026-10-08' }, { from: 20261008 }, { date: '2026-10-08', from: '2026-10-08' }, { storeId: 123 }]) assert.throws(() => summary(m, boss, options), /日期|期间|门店|同时|选择/);
  const empty = summary(m, boss, { date: '2026-10-06', storeId: 'a' });
  assert.equal(empty.income.netMinor, 0); assert.equal(empty.serviceCount, 0); assert.equal(empty.consumedSessions, 0);
  assert.equal(empty.receptionCount, 0); assert.equal(empty.newClientCount, 0); assert.equal(empty.unassignedReception.receptionCount, 0);
});

test('summary projections are detached and never expose customer ratings, photos or replay and ledger internals', () => {
  const m = model(); m.submitReview('s1', { score: 1, feedback: '仅老板查看的私密评价', wantContact: true }, { type: 'customer', id: 'c1' });
  receipt(m); intake(m);
  const before = serial(m), view = summary(m);
  view.income.receiptIds.push('forged'); view.frontDesks[0].name = '篡改'; view.stores[0].name = '篡改门店';
  assert.equal(serial(m), before);
  const safe = JSON.stringify(summary(m, managerA));
  for (const privateValue of ['仅老板查看的私密评价', 'feedback', 'score', 'phone', 'inputKey', 'requestId', 'ledgerFingerprint', 'evidencePhotos', 'receptionInputKey']) assert.equal(safe.includes(privateValue), false, `${privateValue} 不应进入汇总`);
});

test('historical arrivals remain attributable after a receptionist is disabled while later sign-ins cannot claim a boss-first visit', () => {
  const m = model(), repeated = book(m, { clientId: 'c3', principalId: 't1', time: '17:00' });
  arrive(m, 'a3', '2026-10-08T01:00:00.000Z', frontA);
  m.deactivateFrontDesk('f1', boss);
  assert.equal(summary(m).frontDesks.find(row => row.frontDeskId === 'f1').receptionCount, 1, '已停用账号的真实历史接待不能被抹掉');
  const loaded = new DemoModel({ state: m.state, now: () => '2026-10-08T12:00:00.000Z' });
  assert.equal(summary(loaded).receptionCount, 1);
  delete m.state.appointments.find(row => row.id === 'a3').arrivalAt;
  arrive(m, 'a3', '2026-10-08T01:00:00.000Z', boss);
  m.state.frontDesks.find(row => row.id === 'f1').active = true;
  arrive(m, repeated.id, '2026-10-08T02:00:00.000Z', frontA);
  const view = summary(m);
  assert.equal(view.receptionCount, 1); assert.equal(view.frontDesks.find(row => row.frontDeskId === 'f1').receptionCount, 0);
  assert.equal(view.unassignedReception.receptionCount, 1);
});

test('an exact earliest timestamp shared by different receptionists stays unassigned instead of guessing a performance owner', () => {
  const m = model(), third = m.addFrontDesk({ name: '麦岛晚班前台', storeIds: ['a'] }, boss);
  const repeated = book(m, { clientId: 'c3', principalId: 't1', time: '17:00' });
  arrive(m, 'a3', '2026-10-08T01:00:00.000Z', frontA);
  arrive(m, repeated.id, '2026-10-08T01:00:00.000Z', { type: 'frontdesk', id: third.id });
  const view = summary(m);
  assert.equal(view.receptionCount, 1); assert.equal(view.unassignedReception.receptionCount, 1);
  assert.equal(view.frontDesks.reduce((sum, person) => sum + person.receptionCount, 0), 0);
});
