import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './legacy-test-fixture.mjs';
import { ensureSchedules } from './schedules.js';

const boss = { type: 'boss', id: 'boss' }, t1 = { type: 'therapist', id: 't1' }, t4 = { type: 'therapist', id: 't4' };
const f1 = { type: 'frontdesk', id: 'f1' }, f2 = { type: 'frontdesk', id: 'f2' }, c3 = { type: 'customer', id: 'c3' };
const fresh = () => { const m = ensureStorePackageExamples(new DemoModel({ now: () => '2026-10-08T12:00:00.000Z' })); ensureSchedules(m); return m; };
const photos = () => [{ id: 'photo', name: '现场.png', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }];
const receipt = (m, extra = {}) => m.recordReceipt({ clientId: 'c3', storeId: 'a', date: m.today, time: '09:00', purpose: 'single', amount: '420.15', method: 'wechat', requestId: 'single-cash', ...extra }, boss);
const serviceInput = (m, row, extra = {}) => ({ clientId: row.clientId, storeId: row.storeId, date: m.today, time: '14:00', principalId: 't1', participantIds: [], project: m.state.appointments.find(x => x.id === 'a3').project, notes: '完成复评并记录训练情况', evidencePhotos: photos(), billingMode: 'single', receiptId: row.id, requestId: 'single-service', ...extra });
const unchanged = (m, action, pattern = /权限|老板|本店|在职|门店|客户|单次|收款|到账|退款|服务|套餐|变化|无须|无需|取消|待办|结果|说明|照片|申请|选择|已结束|有效|长度|原因/) => {
  const before = JSON.stringify([m.state, m.sequence]); assert.throws(action, pattern); assert.equal(JSON.stringify([m.state, m.sequence]), before);
};
const replay = m => new DemoModel({ state: m.state, today: m.today, now: m.now, seed: false });

test('single payment completion generates actual performance, completes appointment, and never consumes a package', () => {
  const m = fresh(), cash = receipt(m), remaining = m.remainingInStore('c3', 'a'), baseline = m.performance('t1');
  assert.equal(m.performance('t1'), baseline);
  const cashBefore = structuredClone(m.state.receipts), service = m.registerService(serviceInput(m, cash, { appointmentId: 'a3', serviceNextStep: '  下次复查活动度  ' }), t1);
  assert.equal(service.billingMode, 'single'); assert.equal(service.receiptId, cash.id); assert.equal(service.packageId, null); assert.equal(service.sessions, 0);
  assert.equal(service.amount, 420.15); assert.equal(service.amountMinor, 42015); assert.equal(service.nextStepSuggestion, '下次复查活动度');
  assert.equal(m.performance('t1'), baseline + 420.15); assert.equal(m.remainingInStore('c3', 'a'), remaining);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').status, 'completed'); assert.deepEqual(m.state.receipts, cashBefore);
  const audits = m.state.audit.length; assert.equal(m.registerService(serviceInput(m, cash, { appointmentId: 'a3', serviceNextStep: '  下次复查活动度  ' }), t1).id, service.id); assert.equal(m.state.audit.length, audits);
  assert.equal(replay(m).performance('t1'), baseline + 420.15);
});

test('new client without any package can fulfill a paid single service with evidence', () => {
  const m = fresh(); const client = m.createReceptionClient({ name: '单次体验客户', phone: '13810000999', age: '35', problem: '希望做运动评估', storeId: 'a', requestId: 'new-client' }, boss);
  m.transferClient(client.id,'t1','单次服务前明确客户负责人',boss);
  const cash = receipt(m, { clientId: client.id });
  const row = m.registerService(serviceInput(m, cash, { time: '15:00', project: '首次评估' }), t1);
  assert.equal(row.amount, 420.15); assert.equal(m.remaining(client.id), 0); assert.equal(m.state.packages.some(x => x.clientId === client.id), false);
  assert.equal(row.evidencePhotos.length, 1); assert.equal(replay(m).state.services.find(x => x.id === row.id).packageId, null);
});

