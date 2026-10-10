import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './legacy-test-fixture.mjs';

const boss = { type: 'boss', id: 'boss' };
const frontA = { type: 'frontdesk', id: 'f1' };
const frontB = { type: 'frontdesk', id: 'f2' };
const managerA = { type: 'manager', id: 'm1' };
const managerB = { type: 'manager', id: 'm2' };
const model = () => ensureStorePackageExamples(new DemoModel({ now: () => '2026-10-08T12:00:00.000Z' }));
const receipt = (m, extra = {}, role = boss) => m.recordReceipt({ clientId: 'c1', storeId: 'a', date: m.today, time: '09:00', purpose: 'package', method: 'wechat', amount: '3000', requestId: 'receipt-1', ...extra }, role);
const refund = (m, row, extra = {}) => m.refundReceipt({ receiptId: row.id, date: m.today, time: '10:00', amount: '100', reason: '实际已退款', requestId: 'refund-1', ...extra }, boss);
const unchanged = (m, fn, pattern = /权限|套餐|门店|版本|核对|修改|原因|重复|收款|对账|差额|已结束|选择|客户|请求/) => {
  const state = structuredClone(m.state), sequence = m.sequence;
  assert.throws(fn, pattern);
  assert.deepEqual(m.state, state);
  assert.equal(m.sequence, sequence);
};
const close = (m, extra = {}, role = frontA) => m.saveCashClosing({ storeId: 'a', date: m.today, actualWechat: '3000', actualAlipay: '0', actualCash: '0', actualBank: '0', notes: '核对商户账单', version: 0, requestId: 'closing-1', ...extra }, role);

test('manual receipts can link a matching store package without creating money or consuming sessions', () => {
  const m = model(), before = m.packageRemaining('p7');
  const row = receipt(m, { packageId: 'p7' }, frontA);
  assert.equal(row.packageId, 'p7');
  assert.deepEqual(m.packageFinance('p7', boss), { packageId: 'p7', clientId: 'c1', storeId: 'a', amount: 3000, received: 3000, refunded: 0, netReceived: 3000, pending: 0, remaining: before, closed: false, status: 'linked' });
  assert.equal(m.state.services.length, 1);
  assert.equal(m.cashSummary({}, boss).received, 3000);
  assert.equal(receipt(m, { packageId: 'p7' }, frontA).id, row.id);
});

test('package links reject another client, store, unbound, closed, non-package purpose and unauthorized actors atomically', () => {
  const m = model();
  for (const extra of [{ packageId: 'p1' }, { packageId: 'p3' }, { packageId: 'p7', purpose: 'single' }, { packageId: 'p7', clientId: '' }]) unchanged(m, () => receipt(m, extra));
  delete m.state.packages.find(p => p.id === 'p7').storeId;
  unchanged(m, () => receipt(m, { packageId: 'p7' }));
  m.state.packages.find(p => p.id === 'p7').storeId = 'a';
  m.state.packages.find(p => p.id === 'p7').closed = true;
  unchanged(m, () => receipt(m, { packageId: 'p7' }));
  for (const role of [frontB, managerA, { type: 'therapist', id: 't1' }, { type: 'boss', id: 'forged' }]) unchanged(m, () => receipt(m, { packageId: 'p7' }, role));
});

test('ordinary unlinked manual income is retained, old packages never invent opening income', () => {
  const m = model();
  const row = receipt(m);
  assert.equal(row.packageId, undefined);
  assert.equal(m.packageFinance('p7', boss).status, 'opening');
  assert.equal(m.packageFinance('p7', boss).received, 0);
  const fresh = m.createStorePackage({ clientId: 'c1', storeId: 'a', name: '新办卡', amount: '25200', total: '60', requestId: 'new-card' }, boss);
  assert.equal(m.packageFinance(fresh.id, boss).status, 'unlinked');
});

