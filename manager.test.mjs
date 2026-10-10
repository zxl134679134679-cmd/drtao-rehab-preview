import {workflowTypes,workflowDialog} from './workflow-ui.js';
import { paperIntakeRows } from './paper-intake.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel } from './core.js';
import { confirmedTestSchedules, confirmTestShift } from './scheduling-test-fixture.mjs';
import { scheduleRows, scheduleRequestRows, bossScheduleNotifications } from './schedules.js';
import { scheduleDialog } from './schedules-ui.js';
import { ensureEvaluations, recordAssessment, confirmAssessment, voidAssessment, recordFrontDeskEvaluation, voidFrontDeskEvaluation } from './evaluations.js';
import { renderManager, managerDialog } from './manager.js';
import { receptionStores, receptionDialog, assertReceptionAppointment } from './reception.js';
import { appointmentBatchDialog } from './companion-booking.js';
import { staffDialog, personnelDialog } from './staff.js';
import { cashDialog } from './cash.js';
import { assessmentRows, frontDeskEvaluationRows, evaluationDialog } from './evaluations.js';
import { customerBookingRows } from './customer-booking.js';
import { customerBookingTypes, customerRequestDialog } from './customer-ui.js';

const boss = { type: 'boss', id: 'boss' };
const managerA = { type: 'manager', id: 'm1' };
const managerB = { type: 'manager', id: 'm2' };
const frontA = { type: 'frontdesk', id: 'f1' };
const now = () => '2026-10-09T04:00:00.000Z';
const model = () => { const m = confirmedTestSchedules(new DemoModel({ now })); ensureEvaluations(m); return m; };
const ids = rows => rows.map(row => row.id).sort();
const serialize = m => JSON.stringify({ state: m.state, sequence: m.sequence });
const photo = () => ({ id: 'photo-a', name: '服务留底.png', width: 1, height: 1,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' });
const assessmentInput = (extra = {}) => ({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', type: 'followup', project: '阶段复评', therapistId: 't1', summary: '已与客户核对原始记录', metricName1: '客户自述运动次数', metricValue1: '8', metricUnit1: '次', requestId: 'assessment-a', ...extra });
const evaluationInput = (extra = {}) => ({ frontDeskId: 'f1', storeId: 'a', from: '2026-10-01', to: '2026-10-09', dataConclusion: 'met', receptionConclusion: 'improve', cashConclusion: 'unobserved', summary: '已核对接待资料', improvement: '补齐预约备注', dueDate: '2026-10-12', requestId: 'evaluation-a', ...extra });
function api(m) {
  assert.equal(typeof m.managerSnapshot, 'function', '尚未实现本店店长快照 API');
  assert.equal(typeof m.managerStoreId, 'function', '尚未实现实际店长账号门店校验');
  return m.managerSnapshot.bind(m);
}

test('active seeded managers resolve their own store and A sees only its own-store customers and work', () => {
  const m = model(), read = api(m);
  assert.equal(m.managerStoreId(managerA), 'a');
  assert.equal(m.managerStoreId(managerB), 'b');
  const snap = read(managerA);
  assert.equal(snap.storeId, 'a');
  assert.deepEqual(ids(snap.clients), ['c1', 'c3', 'c5', 'c6']);
  assert.deepEqual(ids(snap.appointments), ['a3', 'a4']);
  assert.deepEqual(ids(snap.services), []);
  assert.ok(snap.tasks.length >= 3);
  assert.ok(snap.tasks.every(row => row.clientId !== 'c2'));
  assert.equal(m.canSeeClient(managerA, 'c2'), false);
  assert.equal(m.canSeeClient(managerA, 'c1'), true);
});

test('B manager sees shared client c1 but no A work, while package balances include services across stores', () => {
  const m = model(), read = api(m), snap = read(managerB);
  assert.deepEqual(ids(snap.clients), ['c1', 'c2', 'c4']);
  assert.deepEqual(ids(snap.appointments), ['a1', 'a2']);
  assert.deepEqual(ids(snap.services), ['s1']);
  assert.equal(read(managerA).clients.find(row => row.id === 'c1').remaining, 9);
  assert.equal(snap.clients.find(row => row.id === 'c1').remaining, 9);
  assert.equal(snap.clients.find(row => row.id === 'c1').total, 10);
  assert.equal(snap.clients.find(row => row.id === 'c1').used, 1);
  assert.equal(snap.clients.find(row => row.id === 'c1').packageName, '运动功能恢复套餐');
  assert.ok(!snap.tasks.some(row => row.id === 'task1'), '客户跨店可见不能让 B 店读取 A 店负责人待办');
});

test('role payload cannot select a different store and unknown, inactive or invalid-store accounts are rejected', () => {
  const m = model(), read = api(m);
  assert.equal(read({ ...managerA, storeId: 'b', storeIds: ['b'] }).storeId, 'a');
  for (const role of [undefined, boss, frontA, { type: 'manager', id: 'not-real' }, { type: 'boss', id: 'm1' }]) {
    assert.throws(() => read(role), /权限|店长|账号|停用/);
  }
  m.state.storeManagers.find(row => row.id === 'm1').active = false;
  assert.throws(() => read(managerA), /权限|停用|店长|账号/);
  assert.equal(m.canSeeClient(managerA, 'c1'), false);
  m.state.storeManagers.find(row => row.id === 'm1').active = true;
  m.state.storeManagers.find(row => row.id === 'm1').storeId = 'missing';
  assert.throws(() => read(managerA), /门店|权限|店长/);
});

test('customer scores, comments and contact follow-ups remain exclusive to the boss', () => {
  const m = model(), read = api(m);
  const review = m.submitReview('s1', { score: 2, feedback: '秘密评价仅给老板', wantContact: true }, { type: 'customer', id: 'c1' });
  const task = m.state.tasks.find(row => row.reviewId === review.id);
  task.assigneeId = 't1'; // A historical misassignment must not expand access.
  task.title = '私密联系请求';
  for (const role of [managerA, managerB]) {
    const snap = read(role), json = JSON.stringify(snap);
    assert.deepEqual(m.reviewRows(role), []);
    assert.ok(!json.includes('秘密评价仅给老板'));
    assert.ok(!json.includes('私密联系请求'));
    assert.ok(!json.includes(review.id));
    assert.ok(!Object.hasOwn(snap, 'reviews'));
    assert.ok(!Object.hasOwn(snap, 'audit'));
    assert.ok(!snap.tasks.some(row => row.type === 'review_followup'));
  }
});

test('store photo access follows the individual service including revoked records, not shared-client ownership', () => {
  const m = model(), read = api(m);
  m.state.services[0].evidencePhotos = [{ id: 'private-b-photo', name: 'B 店留底', dataUrl: 'data:image/png;base64,test' }];
  assert.equal(m.canSeeEvidence(managerA, 's1'), false);
  assert.equal(m.canSeeEvidence(managerB, 's1'), true);
  assert.ok(!JSON.stringify(read(managerA)).includes('private-b-photo'));
  assert.ok(JSON.stringify(read(managerB)).includes('private-b-photo'));
  m.revokeService('s1', '登记重复，老板撤销', boss);
  assert.equal(m.canSeeEvidence(managerB, 's1'), true);
  assert.equal(m.canSeeEvidence(managerA, 's1'), false);
  assert.equal(read(managerB).services.find(row => row.id === 's1').status, 'revoked');
  assert.equal(read(managerA).clients.find(row => row.id === 'c1').remaining, 10);
});

test('snapshots are independent copies and omit private replay payloads from all nested business rows', () => {
  const m = model(), read = api(m);
  for (const kind of ['clients', 'packages', 'services', 'appointments', 'tasks', 'assessments']) {
    for (const row of m.state[kind]) { row.inputKey = 'PRIVATE_REQUEST_PAYLOAD'; row.requestId = 'PRIVATE_REPLAY_TOKEN'; }
  }
  const before = serialize(m), snap = read(managerB);
  assert.ok(!JSON.stringify(snap).includes('PRIVATE_REQUEST_PAYLOAD'));
  assert.ok(!JSON.stringify(snap).includes('PRIVATE_REPLAY_TOKEN'));
  snap.clients[0].name = '修改副本';
  snap.services[0].participantIds.push('forged');
  snap.clients[0].total = 999;
  snap.appointments.push({ id: 'forged' });
  if (snap.tasks.length) snap.tasks[0].title = '修改副本';
  if (snap.assessments.length) snap.assessments[0].metrics[0].value = '999';
  assert.equal(serialize(m), before);
});

test('snapshot dates validate calendar values and order; filtering appointments does not hide balances', () => {
  const m = model(), read = api(m);
  for (const filters of [{ from: '2026-02-30' }, { to: 'bad' }, { from: '2026-10-09', to: '2026-10-08' }]) {
    assert.throws(() => read(managerA, filters), /日期|开始|结束|范围/);
  }
  const snap = read(managerB, { from: '2026-10-10', to: '2026-10-10' });
  assert.deepEqual(ids(snap.appointments), ['a1']);
  assert.deepEqual(ids(snap.services), []);
  assert.equal(snap.clients.find(row => row.id === 'c1').remaining, 9);
});

test('manager cash reading cannot choose another store and returns scoped actual cash after refunds', () => {
  const m = model(); api(m);
  const a = m.recordReceipt({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', purpose: 'package', method: 'wechat', amount: '3000', requestId: 'cash-a' }, boss);
  m.refundReceipt({ receiptId: a.id, date: '2026-10-08', time: '10:00', amount: '100', reason: '退还多收款', requestId: 'refund-a' }, boss);
  m.recordReceipt({ clientId: 'c2', storeId: 'b', date: '2026-10-08', time: '09:00', purpose: 'package', method: 'cash', amount: '5000', requestId: 'cash-b' }, boss);
  m.recordReceipt({ storeId: 'a', date: '2026-10-08', time: '11:00', purpose: 'single', method: 'bank', channel: 'douyin', reference: 'DY-A-001', settlementStatus: 'pending', amount: '200', requestId: 'pending-a' }, boss);
  const summary = m.cashSummary({ from: '2026-10-08', to: '2026-10-08' }, managerA);
  assert.equal(summary.received, 3000);
  assert.equal(summary.refunded, 100);
  assert.equal(summary.net, 2900);
  assert.equal(summary.pending, 200);
  assert.ok(summary.receipts.every(row => row.storeId === 'a'));
  assert.ok(summary.refunds.every(row => row.storeId === 'a'));
  assert.throws(() => m.cashSummary({ storeId: 'b' }, managerA), /权限|本店|门店/);
});

test('settled platform parent is never counted twice and other-store pending receipts are excluded', () => {
  const m = model(), read = api(m);
  const parent = m.recordReceipt({ storeId: 'a', date: '2026-10-07', time: '09:00', purpose: 'single', method: 'bank', channel: 'douyin', reference: 'DY-A-OLD', settlementStatus: 'pending', amount: '200', requestId: 'pending-parent' }, boss);
  const child = m.settleReceipt(parent.id, { date: '2026-10-08', time: '09:00', amount: '190', reference: 'DY-A-PAID', notes: '平台扣除手续费', requestId: 'settled-child' }, boss);
  m.recordReceipt({ storeId: 'b', date: '2026-10-08', time: '09:00', purpose: 'single', method: 'bank', channel: 'meituan', reference: 'MT-B-PENDING', settlementStatus: 'pending', amount: '999', requestId: 'pending-other-store' }, boss);
  const snap = read(managerA, { from: '2026-10-08', to: '2026-10-08' });
  assert.equal(snap.cash.received, 190);
  assert.equal(snap.cash.net, 190);
  assert.equal(snap.cash.pending, 0);
  assert.deepEqual(ids(snap.receipts), [child.id]);
  assert.deepEqual(ids(snap.cash.receipts), [child.id]);
  assert.ok(!JSON.stringify(snap).includes('MT-B-PENDING'));
  assert.equal(read(managerA).receipts.find(row => row.id === parent.id).status, 'settled');
  const before = serialize(m);
  snap.cash.receipts[0].amount = 999999;
  snap.cash.channels[0].net = 999999;
  assert.equal(serialize(m), before, '现金摘要里的嵌套记录也必须是副本');
  assert.ok(!JSON.stringify(read(managerA)).includes('inputKey'));
});

test('all local assessment statuses remain traceable while shared clients never reveal another store assessment', () => {
  const m = model(), read = api(m);
  const pendingA = recordAssessment(m, assessmentInput(), frontA);
  const confirmedA = recordAssessment(m, assessmentInput({ requestId: 'confirmed-a', time: '10:00' }), boss);
  confirmAssessment(m, confirmedA.id, boss);
  const voidedA = recordAssessment(m, assessmentInput({ requestId: 'voided-a', time: '11:00' }), boss);
  voidAssessment(m, voidedA.id, '原记录重复', boss);
  const a = read(managerA), b = read(managerB);
  assert.deepEqual(a.assessments.filter(row => row.clientId === 'c1').map(row => row.status).sort(), ['confirmed', 'pending', 'voided']);
  assert.ok(a.assessments.some(row => row.id === pendingA.id && row.metrics[0].value === '8'));
  assert.ok(a.assessments.every(row => row.storeId === 'a'));
  assert.deepEqual(ids(b.assessments), ['assessment-example-b']);
  assert.ok(!JSON.stringify(a.assessments).includes('assessment-example-b'));
  const filtered = read(managerA, { from: '2026-10-09', to: '2026-10-09' });
  assert.equal(filtered.assessments.length, 0);
});

test('frontdesk assessment records are local and exclude their old cross-store audit-derived operation snapshot', () => {
  const m = model(), read = api(m);
  const a = recordFrontDeskEvaluation(m, evaluationInput(), boss);
  const b = recordFrontDeskEvaluation(m, evaluationInput({ frontDeskId: 'f2', storeId: 'b', summary: 'B 店考核内容', requestId: 'evaluation-b' }), boss);
  m.state.frontDeskEvaluations.find(row => row.id === a.id).snapshot.appointmentOperationIds = ['other-store-audit-secret'];
  const visibleA = read(managerA).frontDeskEvaluations;
  assert.deepEqual(ids(visibleA), [a.id]);
  assert.ok(!Object.hasOwn(visibleA[0], 'snapshot'));
  assert.ok(!JSON.stringify(visibleA).includes('other-store-audit-secret'));
  assert.deepEqual(ids(read(managerB).frontDeskEvaluations), [b.id]);
  voidFrontDeskEvaluation(m, a.id, '期间录错，保留原记录', boss);
  assert.equal(read(managerA).frontDeskEvaluations[0].status, 'voided');
});

test('linked task and explicit task store take priority over customer visibility or cross-store staff identity', () => {
  const m = model(), read = api(m);
  m.state.tasks.push(
    { id: 'a-task', clientId: 'c1', assigneeId: 't2', storeId: 'a', title: 'A 店协作待办', type: 'plan', dueDate: '2026-10-08', status: 'pending' },
    { id: 'b-task', clientId: 'c1', assigneeId: 't1', storeId: 'b', title: 'B 店专属待办', type: 'plan', dueDate: '2026-10-08', status: 'pending' },
    { id: 'b-appointment-task', clientId: 'c1', assigneeId: 't1', appointmentId: 'a1', title: 'B 店预约待办', type: 'reschedule', dueDate: '2026-10-08', status: 'pending' },
  );
  const a = read(managerA), b = read(managerB);
  assert.ok(a.tasks.some(row => row.id === 'a-task'));
  assert.ok(!a.tasks.some(row => ['b-task', 'b-appointment-task'].includes(row.id)));
  assert.ok(b.tasks.some(row => row.id === 'b-task'));
  assert.ok(b.tasks.some(row => row.id === 'b-appointment-task'));
  assert.ok(!b.tasks.some(row => row.id === 'a-task'));
});

test('cancelled and revoked local work keeps its customer readable without exposing that customer other-store records', () => {
  const m = model(), read = api(m);
  confirmTestShift(m, { therapistId: 't2', storeId: 'a', date: '2026-10-11' });
  const appointment = m.saveAppointment({ clientId: 'c2', storeId: 'a', date: '2026-10-11', time: '13:00', principalId: 't2', project: '基础训练' }, boss);
  m.cancelAppointment(appointment.id, '客户有事，保留原预约', boss);
  const snap = read(managerA);
  assert.equal(m.canSeeClient(managerA, 'c2'), true);
  assert.ok(snap.clients.some(row => row.id === 'c2'));
  assert.ok(snap.appointments.some(row => row.id === appointment.id && row.status === 'cancelled'));
  assert.ok(!snap.appointments.some(row => row.id === 'a2'));
  assert.ok(!snap.tasks.some(row => row.id === 'task3'));
});

test('team includes own employees and staff actually working locally without copying unrelated employees', () => {
  const m = model(), read = api(m);
  m.registerService({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', project: '基础训练', principalId: 't2', participantIds: ['t1'], notes: '本店跨店协作服务', evidencePhotos: [photo()], requestId: 'local-service' }, boss);
  const snap = read(managerA);
  assert.deepEqual(ids(snap.therapists), ['t1', 't2', 't3', 't5']);
  assert.deepEqual(ids(snap.frontDesks), ['f1']);
  assert.deepEqual(snap.services.map(row => [row.principalId, row.amount]), [['t2', 300]]);
  assert.equal(m.performance('t2'), 600, '全店跨店服务本来有两笔');
  assert.equal(m.performance('t2', { storeId: snap.storeId }), 300, '店长员工消费业绩应从本店服务追溯');
  assert.equal(snap.clients.find(row => row.id === 'c1').remaining, 8);
});

test('manager booking exception preserves denial of all unrelated writes without changing business state or IDs', () => {
  const m = model(); api(m);
  const receipt = m.recordReceipt({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', purpose: 'package', method: 'wechat', amount: '3000', requestId: 'write-denial-receipt' }, boss);
  const refund = m.refundReceipt({ receiptId: receipt.id, date: '2026-10-08', time: '10:00', amount: '100', reason: '多收款', requestId: 'write-denial-refund' }, boss);
  const pending = m.recordReceipt({ storeId: 'a', date: '2026-10-08', time: '11:00', purpose: 'single', method: 'bank', channel: 'douyin', reference: 'DY-write-denial', settlementStatus: 'pending', amount: '200', requestId: 'write-denial-platform' }, boss);
  const assessment = recordAssessment(m, assessmentInput(), boss);
  const evaluation = recordFrontDeskEvaluation(m, evaluationInput(), boss);
  const review = m.submitReview('s1', { score: 2, feedback: '只给老板', wantContact: true }, { type: 'customer', id: 'c1' });
  const entries = [
    ['registerService', () => m.registerService({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', project: '训练', principalId: 't1', participantIds: [], notes: '记录', evidencePhotos: [photo()], requestId: 'denied-service' }, managerA)],
    ['revokeService', () => m.revokeService('s1', '更正', managerA)],
    ['publishPlan', () => m.publishPlan('c1', { goal: '目标', phase: '阶段', nextStep: '训练', planNotes: '安排', homeAdvice: '练习' }, managerA)],
    ['saveAppointment-edit', () => m.saveAppointment({ id: 'a3', clientId: 'c3', storeId: 'a', date: '2026-10-12', time: '10:00', principalId: 't1', project: '基础训练' }, managerA)],
    ['saveAppointmentBatch', () => m.saveAppointmentBatch({ storeId: 'a', date: '2026-10-12', time: '10:00', project: '基础训练', items: [{ clientId: 'c1', principalId: 't1' }, { clientId: 'c5', principalId: 't5' }], requestId: 'denied-group' }, managerA)],
    ['cancelAppointment', () => m.cancelAppointment('a3', '更正', managerA)],
    ['markNoShow', () => m.markNoShow('a3', '未到店', managerA)],
    ['recordArrival', () => m.recordArrival('a3', { requestId: 'denied-arrival', notes: '到店' }, managerA)],
    ['requestReschedule', () => m.requestReschedule('a1', { date: '2026-10-12', time: '10:00', reason: '改约' }, managerA)],
    ['completeTask', () => m.completeTask('task1', managerA)],
    ['submitReview', () => m.submitReview('s1', { score: 5 }, managerA)],
    ['closeFollowup', () => m.closeFollowup(review.id, '回访完成', managerA)],
    ['recordReceipt', () => m.recordReceipt({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', purpose: 'package', method: 'wechat', amount: '3000', requestId: 'denied-cash' }, managerA)],
    ['settleReceipt', () => m.settleReceipt(pending.id, { date: '2026-10-08', time: '12:00', amount: '190', reference: 'paid', requestId: 'denied-settle' }, managerA)],
    ['refundReceipt', () => m.refundReceipt({ receiptId: receipt.id, date: '2026-10-08', time: '11:00', amount: '10', reason: '多收款', requestId: 'denied-refund' }, managerA)],
    ['voidReceipt', () => m.voidReceipt(pending.id, '错误', managerA)],
    ['voidRefund', () => m.voidRefund(refund.id, '错误', managerA)],
    ['renewPackage', () => m.renewPackage({ clientId: 'c6', name: '续套餐', amount: '3000', total: '10', reason: '续费', requestId: 'denied-renew' }, managerA)],
    ['activatePackage', () => m.activatePackage('p0', '切换', managerA)],
    ['addStore', () => m.addStore({ name: 'C店', address: '示例地址' }, managerA)],
    ['addTherapist', () => m.addTherapist({ name: '新康复师', storeId: 'a' }, managerA)],
    ['addFrontDesk', () => m.addFrontDesk({ name: '新前台', storeIds: ['a'] }, managerA)],
    ['deactivateFrontDesk', () => m.deactivateFrontDesk('f1', managerA)],
    ['deactivateTherapist', () => m.deactivateTherapist('t3', managerA)],
    ['transferClient', () => m.transferClient('c1', 't5', '转交', managerA)],
    ['importOpening', () => m.importOpening({ name: '新客户', phone: '13900000001', ownerId: 't1', storeId: 'a', amount: '3000', total: '10', remaining: '10', notes: '已核对纸质档案' }, managerA)],
    ['recordAssessment', () => recordAssessment(m, assessmentInput({ requestId: 'denied-assessment' }), managerA)],
    ['confirmAssessment', () => confirmAssessment(m, assessment.id, managerA)],
    ['voidAssessment', () => voidAssessment(m, assessment.id, '错误', managerA)],
    ['recordFrontDeskEvaluation', () => recordFrontDeskEvaluation(m, evaluationInput({ requestId: 'denied-evaluation' }), managerA)],
    ['voidFrontDeskEvaluation', () => voidFrontDeskEvaluation(m, evaluation.id, '错误', managerA)],
  ];
  const before = serialize(m);
  for (const [name, action] of entries) {
    assert.throws(action, /权限|仅|老板|查看|操作/, name);
    assert.equal(serialize(m), before, `${name} 被拒绝后不能改变记录或序列`);
  }
});

test('boss can create a manager bound to one real store, then disable that account while preserving history', () => {
  const m = model(); api(m);
  assert.equal(typeof m.addStoreManager, 'function', '尚未实现老板添加店长账号');
  assert.equal(typeof m.deactivateStoreManager, 'function', '尚未实现老板停用店长账号');
  const added = m.addStoreManager({ name: 'C 店店长', storeId: 'b' }, boss);
  const role = { type: 'manager', id: added.id };
  assert.equal(added.storeId, 'b');
  assert.equal(added.active, true);
  assert.equal(m.managerStoreId(role), 'b');
  assert.deepEqual(ids(m.managerSnapshot(role).services), ['s1']);
  const historyBefore = m.state.services.length;
  m.deactivateStoreManager(added.id, boss);
  assert.equal(m.state.storeManagers.find(row => row.id === added.id).active, false);
  assert.equal(m.state.services.length, historyBefore);
  assert.throws(() => m.managerSnapshot(role), /店长|停用|权限/);
  assert.equal(m.canSeeClient(role, 'c1'), false);
  assert.equal(m.canSeeEvidence(role, 's1'), false);
});

test('manager-account changes reject non-boss identities and invalid input without consuming IDs', () => {
  const m = model(); api(m);
  assert.equal(typeof m.addStoreManager, 'function', '尚未实现老板添加店长账号');
  assert.equal(typeof m.deactivateStoreManager, 'function', '尚未实现老板停用店长账号');
  const before = serialize(m);
  for (const role of [managerA, managerB, frontA, { type: 'therapist', id: 't1' }, { type: 'boss', id: 'm1' }]) {
    assert.throws(() => m.addStoreManager({ name: '伪造店长', storeId: 'a' }, role), /权限|老板/);
    assert.throws(() => m.deactivateStoreManager('m1', role), /权限|老板/);
    assert.equal(serialize(m), before);
  }
  assert.throws(() => m.addStoreManager({ name: '新店长', storeId: 'missing' }, boss), /门店/);
  assert.throws(() => m.addStoreManager({ name: '', storeId: 'a' }, boss), /姓名|店长|填写/);
  assert.equal(serialize(m), before);
});

const appSource = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = (m, role, view = 'manager-overview') => ({ model: m, role, view, filters: {}, esc, icon: () => '', fmt: { money: value => `¥${value}`, date: value => value } });
function sourceFunction(name, after) {
  const start = appSource.indexOf(`function ${name}(`), end = appSource.indexOf(after, start);
  assert.ok(start >= 0 && end > start, `找不到真实 app.js 的 ${name}`);
  return appSource.slice(start, end);
}
function appReaders(m, role) {
  let download;
  const find = (kind, id) => m.state[kind]?.find(row => row.id === id);
  const scope = { workflowTypes,workflowDialog,
    model: m, role, filters: {}, find, esc, ctx: () => ctx(m, role),
    managerDialog, receptionStores, receptionDialog, assertReceptionAppointment, appointmentBatchDialog, staffDialog, personnelDialog, cashDialog,
    assessmentRows, frontDeskEvaluationRows, evaluationDialog, customerBookingRows, paperIntakeRows, customerBookingTypes, customerRequestDialog,
    scheduleRows, scheduleRequestRows, bossScheduleNotifications, scheduleDialog,
    customerCtx: () => ({...ctx(m,role),ui:{}}),
    canEditPlan: () => false, Blob,
    URL: { createObjectURL: blob => { download = blob; return 'blob:test'; }, revokeObjectURL() {} },
    document: { createElement: () => ({ click() {} }) }, setTimeout() {}, toast() {},
  };
  const begin = appSource.indexOf('const evaluationTypes = '), end = appSource.indexOf('\nfunction draftKey(', begin);
  assert.ok(begin >= 0 && end > begin, '实际 app.js 对话分派代码缺失');
  vm.runInNewContext([
    sourceFunction('assertClient', '\nfunction assertBoss'),
    sourceFunction('assertBoss', '\nfunction assertStaff'),
    sourceFunction('assertStaff', '\nfunction assertService'),
    sourceFunction('assertService', '\nfunction toast'),
    appSource.slice(begin, end),
    sourceFunction('exportPreview', '\n// Use the layout breakpoint'),
    'globalThis.open = buildDialog; globalThis.download = exportPreview; globalThis.serviceGuard = assertService;',
  ].join('\n'), scope);
  return {
    dialog: (type, id) => scope.open(type, id),
    service: id => scope.serviceGuard(id),
    export: async () => { scope.download(); return JSON.parse(await download.text()).数据; },
  };
}

test('actual app export follows the manager snapshot instead of shared-client broader history', async () => {
  const m = model(); api(m);
  const review = m.submitReview('s1', { score: 2, feedback: '老板独有评价内容', wantContact: true }, { type: 'customer', id: 'c1' });
  m.state.tasks.find(row => row.reviewId === review.id).assigneeId = 't1';
  m.saveAppointmentBatch({ storeId: 'a', date: '2026-10-12', time: '10:00', project: '基础训练', items: [{ clientId: 'c1', principalId: 't1' }, { clientId: 'c5', principalId: 't5' }], requestId: 'SECRET-COMPANION-REQUEST' }, boss);
  const a = await appReaders(m, managerA).export(), b = await appReaders(m, managerB).export();
  assert.deepEqual(ids(a.clients), ['c1', 'c3', 'c5', 'c6']);
  assert.deepEqual(ids(a.services), []);
  assert.deepEqual(ids(b.services), ['s1']);
  for (const data of [a, b]) {
    assert.ok(!Object.hasOwn(data, 'reviews'));
    assert.ok(!Object.hasOwn(data, 'audit'));
    assert.ok(!Object.hasOwn(data, 'appointmentBatches'));
    assert.ok(!JSON.stringify(data).includes('老板独有评价内容'));
    assert.ok(!JSON.stringify(data).includes('SECRET-COMPANION-REQUEST'));
    assert.ok(!JSON.stringify(data).includes('inputKey'));
  }
  await assert.rejects(() => appReaders(m, { type: 'manager', id: 'unknown' }).export(), /权限|店长|账号/);
});

test('actual app denies legacy manager dialog routes and checks each requested service store', () => {
  const m = model(); api(m);
  const app = appReaders(m, managerA);
  for (const type of ['reset', 'reception-create-client', 'paper-intake-create', 'paper-intake-review', 'appointment-batch', 'register', 'edit-plan', 'appointment-edit', 'record-arrival', 'appointment-cancel', 'appointment-no-show', 'record-receipt', 'refund-receipt', 'settle-receipt', 'void-receipt', 'void-refund', 'transfer-client', 'revoke-service', 'renew-package', 'activate-package', 'import-opening', 'import-opening-batch', 'add-store', 'add-therapist', 'add-frontdesk', 'add-manager', 'deactivate-manager', 'assessment-create', 'assessment-confirm', 'frontdesk-evaluate', 'followup', 'review', 'plan-history', 'client-audit', 'service-detail', 'client-detail']) {
    assert.throws(() => app.dialog(type, 'c1'), /店长|只读|仅|权限|查看/, type);
  }
  assert.throws(() => app.service('s1'), /权限|本店|门店/);
  assert.equal(appReaders(m, managerB).service('s1').id, 's1');
  assert.ok(app.dialog('manager-client', 'c1').title.includes('陈一诺'));
  assert.throws(() => app.dialog('manager-client', 'c2'), /权限|本店|门店|记录/);
  assert.throws(() => app.dialog('manager-service', 's1'), /权限|本店|门店|记录/);
});

test('actual manager UI shows a compact local overview, local records and safe independent employee performance', () => {
  const m = model(); api(m);
  const service = m.registerService({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', project: '本店基础训练', principalId: 't2', participantIds: ['t1'], notes: '按计划完成本次训练', evidencePhotos: [photo()], requestId: 'ui-local-service' }, boss);
  m.submitReview('s1', { score: 2, feedback: '老板专属不能出现', wantContact: true }, { type: 'customer', id: 'c1' });
  for (const view of ['manager-overview', 'manager-clients', 'manager-records', 'manager-team']) {
    const html = renderManager(ctx(m, managerA, view));
    assert.ok(html.length > 100);
    assert.ok(!html.includes('老板专属不能出现'));
    assert.ok(!html.includes('许安然'));
    assert.ok(!html.includes('何知行'));
    assert.ok(!html.includes('data:image/'), '列表不能加载照片 bytes');
    assert.ok(!html.includes('data-form="register"'));
    assert.ok(!html.includes('data-form="record-receipt"'));
  }
  const staff = managerDialog('manager-employee', 'therapist:t2', ctx(m, managerA)).html;
  assert.ok(staff.includes('300'), '周亦宁本店消费业绩为 300');
  assert.ok(!staff.includes('600'), '跨店总业绩 600 不能冒充本店');
  assert.ok(!staff.includes('首次评估'), 'B 店服务不能列入本店员工明细');
  const detail = managerDialog('manager-service', service.id, ctx(m, managerA)).html;
  assert.ok(detail.includes('本店基础训练'));
  assert.ok(detail.includes('service-photo'));
  assert.ok(!detail.includes('data:image/'));
  assert.throws(() => managerDialog('manager-employee', 'therapist:t4', ctx(m, managerA)), /权限|本店|门店|记录/);
  assert.throws(() => managerDialog('manager-service', 's1', ctx(m, managerA)), /权限|本店|门店|记录/);
  assert.throws(() => managerDialog('manager-appointment', 'a1', ctx(m, managerA)), /权限|本店|门店|记录/);
});

test('all actual manager detail types display local data and deny foreign or unknown record identifiers', () => {
  const m = model(); api(m);
  const receiptA = m.recordReceipt({ clientId: 'c1', storeId: 'a', date: '2026-10-08', time: '09:00', purpose: 'package', method: 'wechat', amount: '3000', notes: '<script>unsafe-note</script>', requestId: 'detail-cash-a' }, boss);
  const receiptB = m.recordReceipt({ clientId: 'c2', storeId: 'b', date: '2026-10-08', time: '09:00', purpose: 'package', method: 'wechat', amount: '4000', requestId: 'detail-cash-b' }, boss);
  const refundA = m.refundReceipt({ receiptId: receiptA.id, date: '2026-10-08', time: '10:00', amount: '100', reason: '多收退款', requestId: 'detail-refund-a' }, boss);
  const refundB = m.refundReceipt({ receiptId: receiptB.id, date: '2026-10-08', time: '10:00', amount: '200', reason: 'B 店退款', requestId: 'detail-refund-b' }, boss);
  const assessmentA = recordAssessment(m, assessmentInput(), frontA);
  const evaluationA = recordFrontDeskEvaluation(m, evaluationInput(), boss);
  const evaluationB = recordFrontDeskEvaluation(m, evaluationInput({ frontDeskId: 'f2', storeId: 'b', requestId: 'detail-evaluation-b' }), boss);
  const context = ctx(m, managerA);
  const cases = [
    ['manager-client', 'c1', 'c2'],
    ['manager-appointment', 'a3', 'a1'],
    ['manager-receipt', receiptA.id, receiptB.id],
    ['manager-refund', refundA.id, refundB.id],
    ['manager-assessment', assessmentA.id, 'assessment-example-b'],
    ['manager-frontdesk-evaluation', evaluationA.id, evaluationB.id],
    ['manager-employee', 'frontdesk:f1', 'frontdesk:f2'],
  ];
  for (const [type, localId, foreignId] of cases) {
    const content = managerDialog(type, localId, context);
    assert.ok(content.title);
    assert.ok(content.html.includes('manager-detail'));
    assert.ok(!content.html.includes('<script>unsafe-note</script>'));
    assert.ok(!content.html.includes('data-form="record-receipt"'));
    assert.throws(() => managerDialog(type, foreignId, context), /权限|本店|门店|记录/, type);
    assert.throws(() => managerDialog(type, 'not-real', context), /权限|本店|门店|记录|人员/, type);
  }
  assert.ok(managerDialog('manager-receipt', receiptA.id, context).html.includes('&lt;script&gt;unsafe-note&lt;/script&gt;'));
  for (const role of [frontA, boss, { type: 'manager', id: 'missing' }]) {
    assert.throws(() => renderManager(ctx(m, role)), /权限|店长|账号/);
    assert.throws(() => managerDialog('manager-client', 'c1', ctx(m, role)), /权限|店长|账号/);
  }
});

 test('actual app permits manager local new-booking route while still rejecting a foreign client',()=>{const m=model(),app=appReaders(m,managerA);assert.match(app.dialog('appointment-create','c1').html,/data-form=\"appointment-create\"/);assert.throws(()=>app.dialog('appointment-create','c2'),/权限|本店|查看/);});

test('manager and therapist primary navigation each provide direct daily, booking, customer and business destinations',()=>{
 for(const [role,view,booking] of [[managerA,'manager-overview','manager-appointments'],[{type:'therapist',id:'t1'},'work','therapist-appointments']]){
  const scope={role,view,icon:()=>''};vm.runInNewContext(sourceFunction('navigation','\nfunction render')+'\nglobalThis.navigationHtml=navigation();',scope);
  const html=scope.navigationHtml;assert.equal((html.match(/data-action="nav"/g)||[]).length,4);assert.match(html,new RegExp(`data-id="${booking}"`));assert.doesNotMatch(html,/data-id="schedules"|data-id="manager-team"/);
 }
});
