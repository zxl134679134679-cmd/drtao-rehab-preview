import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './core.js';

const boss = { type: 'boss', id: 'boss' };
const frontA = { type: 'frontdesk', id: 'f1' };
const managerA = { type: 'manager', id: 'm1' };
const managerB = { type: 'manager', id: 'm2' };
const now = () => '2026-10-08T12:00:00.000Z';
const model = () => ensureStorePackageExamples(new DemoModel({ now }));
const intake = (extra = {}) => ({ name: '新到店客户', phone: '13910000001', age: '35', problem: '运动后不适，希望安排首次评估', storeId: 'a', ownerId: 't1', requestId: 'read-only-intake', ...extra });
const unchanged = (m, run) => {
  const before = structuredClone(m.state), sequence = m.sequence;
  assert.throws(run, /权限|监管|只读|老板|仅|查看/);
  assert.deepEqual(m.state, before, '店长拒绝操作后不能改变业务或审计记录');
  assert.equal(m.sequence, sequence, '店长拒绝操作后不能消耗记录编号');
};
function balancedClosing(m) {
  m.recordReceipt({ clientId: 'c3', storeId: 'a', date: m.today, time: '09:00', purpose: 'single', method: 'cash', amount: '100', requestId: 'readonly-cash' }, frontA);
  return m.saveCashClosing({ storeId: 'a', date: m.today, actualWechat: '0', actualAlipay: '0', actualCash: '100', actualBank: '0', notes: '已核对实际账单', version: 0, requestId: 'readonly-closing' }, frontA);
}

test('store managers cannot create local or foreign customer files even with a spoofed store claim', () => {
  const m = model();
  for (const role of [managerA, managerB, { ...managerA, storeId: 'b', storeIds: ['a', 'b'] }]) {
    unchanged(m, () => m.createReceptionClient(intake(), role));
    unchanged(m, () => m.createReceptionClient(intake({ storeId: 'b', ownerId: 't2' }), role));
  }
  const local = m.createReceptionClient(intake(), frontA);
  const other = m.createReceptionClient(intake({ phone: '13910000002', storeId: 'b', ownerId: 't2', requestId: 'boss-local-intake' }), boss);
  assert.equal(m.managerSnapshot(managerA).clients.some(row => row.id === local.id), true);
  assert.equal(m.managerSnapshot(managerA).clients.some(row => row.id === other.id), false);
  assert.equal(m.managerSnapshot(managerB).clients.some(row => row.id === other.id), true);
});

test('only the actual boss can confirm a balanced closing while managers retain scoped read access', () => {
  const m = model(), saved = balancedClosing(m);
  for (const role of [managerA, managerB, { ...managerA, storeId: 'b' }, { type: 'boss', id: 'm1' }]) {
    unchanged(m, () => m.confirmCashClosing(saved.id, { version: 1, requestId: 'readonly-confirm' }, role));
  }
  assert.equal(m.cashClosingSummary(managerA, { storeId: 'a', date: m.today }).status, 'submitted');
  unchanged(m, () => m.cashClosingSummary(managerB, { storeId: 'a', date: m.today }));
  assert.equal(m.confirmCashClosing(saved.id, { version: 1, requestId: 'boss-confirm' }, boss).status, 'confirmed');
  assert.equal(m.cashClosingSummary(managerA, { storeId: 'a', date: m.today }).status, 'confirmed');
});

test('loading an old manager-created file preserves provenance but does not authorize manager submit replay', () => {
  const m = model(), client = m.createReceptionClient(intake(), boss);
  Object.assign(client, { createdBy: 'm1', createdRole: 'manager' });
  const loaded = new DemoModel({ state: m.state, now });
  assert.equal(loaded.managerSnapshot(managerA).clients.some(row => row.id === client.id), true);
  assert.equal(loaded.state.clients.find(row => row.id === client.id).createdRole, 'manager');
  unchanged(loaded, () => loaded.createReceptionClient(intake(), managerA));
});