test('single receipt can be fulfilled once; revoked service restores its entitlement and original appointment without touching cash', () => {
  const m = fresh(), cash = receipt(m), before = m.performance('t1'), cashBefore = structuredClone(m.state.receipts);
  const row = m.registerService(serviceInput(m, cash, { appointmentId: 'a3' }), t1);
  unchanged(m, () => m.registerService(serviceInput(m, cash, { time: '16:00', requestId: 'duplicate-service' }), t1));
  assert.equal(m.availableSingleReceipts('c3', 'a', t1).length, 0);
  m.revokeService(row.id, '登记时间有误，核对后重新登记', boss);
  assert.equal(m.performance('t1'), before); assert.deepEqual(m.state.receipts, cashBefore);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').status, 'confirmed'); assert.equal(m.availableSingleReceipts('c3', 'a', t1)[0].id, cash.id);
  const corrected = m.registerService(serviceInput(m, cash, { appointmentId: 'a3', requestId: 'corrected-service' }), t1);
  assert.notEqual(corrected.id, row.id); assert.equal(m.performance('t1'), before + 420.15); assert.equal(replay(m).performance('t1'), before + 420.15);
});

test('single mode rejects mismatched, unpaid, refunded, revoked, non-single and conflicting package sources atomically', () => {
  for (const variant of [{ clientId: 'c1' }, { storeId: 'b' }, { purpose: 'other' }, { channel: 'douyin', reference: 'DY-ONE', settlementStatus: 'pending' }]) {
    const m = fresh(), cash = receipt(m, variant); unchanged(m, () => m.registerService(serviceInput(m, cash, { clientId: 'c3', storeId: 'a' }), t1));
  }
  for (const action of ['refund', 'void']) {
    const m = fresh(), cash = receipt(m);
    if (action === 'refund') m.refundReceipt({ receiptId: cash.id, date: m.today, time: '10:00', amount: '1', reason: '部分退款', requestId: 'refund' }, boss);
    else m.voidReceipt(cash.id, '错误收款', boss);
    unchanged(m, () => m.registerService(serviceInput(m, cash), t1)); assert.deepEqual(m.availableSingleReceipts('c3', 'a', t1), []);
  }
  const m = fresh(), cash = receipt(m);
  for (const extra of [{ packageId: 'p3' }, { receiptId: '' }, { billingMode: 'unknown' }, { evidencePhotos: [] }, { serviceNextStep: 123 }, { serviceNextStep: 'a'.repeat(501) }]) unchanged(m, () => m.registerService(serviceInput(m, cash, extra), t1));
  for (const role of [f1, { type: 'manager', id: 'm1' }, { type: 'customer', id: 'c3' }, { type: 'therapist', id: 't4' }, { type: 'boss', id: 'forged' }]) unchanged(m, () => m.registerService(serviceInput(m, cash), role));
});

