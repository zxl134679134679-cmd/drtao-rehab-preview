import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from './core.js';
import { confirmedTestSchedules, confirmTestShift } from './scheduling-test-fixture.mjs';

const { DemoModel } = core;
const boss = { type: 'boss', id: 'boss' };
const model = () => confirmedTestSchedules(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T04:00:00.000Z' }));
const snapshot = m => JSON.stringify({ state: m.state, sequence: m.sequence });
const photos = () => [{ id: 'photo-store-card', name: '服务留底.png', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }];
const service = (extra = {}) => ({ clientId: 'c1', storeId: 'a', date: '2026-10-09', time: '09:00', project: '康复训练', principalId: 't1', participantIds: [], notes: '按计划完成本次服务', evidencePhotos: photos(), requestId: 'store-card-service', ...extra });
const createInput = (extra = {}) => ({ clientId: 'c1', storeId: 'a', name: '本店康复套餐', amount: '25200', total: '60', requestId: 'create-store-card', ...extra });
function bound() {
  const m = model(); m.state.packages.find(p => p.id === 'p1').storeId = 'b';
  m.state.packages.push({ id: 'p7', clientId: 'c1', storeId: 'a', name: '麦岛康复套餐', amount: 24000, amountMinor: 2400000, total: 60, openingUsed: 0, status: 'historical' });
  return m;
}
function method(m, name) { assert.equal(typeof m[name], 'function', `缺少门店套餐 ${name} API`); return m[name].bind(m); }
function rejectsUnchanged(m, fn, pattern) { const before = snapshot(m); assert.throws(fn, pattern); assert.equal(snapshot(m), before, '失败不能改次数、服务、财务、审计或序列'); }

test('available cards and remaining sessions are independent for the two stores including a non-current positive card', () => {
  const m = bound(), available = method(m, 'availablePackages'), remaining = method(m, 'remainingInStore');
  assert.deepEqual(available('c1', 'a').map(p => p.id), ['p7']);
  assert.deepEqual(available('c1', 'b').map(p => p.id), ['p1']);
  assert.deepEqual(available('c1').map(p => p.id), ['p1', 'p7']);
  assert.equal(remaining('c1', 'a'), 60); assert.equal(remaining('c1', 'b'), 9);
  rejectsUnchanged(m, () => remaining('c1', 'missing'), /门店/);
  assert.throws(() => available('missing', 'a'), /客户/);
});

test('automatic service selection consumes the available card in its actual store and preserves the other card', () => {
  const m = bound(), remaining = method(m, 'remainingInStore');
  const a = m.registerService(service(), boss);
  assert.equal(a.packageId, 'p7'); assert.equal(a.amount, 400); assert.equal(a.amountMinor, 40000);
  assert.equal(remaining('c1', 'a'), 59); assert.equal(remaining('c1', 'b'), 9);
  const b = m.registerService(service({ storeId: 'b', principalId: 't2', time: '11:00', requestId: 'store-b-service' }), boss);
  assert.equal(b.packageId, 'p1'); assert.equal(b.amount, 300); assert.equal(remaining('c1', 'b'), 8);
  assert.equal(m.performance('t1'), 400); assert.equal(m.performance('t2'), 600);
  assert.equal(m.state.clients.find(c => c.id === 'c1').packageId, 'p1', '无需切换全局当前卡才能在另一店用自己的卡');
});

test('an explicitly selected foreign-store or another-client card is rejected without any change', () => {
  const m = bound();
  for (const packageId of ['p1', 'p2', 'missing', 'p0']) rejectsUnchanged(m, () => m.registerService(service({ packageId }), boss), /套餐|门店|客户|次数/);
});

test('no local usable card fails clearly instead of falling back to another store with remaining sessions', () => {
  const m = bound(); m.state.packages.find(p => p.id === 'p7').openingUsed = 60;
  rejectsUnchanged(m, () => m.registerService(service(), boss), /本店|门店|次数/);
  assert.equal(m.packageRemaining('p1'), 9);
});

test('explicit local card selection preserves its own price and idempotent retry cannot consume another local card', () => {
  const m = bound(), create = method(m, 'createStorePackage');
  const created = create(createInput(), boss);
  const first = m.registerService(service({ packageId: created.id }), boss), before = snapshot(m);
  assert.equal(first.packageId, created.id); assert.equal(first.amount, 420); assert.equal(first.amountMinor, 42000);
  assert.equal(m.packageRemaining(created.id), 59); assert.equal(m.packageRemaining('p7'), 60);
  assert.deepEqual(m.registerService(service({ packageId: created.id }), boss), first); assert.equal(snapshot(m), before);
  rejectsUnchanged(m, () => m.registerService(service({ packageId: 'p7' }), boss), /提交|内容|变化/);
});

test('revoking a service restores only its original store card and original slot even after current-card changes', () => {
  const m = bound(), remaining = method(m, 'remainingInStore');
  const a = m.registerService(service(), boss);
  const b = m.registerService(service({ storeId: 'b', principalId: 't2', time: '11:00', requestId: 'store-b-revoke' }), boss);
  m.activatePackage('p7', '改为显示麦岛卡', boss);
  m.revokeService(b.id, '该次服务登记错误', boss);
  assert.equal(b.packageId, 'p1'); assert.equal(b.slotNumber, 2);
  assert.equal(remaining('c1', 'b'), 9); assert.equal(remaining('c1', 'a'), 59);
  m.revokeService(a.id, '麦岛登记更正', boss);
  assert.equal(remaining('c1', 'a'), 60); assert.equal(remaining('c1', 'b'), 9);
});

test('legacy unbound current cards keep existing shared-service behaviour until explicitly migrated', () => {
  const m = model(), available = method(m, 'availablePackages'), remaining = method(m, 'remainingInStore');
  assert.deepEqual(available('c1', 'a').map(p => p.id), ['p1']); assert.deepEqual(available('c1', 'b').map(p => p.id), ['p1']);
  const row = m.registerService(service(), boss);
  assert.equal(row.packageId, 'p1'); assert.equal(row.amount, 300);
  assert.equal(m.remaining('c1'), 8); assert.equal(remaining('c1', 'a'), 8); assert.equal(remaining('c1', 'b'), 8);
});

test('creating a store card only grants its own sessions and never invents a cash receipt or consumption performance', () => {
  const m = bound(), create = method(m, 'createStorePackage');
  const beforeCash = structuredClone([m.state.receipts, m.state.refunds]), beforeServices = structuredClone(m.state.services), beforePrimary = m.state.clients.find(c => c.id === 'c1').packageId;
  const row = create(createInput(), boss);
  assert.equal(row.clientId, 'c1'); assert.equal(row.storeId, 'a'); assert.equal(row.amountMinor, 2520000); assert.equal(row.total, 60); assert.equal(row.openingUsed, 0); assert.equal(row.status, 'historical');
  assert.equal(row.createdBy, 'boss'); assert.equal(row.createdRole, 'boss');
  assert.deepEqual([m.state.receipts, m.state.refunds], beforeCash); assert.deepEqual(m.state.services, beforeServices);
  assert.equal(m.state.clients.find(c => c.id === 'c1').packageId, beforePrimary);
  const before = snapshot(m); assert.deepEqual(create(createInput(), boss), row); assert.equal(snapshot(m), before);
  for (const change of [{ amount: '24000' }, { total: '61' }, { storeId: 'b' }, { clientId: 'c2' }]) rejectsUnchanged(m, () => create(createInput(change), boss), /提交|内容|变化/);
});

test('store card creation validates the real boss, client, store, money and whole sessions atomically', () => {
  const m = bound(), create = method(m, 'createStorePackage');
  for (const role of [{ type: 'boss', id: 'forged' }, { type: 'frontdesk', id: 'f1' }, { type: 'therapist', id: 't1' }, { type: 'manager', id: 'm1' }, { type: 'customer', id: 'c1' }]) rejectsUnchanged(m, () => create(createInput(), role), /老板|权限/);
  for (const change of [{ clientId: 'unknown' }, { storeId: 'unknown' }, { storeId: '' }, { amount: '0' }, { amount: '1.005' }, { amount: '0.10', total: '60' }, { total: '1.5' }, { total: 0 }, { requestId: '' }, { name: '' }]) rejectsUnchanged(m, () => create(createInput(change), boss));
  m.now = () => 'bad-clock'; rejectsUnchanged(m, () => create(createInput(), boss), /时钟|时间/);
});

test('renewing an exhausted historical local card preserves the other-store current card and fixed store binding', () => {
  const m = bound(); m.state.packages.find(p => p.id === 'p7').openingUsed = 60;
  const data = { ...createInput({ requestId: 'renew-local-card', amount: '24000' }), previousPackageId: 'p7', reason: '麦岛套餐用完续费' };
  const row = m.renewPackage(data, boss);
  assert.equal(row.storeId, 'a'); assert.equal(row.previousPackageId, 'p7'); assert.equal(row.status, 'historical');
  assert.equal(m.state.clients.find(c => c.id === 'c1').packageId, 'p1'); assert.equal(m.packageRemaining('p1'), 9);
  assert.equal(method(m, 'remainingInStore')('c1', 'a'), 60);
  const before = snapshot(m); assert.deepEqual(m.renewPackage(data, boss), row); assert.equal(snapshot(m), before);
  rejectsUnchanged(m, () => m.renewPackage({ ...data, storeId: 'b' }, boss), /门店|提交|内容|变化/);
  assert.equal(m.state.receipts.length, 0); assert.equal(m.state.refunds.length, 0);
});

test('renewing a bound current card retains its store when omitted and cannot move an exhausted card to another store', () => {
  const m = bound();
  for (let i = 0; i < 9; i++) m.registerService(service({ storeId: 'b', principalId: 't2', time: `${String(i + 8).padStart(2, '0')}:00`, requestId: `exhaust-store-b-${i}` }), boss);
  const data = { clientId: 'c1', name: '崂山续套餐', amount: '3000', total: '10', reason: '原套餐用完', requestId: 'renew-bound' };
  rejectsUnchanged(m, () => m.renewPackage({ ...data, storeId: 'a' }, boss), /门店|办卡/);
  const row = m.renewPackage(data, boss); assert.equal(row.storeId, 'b'); assert.equal(row.status, 'current');
  assert.equal(m.state.clients.find(c => c.id === 'c1').packageId, row.id);
  const before = snapshot(m); assert.deepEqual(m.renewPackage(data, boss), row); assert.equal(snapshot(m), before);
  assert.equal(m.packageRemaining('p7'), 60);
});

test('new renewal of an old shared package binds to the selected actual store instead of creating another shared card', () => {
  const m = model();
  const row = m.renewPackage({ clientId: 'c6', name: '续套餐', amount: '3000', total: '10', reason: '旧卡用完', requestId: 'legacy-renew' }, boss);
  assert.equal(row.storeId, 'a'); assert.equal(row.clientId, 'c6');
  const first = method(m, 'createStorePackage')(createInput({ requestId: 'global-package-key' }), boss);
  rejectsUnchanged(m, () => m.renewPackage({ clientId: 'c6', name: '续套餐', amount: '3000', total: '10', reason: '续费', requestId: 'global-package-key' }, boss), /提交|内容|用途|操作/);
  assert.equal(first.storeId, 'a');
});

test('constructor rejects unknown package-store bindings and mismatched historical service-store ownership', () => {
  const state = structuredClone(model().state); state.packages.find(p => p.id === 'p1').storeId = 'unknown';
  assert.throws(() => new DemoModel({ state }), /门店/);
  state.packages.find(p => p.id === 'p1').storeId = 'a';
  assert.throws(() => new DemoModel({ state }), /服务|门店|套餐/);
});

test('store-card demo initialization is explicit, idempotent, seed-only and does not record fresh revenue', () => {
  assert.equal(typeof core.ensureStorePackageExamples, 'function', '缺少显式 UI 示例初始化函数');
  const m = model(); assert.equal(m.state.packages.some(p => p.id === 'p7'), false); assert.equal(m.state.packages.find(p => p.id === 'p1').storeId, undefined);
  const beforeCash = structuredClone([m.state.receipts, m.state.refunds]), beforeAudit = structuredClone(m.state.audit), beforeServices = structuredClone(m.state.services), beforeSequence = m.sequence;
  core.ensureStorePackageExamples(m);
  assert.equal(m.state.packages.find(p => p.id === 'p1').storeId, 'b'); assert.equal(m.state.packages.find(p => p.id === 'p7').storeId, 'a');
  assert.equal(method(m, 'remainingInStore')('c1', 'a'), 10); assert.equal(method(m, 'remainingInStore')('c1', 'b'), 9);
  for (const pack of m.state.packages.filter(p => p.id !== 'p1')) assert.equal(pack.storeId, m.state.clients.find(c => c.id === pack.clientId).storeId);
  assert.deepEqual([m.state.receipts, m.state.refunds], beforeCash); assert.deepEqual(m.state.audit, beforeAudit); assert.deepEqual(m.state.services, beforeServices); assert.equal(m.sequence, beforeSequence);
  const after = snapshot(m); core.ensureStorePackageExamples(m); assert.equal(snapshot(m), after);
  const custom = new DemoModel({ state: structuredClone(model().state) }), customBefore = snapshot(custom);
  core.ensureStorePackageExamples(custom); assert.equal(snapshot(custom), customBefore, '明确提供的旧档案不能自动种卡');
});

test('an exhausted current local card remains visible while exhausted historical cards cannot be consumed', () => {
  const m = bound(); m.state.packages.find(p => p.id === 'p7').openingUsed = 60;
  const rows = method(m, 'availablePackages')('c6', 'a');
  assert.deepEqual(rows.map(p => p.id), ['p6']); assert.equal(method(m, 'remainingInStore')('c6', 'a'), 0);
  assert.deepEqual(method(m, 'availablePackages')('c1', 'a'), []);
});

test('newly imported paper archives bind their opening package to the chosen store without recording cash', () => {
  const m = model();
  const row = m.importOpening({ name: '新迁入客户', phone: '13800000123', ownerId: 't1', storeId: 'a', packageName: '原纸质套餐', amount: '24000', total: '60', remaining: '40', notes: '纸质核对' }, boss);
  assert.equal(m.state.packages.find(p => p.id === row.packageId).storeId, 'a');
  assert.equal(m.state.receipts.length, 0); assert.equal(m.state.refunds.length, 0);
});

test('last-session explicit replay and revoked replay return the original service without consuming any other card', () => {
  const m = bound(); m.state.packages.find(p => p.id === 'p7').openingUsed = 59;
  const data = service({ packageId: 'p7' }), row = m.registerService(data, boss);
  assert.equal(m.packageRemaining('p7'), 0);
  let before = snapshot(m); assert.deepEqual(m.registerService(data, boss), row); assert.equal(snapshot(m), before);
  for (const change of [{ packageId: 'p1' }, { packageId: 'p1', storeId: 'b' }]) rejectsUnchanged(m, () => m.registerService({ ...data, ...change }, boss), /提交|内容|变化/);
  m.revokeService(row.id, '错登最后一次', boss); assert.equal(m.packageRemaining('p7'), 1);
  before = snapshot(m); const replay = m.registerService(data, boss);
  assert.equal(replay.id, row.id); assert.equal(replay.status, 'revoked'); assert.equal(snapshot(m), before);
});

test('implicit service idempotency seals the actual chosen local card before later local cards become available', () => {
  const m = bound(); m.state.packages.find(p => p.id === 'p7').openingUsed = 59;
  const row = m.registerService(service(), boss);
  assert.equal(row.packageId, 'p7'); assert.equal(JSON.parse(row.inputKey).packageId, 'p7');
  const newCard = method(m, 'createStorePackage')(createInput(), boss);
  const before = snapshot(m); assert.deepEqual(m.registerService(service(), boss), row); assert.equal(snapshot(m), before);
  assert.equal(m.packageRemaining(newCard.id), 60); assert.equal(m.packageRemaining('p7'), 0);
});

test('renewal failure is atomic for wrong owner, unused cards and invalid clock', () => {
  const m = bound(); m.state.packages.find(p => p.id === 'p7').openingUsed = 60;
  const data = { ...createInput({ requestId: 'atomic-renew' }), previousPackageId: 'p7', reason: '本店用完续费' };
  rejectsUnchanged(m, () => m.renewPackage({ ...data, previousPackageId: 'p2' }, boss), /本人|客户|套餐/);
  rejectsUnchanged(m, () => m.renewPackage({ ...data, previousPackageId: 'p1', storeId: 'b' }, boss), /剩余|用完/);
  m.now = () => 'invalid'; rejectsUnchanged(m, () => m.renewPackage(data, boss), /时钟|时间/);
});

test('a bound local card grants basic reception access and booking to that store front desk without widening therapist access', () => {
  const m = model(), frontB = { type: 'frontdesk', id: 'f2' };
  assert.equal(m.canSeeClient(frontB, 'c3'), false, '旧共享卡不能自动扩大前台权限');
  assert.equal(m.canSeeClient({ type: 'therapist', id: 't2' }, 'c3'), false);
  const card = method(m, 'createStorePackage')(createInput({ clientId: 'c3', storeId: 'b', amount: '3000', total: '10', requestId: 'c3-b-store-card' }), boss);
  assert.equal(m.canSeeClient(frontB, 'c3'), true);
  assert.equal(m.canSeeClient({ type: 'therapist', id: 't2' }, 'c3'), false, '前台本店接待关系不授予无关康复师客户权限');
  assert.equal(m.canSeeClient(frontB, 'c5'), false);
  confirmTestShift(m, { therapistId: 't1', storeId: 'b', date: '2026-10-12' });
  const appointment = m.saveAppointment({ clientId: 'c3', storeId: 'b', date: '2026-10-12', time: '09:00', project: '康复训练', principalId: 't1' }, frontB);
  assert.equal(appointment.storeId, 'b'); assert.equal(appointment.clientId, 'c3');
  m.cancelAppointment(appointment.id, '客户改约', frontB);
  m.state.packages.find(p => p.id === card.id).openingUsed = 10;
  assert.equal(m.canSeeClient(frontB, 'c3'), true, '耗尽的本店卡保留接待历史可见性');
  m.state.frontDesks.find(f => f.id === 'f2').active = false;
  assert.equal(m.canSeeClient(frontB, 'c3'), false);
});