test('boss can associate existing cash with a package; replay is idempotent and different reassignment is denied', () => {
  const m = model(), row = receipt(m);
  const data = { receiptId: row.id, packageId: 'p7', reason: '核对纸质办卡单', requestId: 'link-1' };
  const linked = m.linkReceiptPackage(data, boss), auditLength = m.state.audit.length;
  assert.equal(linked.packageId, 'p7');
  assert.equal(m.linkReceiptPackage(data, boss).id, row.id);
  assert.equal(m.state.audit.length, auditLength);
  assert.equal(m.cashSummary({}, boss).received, 3000);
  unchanged(m, () => m.linkReceiptPackage({ ...data, reason: '内容变更' }, boss));
  unchanged(m, () => m.linkReceiptPackage({ ...data, requestId: 'link-2', packageId: 'p3' }, boss));
  for (const role of [frontA, managerA, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.linkReceiptPackage(data, role));
  assert.equal(m.state.audit[0].type, 'receipt_package_linked');
});

test('platform parent link follows actual settlement child and contributes income once, including post-settlement association', () => {
  const m = model();
  const parent = receipt(m, { packageId: 'p7', channel: 'douyin', settlementStatus: 'pending', method: 'bank', reference: 'DY-001' });
  assert.equal(m.packageFinance('p7', boss).pending, 3000);
  assert.equal(m.packageFinance('p7', boss).received, 0);
  const child = m.settleReceipt(parent.id, { amount: '2900', date: m.today, time: '11:00', reference: 'DY-SET-001', requestId: 'settle-1' }, boss);
  assert.equal(child.packageId, 'p7');
  assert.equal(m.packageFinance('p7', boss).received, 2900);
  assert.equal(m.packageFinance('p7', boss).pending, 0);
  m.voidReceipt(child.id, '到账登记错误', boss);
  assert.equal(m.packageFinance('p7', boss).received, 0);
  assert.equal(m.packageFinance('p7', boss).pending, 3000);
  const unlinked = receipt(m, { requestId: 'receipt-2', channel: 'meituan', settlementStatus: 'pending', method: 'bank', reference: 'MT-001' });
  const child2 = m.settleReceipt(unlinked.id, { amount: '2800', date: m.today, time: '11:00', reference: 'MT-SET-001', requestId: 'settle-2' }, boss);
  m.linkReceiptPackage({ receiptId: unlinked.id, packageId: 'p7', reason: '核对原套餐', requestId: 'link-settled' }, boss);
  assert.equal(m.state.receipts.find(r => r.id === child2.id).packageId, 'p7');
  assert.equal(m.packageFinance('p7', boss).received, 2800);
});

test('package finance read is scoped to actual boss, active local frontdesk and manager, and clone is safe', () => {
  const m = model(); receipt(m, { packageId: 'p7' });
  for (const role of [boss, frontA, managerA]) assert.equal(m.packageFinance('p7', role).received, 3000);
  for (const role of [frontB, managerB, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.packageFinance('p7', role));
  m.state.frontDesks.find(r => r.id === 'f1').active = false;
  unchanged(m, () => m.packageFinance('p7', frontA));
  m.state.storeManagers.find(r => r.id === 'm1').active = false;
  unchanged(m, () => m.packageFinance('p7', managerA));
  const result = m.packageFinance('p7', boss); result.received = 999;
  assert.equal(m.packageFinance('p7', boss).received, 3000);
});

test('linked refund requires explicit keep or close decision and reason; failures do not write cash or package', () => {
  const m = model(), row = receipt(m, { packageId: 'p7' });
  for (const extra of [{}, { packageAction: 'close' }, { packageAction: 'keep', packageReason: '' }, { packageAction: 'anything', packageReason: '核对' }]) unchanged(m, () => refund(m, row, extra));
  const before = m.packageRemaining('p7');
  const r = refund(m, row, { packageAction: 'keep', packageReason: '仅退多收款，次数保留' });
  assert.equal(m.packageRemaining('p7'), before);
  assert.equal(r.packageId, 'p7');
  assert.equal(m.packageFinance('p7', boss).netReceived, 2900);
  assert.equal(refund(m, row, { packageAction: 'keep', packageReason: '仅退多收款，次数保留' }).id, r.id);
});

test('closing a refunded package disables remaining use while preserving original amount, slots, service history and performance', () => {
  const m = model(), pack = m.state.packages.find(p => p.id === 'p1'), row = receipt(m, { storeId: 'b', packageId: 'p1' });
  const original = structuredClone(pack), services = structuredClone(m.state.services), performance = m.performance({});
  const r = refund(m, row, { packageAction: 'close', packageReason: '客户终止剩余服务' });
  assert.equal(m.packageRemaining(pack.id), 0);
  assert.equal(m.remainingInStore('c1', 'b'), 0);
  assert.ok(!m.availablePackages('c1', 'b').some(p => p.id === pack.id));
  for (const key of ['amount', 'amountMinor', 'total', 'openingUsed', 'status']) assert.equal(pack[key], original[key]);
  assert.deepEqual(m.state.services, services);
  assert.deepEqual(m.performance({}), performance);
  assert.equal(m.packageFinance(pack.id, boss).closed, true);
  unchanged(m, () => m.renewPackage({ clientId: 'c1', previousPackageId: pack.id, storeId: 'b', name: '再续', amount: '3000', total: '10', reason: '续费', requestId: 'renew-closed' }, boss));
  unchanged(m, () => m.nextServiceValue(pack.id));
  m.voidRefund(r.id, '客户撤回退款，实际未退', boss);
  assert.equal(m.packageRemaining(pack.id), 9);
  assert.equal(m.packageFinance(pack.id, boss).closed, false);
});

test('voiding an unrelated keep refund cannot reopen a package closed by another refund', () => {
  const m = model(), row = receipt(m, { packageId: 'p7' });
  const keep = refund(m, row, { packageAction: 'keep', packageReason: '退多收款' });
  const ended = refund(m, row, { requestId: 'refund-close', packageAction: 'close', packageReason: '结束服务' });
  m.voidRefund(keep.id, '录错了', boss);
  assert.equal(m.packageRemaining('p7'), 0);
  assert.equal(m.state.packages.find(p => p.id === 'p7').closedByRefundId, ended.id);
  m.state.packages.find(p => p.id === 'p7').closedByRefundId = 'another-closure';
  m.voidRefund(ended.id, '录错了', boss);
  assert.equal(m.packageRemaining('p7'), 0);
});

test('unlinked receipt refunds preserve earlier manual behavior without requiring package action', () => {
  const m = model(), row = receipt(m), r = refund(m, row);
  assert.equal(r.packageId, undefined);
  assert.equal(m.packageRemaining('p7'), 10);
  m.voidRefund(r.id, '核对错误', boss);
  assert.equal(m.cashSummary({}, boss).net, 3000);
});

test('closing summary uses actual net by method and excludes pending or settled platform originals', () => {
  const m = model(), row = receipt(m);
  refund(m, row, { amount: '100.01' });
  receipt(m, { requestId: 'cash-2', method: 'cash', amount: '10.20', purpose: 'single' });
  const pending = receipt(m, { requestId: 'pending', channel: 'douyin', settlementStatus: 'pending', method: 'bank', amount: '999', reference: 'DY-PENDING' });
  const s = m.cashClosingSummary(frontA, { storeId: 'a', date: m.today });
  assert.deepEqual(s.expectedMinor, { wechat: 289999, alipay: 0, cash: 1020, bank: 0 });
  assert.deepEqual(s.expected, { wechat: 2899.99, alipay: 0, cash: 10.2, bank: 0 });
  assert.equal(s.expectedTotalMinor, 291019);
  assert.equal(s.status, 'missing');
  assert.equal(s.record, null);
  m.settleReceipt(pending.id, { amount: '900.10', date: m.today, time: '11:00', reference: 'DY-PENDING-PAID', requestId: 'settle-pending' }, boss);
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).expected.bank, 900.1);
});