test('available single receipts is a safe scoped projection and settled platform single uses only actual child amount', () => {
  const m = fresh(), parent = receipt(m, { channel: 'douyin', method: 'bank', reference: 'DY-ONE', settlementStatus: 'pending' });
  assert.deepEqual(m.availableSingleReceipts('c3', 'a', t1), []);
  const cash = m.settleReceipt(parent.id, { amount: '400', date: m.today, time: '10:00', reference: 'DY-PAID', requestId: 'settle' }, boss);
  const available = m.availableSingleReceipts('c3', 'a', t1); assert.equal(available.length, 1); assert.equal(available[0].id, cash.id); assert.equal(available[0].amount, 400); assert.equal(available[0].purpose, 'single'); assert.equal(available[0].inputKey, undefined);
  available[0].amount = 1; assert.equal(m.availableSingleReceipts('c3', 'a', boss)[0].amount, 400);
  for (const role of [f1, { type: 'manager', id: 'm1' }, { type: 'customer', id: 'c3' }, t4, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.availableSingleReceipts('c3', 'a', role));
  const row = m.registerService(serviceInput(m, cash), t1); assert.equal(row.amount, 400); assert.equal(replay(m).state.services[0].amount, 400);
});

test('refund and receipt void require prior reversal of a fulfilled single service, keeping historic cash and performance consistent', () => {
  const m = fresh(), cash = receipt(m), row = m.registerService(serviceInput(m, cash), t1);
  unchanged(m, () => m.refundReceipt({ receiptId: cash.id, date: m.today, time: '16:00', amount: '1', reason: '退款', requestId: 'refund' }, boss), /先撤销.*服务|服务.*撤销/);
  unchanged(m, () => m.voidReceipt(cash.id, '错误收款', boss), /先撤销.*服务|服务.*撤销/);
  const corrupt = structuredClone(m.state); corrupt.receipts.find(x => x.id === cash.id).status = 'revoked';
  assert.throws(() => new DemoModel({ state: corrupt }), /单次|收款|有效/);
  m.revokeService(row.id, '服务登记错误', boss);
  m.refundReceipt({ receiptId: cash.id, date: m.today, time: '16:00', amount: '420.15', reason: '未实际履约，退回款项', requestId: 'refund' }, boss);
  assert.equal(replay(m).state.services.find(x => x.id === row.id).status, 'revoked'); assert.deepEqual(m.availableSingleReceipts('c3', 'a', t1), []);
});

test('boss can assign one execution therapist in each store without changing global owner, plan or photo privacy', () => {
  const m = fresh(), client = m.state.clients.find(x => x.id === 'c3'), beforeOwner = client.ownerId;
  assert.equal(m.canSeeClient(t4, client.id), false);
  const result = m.assignStoreTherapist({ clientId: client.id, storeId: 'b', therapistId: 't4', reason: '客户将在崂山店继续评估' }, boss);
  assert.equal(result.ownerId, beforeOwner); assert.equal(m.clientStoreTherapist(client.id, 'b'), 't4'); assert.equal(m.clientStoreTherapist(client.id, 'a'), '');
  assert.equal(m.canSeeClient(t4, client.id), true); assert.equal(m.canSeeClient({ type: 'therapist', id: 't2' }, client.id), false);
  m.saveAppointment({ clientId: client.id, storeId: 'b', principalId: 't4', date: '2026-10-10', time: '12:00', project: '跨店首次评估' }, t4);
  unchanged(m, () => m.saveAppointment({ clientId: client.id, storeId: 'a', principalId: 't4', date: '2026-10-10', time: '16:00', project: '越权预约' }, t4));
  unchanged(m, () => m.registerService({ clientId: client.id, storeId: 'a', principalId: 't4', date: m.today, time: '16:00', project: '越权服务', notes: '测试', evidencePhotos: photos(), requestId: 'wrong-store' }, t4));
  unchanged(m, () => m.publishPlan(client.id, { goal: '新目标', phase: '新阶段', nextStep: '新安排', planNotes: '说明', homeAdvice: '指导' }, t4));
  assert.equal(m.canSeeEvidence(t4, 's1'), false); assert.deepEqual(m.reviewRows(t4), []);
  assert.equal(replay(m).clientStoreTherapist(client.id, 'b'), 't4'); assert.equal(m.state.audit.some(x => x.type === 'client_store_therapist_assigned'), true);
});

test('execution grants reject wrong-store, inactive, forged and non-boss actors, and prevent silent personnel deactivation', () => {
  const m = fresh(); const input = { clientId: 'c3', storeId: 'b', therapistId: 't4', reason: '本店执行安排' };
  for (const role of [t1, f1, { type: 'manager', id: 'm2' }, { type: 'customer', id: 'c3' }, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.assignStoreTherapist(input, role));
  unchanged(m, () => m.assignStoreTherapist({ ...input, therapistId: 't3' }, boss)); unchanged(m, () => m.assignStoreTherapist({ ...input, reason: '' }, boss));
  m.state.therapists.find(x => x.id === 't4').active = false; unchanged(m, () => m.assignStoreTherapist(input, boss));
  m.state.therapists.find(x => x.id === 't4').active = true; m.assignStoreTherapist(input, boss);
  unchanged(m, () => m.assignStoreTherapist(input, boss), /相同|没有变化|已.*指定/);
  m.state.clients.filter(x => x.ownerId === 't4').forEach(x => x.ownerId = 't2');
  unchanged(m, () => m.deactivateTherapist('t4', boss), /执行|负责|转交/);
  const invalid = structuredClone(m.state); invalid.clients.find(x => x.id === 'c3').storeTherapistIds.b = 't3'; assert.throws(() => new DemoModel({ state: invalid }), /门店|执行/);
});

test('unchanged reschedule is rejected without tasks; retry of same pending request makes no new task or audit', () => {
  const m = fresh(), customer = { type: 'customer', id: 'c1' };
  unchanged(m, () => m.requestReschedule('a1', { date: '2026-10-10', time: '10:00', reason: '试点' }, customer), /变化|无需|原.*时间/);
  const input = { date: '2026-10-10', time: '12:00', reason: '下午到店' }; m.requestReschedule('a1', input, customer);
  const before = JSON.stringify([m.state, m.sequence]); m.requestReschedule('a1', input, customer); assert.equal(JSON.stringify([m.state, m.sequence]), before);
  assert.equal(m.state.appointments.find(x => x.id === 'a1').time, '10:00'); assert.equal(m.state.tasks.filter(x => x.type === 'reschedule' && x.appointmentId === 'a1').length, 1);
});

test('customer cancellation request retains slot, creates boss pending task and allows reject then a new audited request', () => {
  const m = fresh(); const row = m.requestAppointmentCancellation('a3', { reason: '今天临时有事' }, c3);
  assert.equal(row.status, 'confirmed'); assert.equal(row.cancellationRequest.status, 'pending'); assert.equal(row.time, '14:00');
  assert.equal(m.state.tasks.filter(x => x.type === 'appointment_cancellation' && x.appointmentId === 'a3' && x.assigneeId === 'boss' && x.status === 'pending').length, 1);
  const before = JSON.stringify([m.state, m.sequence]); m.requestAppointmentCancellation('a3', { reason: '今天临时有事' }, c3); assert.equal(JSON.stringify([m.state, m.sequence]), before);
  unchanged(m, () => m.completeTask(m.state.tasks.find(x => x.type === 'appointment_cancellation').id, boss), /先.*取消|先.*处理/);
  const rejected = m.handleAppointmentCancellation('a3', { decision: 'reject', reason: '已电话沟通，客户按原时间到店' }, f1);
  assert.equal(rejected.status, 'confirmed'); assert.equal(rejected.cancellationRequest.status, 'rejected'); assert.equal(rejected.time, '14:00');
  assert.equal(m.state.tasks.find(x => x.type === 'appointment_cancellation').status, 'completed');
  const next = m.requestAppointmentCancellation('a3', { reason: '重新确认确实无法到店' }, c3); assert.equal(next.cancellationHistory.length, 1); assert.equal(next.cancellationHistory[0].status, 'rejected'); assert.equal(next.cancellationRequest.status, 'pending');
});

test('cancellation approval follows original cancel path and does not consume money or package sessions', () => {
  const m = fresh(), beforeRemaining = m.remaining('c3'), beforeCash = structuredClone(m.state.receipts);
  m.requestAppointmentCancellation('a3', { reason: '无法到店' }, c3);
  const row = m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '电话确认同意取消' }, t1);
  assert.equal(row.status, 'cancelled'); assert.equal(row.cancellationRequest.status, 'approved'); assert.equal(row.cancellationRequest.handledBy, 't1'); assert.equal(row.cancelReason, '电话确认同意取消');
  assert.equal(m.remaining('c3'), beforeRemaining); assert.deepEqual(m.state.receipts, beforeCash);
  assert.equal(m.state.tasks.find(x => x.type === 'appointment_cancellation').status, 'completed'); assert.equal(m.state.audit.some(x => x.type === 'appointment_cancelled'), true);
  const before = JSON.stringify([m.state, m.sequence]); m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '电话确认同意取消' }, t1); assert.equal(JSON.stringify([m.state, m.sequence]), before);
});