test('old manager-confirmed closing history remains readable but confirmation replay cannot bypass read-only permissions', () => {
  const m = model(), saved = balancedClosing(m);
  m.confirmCashClosing(saved.id, { version: 1, requestId: 'legacy-confirm' }, boss);
  Object.assign(m.state.cashClosings.find(row => row.id === saved.id), { confirmedBy: 'm1', confirmedRole: 'manager' });
  const loaded = new DemoModel({ state: m.state, now });
  const view = loaded.cashClosingSummary(managerA, { storeId: 'a', date: loaded.today });
  assert.equal(view.status, 'confirmed');
  assert.equal(view.record.confirmedBy, 'm1');
  unchanged(loaded, () => loaded.confirmCashClosing(saved.id, { version: 1, requestId: 'legacy-confirm' }, managerA));
  assert.equal(loaded.state.cashClosings[0].confirmedRole, 'manager');
});

test('manager finance and reception supervision remains local and safe to inspect without modifying source records', () => {
  const m = model(); balancedClosing(m);
  m.recordReceipt({ clientId: 'c2', storeId: 'b', date: m.today, time: '09:30', purpose: 'single', method: 'cash', amount: '200', requestId: 'other-store-income' }, boss);
  const before = structuredClone(m.state), sequence = m.sequence;
  assert.deepEqual(m.receptionStoreIds({ ...managerA, storeId: 'b' }), ['a']);
  assert.equal(m.findReceptionDuplicates('13800000003', managerA).clients[0].id, 'c3');
  assert.deepEqual(m.findReceptionDuplicates('13800000002', managerA), { duplicate: true, clients: [] });
  assert.deepEqual(m.cashClosingRows(managerA, { date: m.today }).map(row => row.storeId), ['a']);
  assert.equal(m.cashClosingSummary(managerA, { storeId: 'a', date: m.today }).expected.cash, 100);
  assert.equal(m.cashClosingSummary(managerB, { storeId: 'b', date: m.today }).expected.cash, 200);
  const finance = m.packageFinance('p7', managerA); finance.remaining = -100;
  const snapshot = m.managerSnapshot(managerA); snapshot.clients[0].name = '不能写回';
  const closing = m.cashClosingSummary(managerA, { storeId: 'a', date: m.today }); closing.record.actual.cash = 999;
  assert.deepEqual(m.state, before); assert.equal(m.sequence, sequence);
});

test('newer workflow management operations also remain unavailable to a read-only store manager', () => {
  const m = model(), receipt = m.recordReceipt({ clientId: 'c1', storeId: 'a', date: m.today, time: '09:00', purpose: 'package', method: 'wechat', amount: '3000', requestId: 'newer-write-receipt' }, boss);
  const cancel = m.requestAppointmentCancellation('a3', { reason: '行程调整' }, { type: 'customer', id: 'c3' });
  assert.equal(cancel.cancellationRequest.status, 'pending');
  const entries = [
    () => m.assignStoreTherapist({ clientId: 'c3', storeId: 'a', therapistId: 't3', reason: '调整执行人员' }, managerA),
    () => m.linkReceiptPackage({ receiptId: receipt.id, packageId: 'p7', reason: '核对套餐收款', requestId: 'manager-link' }, managerA),
    () => m.createStorePackage({ clientId: 'c3', storeId: 'a', name: '本店套餐', amount: '3000', total: '10', requestId: 'manager-package' }, managerA),
    () => m.updateTask('task1', { assigneeId: 't1', dueDate: '2026-10-10', reason: '调整日期' }, managerA),
    () => m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '客户要求取消' }, managerA),
    () => m.saveCashClosing({ storeId: 'a', date: m.today, actualWechat: '3000', actualAlipay: '0', actualCash: '0', actualBank: '0', version: 0, requestId: 'manager-closing' }, managerA),
  ];
  entries.forEach(run => unchanged(m, run));
});