test('manual closing permits signed decimal net amounts on refund-only days and never changes ledger', () => {
  const m = model(), row = receipt(m, { date: '2026-10-07', amount: '100.20' });
  refund(m, row, { amount: '100.20' });
  const cashBefore = m.cashSummary({}, boss);
  const saved = close(m, { actualWechat: '-100.20' });
  const s = m.cashClosingSummary(frontA, { storeId: 'a', date: m.today });
  assert.equal(saved.version, 1);
  assert.equal(s.record.actual.wechat, -100.2);
  assert.equal(s.record.differenceTotal, 0);
  assert.deepEqual(m.cashSummary({}, boss), cashBefore);
  m.confirmCashClosing(saved.id, { version: 1, requestId: 'confirm-signed' }, boss);
  assert.equal(m.cashClosingSummary(frontA, { storeId: 'a', date: m.today }).status, 'confirmed');
});

test('same closing submit is idempotent, edits preserve older records, stale versions and changed replay are denied', () => {
  const m = model(); receipt(m);
  const first = close(m), size = m.state.cashClosings.length;
  assert.equal(close(m).id, first.id);
  assert.equal(m.state.cashClosings.length, size);
  unchanged(m, () => close(m, { actualWechat: '2999' }));
  unchanged(m, () => close(m, { version: 0, requestId: 'closing-stale' }));
  const second = close(m, { version: 1, requestId: 'closing-edit', notes: '复核更新' });
  assert.equal(second.version, 2);
  assert.equal(m.state.cashClosings.length, 2);
  assert.equal(m.cashClosingSummary(frontA, { storeId: 'a', date: m.today }).record.id, second.id);
  unchanged(m, () => m.confirmCashClosing(first.id, { version: 1, requestId: 'confirm-old' }, boss));
});

test('confirmation requires the actual boss, exact zero differences and fresh ledger snapshot', () => {
  const m = model(); receipt(m);
  const first = close(m, { actualWechat: '2999', actualCash: '1' });
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).record.differenceTotal, 0);
  unchanged(m, () => m.confirmCashClosing(first.id, { version: 1, requestId: 'confirm-offset' }, boss));
  const current = close(m, { version: 1, requestId: 'closing-correct' });
  for (const role of [frontA, managerA, managerB, { type: 'therapist', id: 't1' }, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.confirmCashClosing(current.id, { version: 2, requestId: 'confirm-denied' }, role));
  const confirmed = m.confirmCashClosing(current.id, { version: 2, requestId: 'confirm-1' }, boss);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(m.confirmCashClosing(current.id, { version: 2, requestId: 'confirm-1' }, boss).id, confirmed.id);
  receipt(m, { requestId: 'after-confirm', amount: '1', purpose: 'single' });
  assert.equal(m.cashClosingSummary(frontA, { storeId: 'a', date: m.today }).status, 'stale');
  unchanged(m, () => m.confirmCashClosing(current.id, { version: 2, requestId: 'confirm-again' }, boss));
});