test('cancellation customer ownership and handler scope are checked before replay; managers stay read-only', () => {
  const m = fresh(); for (const role of [t1, boss, { type: 'customer', id: 'c1' }]) unchanged(m, () => m.requestAppointmentCancellation('a3', { reason: '取消' }, role));
  m.requestAppointmentCancellation('a3', { reason: '取消' }, c3);
  for (const role of [f2, { type: 'therapist', id: 't3' }, { type: 'manager', id: 'm1' }, c3, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '同意' }, role));
  for (const data of [{ decision: 'bad', reason: '说明' }, { decision: 'approve', reason: '' }]) unchanged(m, () => m.handleAppointmentCancellation('a3', data, boss));
  m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '同意' }, boss);
  unchanged(m, () => m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '同意' }, { type: 'boss', id: 'fake' }));
  unchanged(m, () => m.requestAppointmentCancellation('a3', { reason: '再取消' }, c3));
});

test('cancel requests are resolved when original booking ends, while service reversal restores a previously pending request', () => {
  const m = fresh(), cash = receipt(m); m.requestAppointmentCancellation('a3', { reason: '可能赶不上' }, c3);
  const row = m.registerService(serviceInput(m, cash, { appointmentId: 'a3' }), t1);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').cancellationRequest.status, 'superseded');
  assert.equal(m.state.tasks.find(x => x.type === 'appointment_cancellation').status, 'completed');
  m.revokeService(row.id, '实际未完成，请继续处理取消申请', boss);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').cancellationRequest.status, 'pending'); assert.equal(m.state.tasks.find(x => x.type === 'appointment_cancellation').status, 'pending');
  m.cancelAppointment('a3', '门店主动取消', f1); assert.equal(m.state.appointments.find(x => x.id === 'a3').cancellationRequest.status, 'superseded');
});

test('general task completion requires actual result, saves it and remains idempotent while special tasks keep action checks', () => {
  const m = fresh(); for (const data of [{}, { result: '' }, { result: 100 }, { result: 'x'.repeat(2001) }]) unchanged(m, () => m.completeTask('task1', t1, data));
  const row = m.completeTask('task1', t1, { result: '  已完成评估，客户同意下周复查  ' }); assert.equal(row.completionResult, '已完成评估，客户同意下周复查'); assert.equal(row.status, 'completed');
  const before = JSON.stringify([m.state, m.sequence]); m.completeTask('task1', t1, { result: '已完成评估，客户同意下周复查' }); assert.equal(JSON.stringify([m.state, m.sequence]), before);
  unchanged(m, () => m.completeTask('task1', t1, { result: '修改为别的结果' })); unchanged(m, () => m.completeTask('task2', { type: 'manager', id: 'm1' }, { result: '完成' }));
  unchanged(m, () => m.completeTask('task3', boss, { result: '随便写一个完成' }), /真实服务|按预约/);
  assert.equal(m.state.audit[0].completionResult, row.completionResult);
});

test('boss may adjust pending general task owner and due date with reason, while special or completed tasks retain their workflow', () => {
  const m = fresh(); m.assignStoreTherapist({ clientId: 'c3', storeId: 'b', therapistId: 't4', reason: '本店执行安排' }, boss);
  const input = { assigneeId: 't4', dueDate: '2026-10-10', reason: '改由崂山店执行师复评' };
  for (const role of [t1, f1, { type: 'manager', id: 'm1' }, { type: 'boss', id: 'fake' }]) unchanged(m, () => m.updateTask('task2', input, role));
  for (const data of [{ ...input, reason: '' }, { ...input, assigneeId: 't3' }, { ...input, dueDate: '2026-10-07' }]) unchanged(m, () => m.updateTask('task2', data, boss), /原因|权限|过去|日期/);
  unchanged(m, () => m.updateTask('task3', { ...input, assigneeId: 'boss' }, boss));
  const row = m.updateTask('task2', input, boss); assert.equal(row.assigneeId, 't4'); assert.equal(row.dueDate, '2026-10-10'); assert.equal(m.state.audit[0].type, 'task_updated'); assert.equal(m.state.audit[0].reason, input.reason);
  m.completeTask(row.id, t4, { result: '已完成阶段复评' }); unchanged(m, () => m.updateTask(row.id, { ...input, assigneeId: 'boss' }, boss));
});