test('closing read/write permissions enforce scoped identities even on read, replay and inactive records', () => {
  const m = model(); receipt(m); const saved = close(m);
  for (const role of [frontB, managerB, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.cashClosingSummary(role, { storeId: 'a', date: m.today }));
  assert.deepEqual(m.cashClosingRows(frontA, { date: m.today }).map(s => s.storeId), ['a']);
  assert.deepEqual(m.cashClosingRows(managerB, { date: m.today }).map(s => s.storeId), ['b']);
  assert.deepEqual(m.cashClosingRows(boss, { date: m.today }).map(s => s.storeId), ['a', 'b']);
  unchanged(m, () => close(m, {}, managerA));
  m.state.frontDesks.find(r => r.id === 'f1').active = false;
  unchanged(m, () => close(m));
  unchanged(m, () => m.cashClosingRows(frontA, { date: m.today }));
  m.state.storeManagers.find(r => r.id === 'm1').active = false;
  unchanged(m, () => m.confirmCashClosing(saved.id, { version: 1, requestId: 'inactive-confirm' }, managerA));
});

test('ledger refunds, voids and settlements invalidate only the affected day and store closing', () => {
  const m = model(), row = receipt(m); const saved = close(m);
  receipt(m, { requestId: 'other-store', storeId: 'b', clientId: 'c2', amount: '100' });
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).status, 'submitted');
  const r = refund(m, row);
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).status, 'stale');
  m.voidRefund(r.id, '撤销错误记录', boss);
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).status, 'stale');
  assert.ok(m.state.cashClosings.some(record => record.id === saved.id));
});

test('cash closing state validation rejects malformed snapshots, foreign store, duplicate ids and unsafe money', () => {
  const m = model(); receipt(m); close(m);
  assert.doesNotThrow(() => new DemoModel({ state: m.state }));
  for (const edit of [state => state.cashClosings.push(structuredClone(state.cashClosings[0])), state => state.cashClosings[0].storeId = 'foreign', state => state.cashClosings[0].actualMinor.cash = 0.001, state => state.cashClosings[0].version = -1]) {
    const state = structuredClone(m.state); edit(state);
    assert.throws(() => new DemoModel({ state }), /对账|门店|标识|版本|金额|记录/);
  }
});

test('loaded snapshots cannot rewrite expected ledger amounts or hide malformed fingerprint rows', () => {
  const m = model(); receipt(m); close(m);
  for (const edit of [state => state.cashClosings[0].expectedMinor.wechat = 0, state => state.cashClosings[0].ledgerFingerprint = '{invalid}', state => state.cashClosings[0].ledgerFingerprint = JSON.stringify([['receipt','r','2026-10-08','09:00','valid','cash',0.01,'']])]) {
    const state = structuredClone(m.state); edit(state);
    assert.throws(() => new DemoModel({ state }), /对账|快照|金额|记录/);
  }
});

test('overlapping closing refunds restore surviving prior closure and skip revoked prior decisions', () => {
  for (const reverse of [false, true]) {
    const m = model(), row = receipt(m, { packageId: 'p7' });
    const first = refund(m, row, { packageAction: 'close', packageReason: '结束套餐' });
    const second = refund(m, row, { requestId: 'close-second', packageAction: 'close', packageReason: '追加退款，仍结束套餐' });
    assert.doesNotThrow(() => new DemoModel({ state: m.state }));
    m.voidRefund(reverse ? first.id : second.id, '登记错误', boss);
    assert.equal(m.packageRemaining('p7'), 0);
    assert.doesNotThrow(() => new DemoModel({ state: m.state }));
    m.voidRefund(reverse ? second.id : first.id, '登记错误', boss);
    assert.equal(m.packageRemaining('p7'), 10);
    assert.doesNotThrow(() => new DemoModel({ state: m.state }));
  }
});

test('cash closing summaries are detached and never expose replay keys or ledger fingerprints', () => {
  const m = model(); receipt(m); close(m);
  const read = m.cashClosingSummary(boss, { storeId: 'a', date: m.today });
  assert.doesNotMatch(JSON.stringify(read), /ledgerFingerprint|inputKey|requestId|confirmRequestId/);
  read.record.actual.wechat = 0; read.expectedMinor.wechat = 0;
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).record.actual.wechat, 3000);
  assert.equal(m.cashClosingSummary(boss, { storeId: 'a', date: m.today }).expectedMinor.wechat, 300000);
});