test('a customer cannot cancel after arrival, and an earlier pending cancellation cannot erase later arrival', () => {
  const m = fresh(); m.requestAppointmentCancellation('a3', { reason: '可能无法到店' }, c3);
  m.recordArrival('a3', { requestId: 'arrival', notes: '客户按原安排到店' }, f1);
  unchanged(m, () => m.requestAppointmentCancellation('a3', { reason: '取消' }, c3), /到店/);
  unchanged(m, () => m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '取消' }, boss), /到店/);
  m.handleAppointmentCancellation('a3', { decision: 'reject', reason: '客户已经到店，按原计划进行' }, f1);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').status, 'confirmed'); assert.ok(m.state.appointments.find(x => x.id === 'a3').arrivalAt);
});

test('execution authorization cannot leak through another local task and workflow clock failures do not partially write', () => {
  const m = fresh(); m.assignStoreTherapist({ clientId: 'c3', storeId: 'b', therapistId: 't4', reason: '崂山店执行' }, boss);
  m.state.tasks.find(x => x.id === 'task2').storeId = 'a';
  unchanged(m, () => m.updateTask('task2', { assigneeId: 't4', dueDate: '2026-10-11', reason: '错误门店' }, boss));
  m.state.tasks.find(x => x.id === 'task2').assigneeId = 't4'; unchanged(m, () => m.completeTask('task2', t4, { result: '错误门店完成' }));
  m.now = () => 'invalid-clock';
  unchanged(m, () => m.requestAppointmentCancellation('a3', { reason: '临时有事' }, c3), /时钟/);
  unchanged(m, () => m.assignStoreTherapist({ clientId: 'c3', storeId: 'b', therapistId: 't2', reason: '新执行师' }, boss), /时钟/);
  unchanged(m, () => m.updateTask('task2', { assigneeId: 'boss', dueDate: '2026-10-11', reason: '重新安排' }, boss), /时钟/);
  unchanged(m, () => m.completeTask('task1', t1, { result: '已完成评估' }), /时钟/);
});

test('changing a confirmed appointment supersedes its old pending cancellation instead of cancelling the replacement', () => {
  const m = fresh(); m.requestAppointmentCancellation('a3', { reason: '今天不能到店' }, c3);
  const original = structuredClone(m.state.appointments.find(x => x.id === 'a3').cancellationRequest);
  m.saveAppointment({ id: 'a3', clientId: 'c3', storeId: 'a', principalId: 't1', date: '2026-10-10', time: '14:00', project: '阶段复评' }, boss);
  const changed = m.state.appointments.find(x => x.id === 'a3');
  assert.equal(changed.status, 'confirmed'); assert.equal(changed.cancellationRequest.status, 'superseded'); assert.equal(changed.cancellationRequest.appointmentDate, original.appointmentDate);
  const task = m.state.tasks.find(x => x.cancellationRequestId === original.id); assert.equal(task.status, 'completed'); assert.match(task.completionReason, /安排.*变化|预约.*更新/);
  unchanged(m, () => m.handleAppointmentCancellation('a3', { decision: 'approve', reason: '同意旧取消申请' }, boss), /已处理|过期|变化|重新/);
  m.requestAppointmentCancellation('a3', { reason: '新安排也无法到店' }, c3);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').cancellationHistory.find(x => x.id === original.id).status, 'superseded');
  assert.equal(m.state.appointments.find(x => x.id === 'a3').cancellationRequest.appointmentDate, '2026-10-10');
});

test('unchanged staff saving retains pending cancellation while stale snapshot cannot approve a different date, time, store or therapist', () => {
  const m = fresh(); m.requestAppointmentCancellation('a3', { reason: '临时有事' }, c3);
  m.saveAppointment({ id: 'a3', clientId: 'c3', storeId: 'a', principalId: 't1', date: m.today, time: '14:00', project: '阶段复评' }, boss);
  assert.equal(m.state.appointments.find(x => x.id === 'a3').cancellationRequest.status, 'pending'); assert.equal(m.state.tasks.find(x => x.type === 'appointment_cancellation').status, 'pending');
  for (const [field, different] of [['date', '2026-10-10'], ['time', '15:00'], ['storeId', 'b'], ['principalId', 't3']]) {
    const loaded = replay(m); loaded.state.appointments.find(x => x.id === 'a3')[field] = different;
    unchanged(loaded, () => loaded.handleAppointmentCancellation('a3', { decision: 'approve', reason: '同意' }, boss), /原.*申请|已.*变化|过期|重新/);
  }
});

test('revoking completed single or package service preserves money reversal but marks a now-overlapping original slot for reassignment', () => {
  for (const billingMode of ['single', 'package']) {
    const m = fresh(); m.transferClient('c6', 't1', '安排执行师以复现已占用时间', boss);
    const remaining = m.remainingInStore('c3', 'a'), performance = m.performance('t1');
    const cash = receipt(m), cashBefore = structuredClone(m.state.receipts);
    const input = serviceInput(m, cash, { appointmentId: 'a3', billingMode }); if (billingMode === 'package') delete input.receiptId;
    const row = m.registerService(input, t1);
    const competing = m.saveAppointment({ clientId: 'c6', storeId: 'a', principalId: 't1', date: m.today, time: '14:30', project: '首次评估' }, boss);
    m.revokeService(row.id, '原服务记录错误，需要重新安排', boss);
    const restored = m.state.appointments.find(x => x.id === 'a3'); assert.equal(restored.status, 'pending_reassignment'); assert.match(restored.reassignmentReason, /冲突|占用/);
    assert.equal(m.state.appointments.find(x => x.id === competing.id).status, 'confirmed'); assert.equal(m.performance('t1'), performance); assert.equal(m.remainingInStore('c3', 'a'), remaining); assert.deepEqual(m.state.receipts, cashBefore);
    assert.equal(replay(m).state.appointments.find(x => x.id === 'a3').status, 'pending_reassignment');
  }
});

test('service reversal checks the same customer across therapists and permits the exact sixty-minute boundary', () => {
  for (const nextTime of ['14:30', '15:00']) {
    const m = fresh(), cash = receipt(m); m.assignStoreTherapist({ clientId: 'c3', storeId: 'a', therapistId: 't3', reason: '本店另一执行师' }, boss);
    const row = m.registerService(serviceInput(m, cash, { appointmentId: 'a3' }), t1);
    m.saveAppointment({ clientId: 'c3', storeId: 'a', principalId: 't3', date: m.today, time: nextTime, project: '阶段复评' }, boss);
    m.revokeService(row.id, '登记错误', boss);
    assert.equal(m.state.appointments.find(x => x.id === 'a3').status, nextTime === '14:30' ? 'pending_reassignment' : 'confirmed');
  }
});
