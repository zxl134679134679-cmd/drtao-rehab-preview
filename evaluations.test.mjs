import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';

const api = await import('./evaluations.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const fn = name => {
  assert.equal(typeof api[name], 'function', `尚未实现 ${name} 新功能`);
  return api[name];
};
const boss = { type: 'boss', id: 'boss' };
const frontA = { type: 'frontdesk', id: 'f1' };
const frontB = { type: 'frontdesk', id: 'f2' };
const therapistA = { type: 'therapist', id: 't1' };
const otherTherapist = { type: 'therapist', id: 't4' };
const customer = { type: 'customer', id: 'c3' };
const now = () => '2026-10-09T04:00:00.000Z';
function model() {
  const result = new DemoModel({ now });
  fn('ensureEvaluations')(result);
  result.state.assessments = [];
  result.state.frontDeskEvaluations = [];
  return result;
}
const assessment = (extra = {}) => ({
  clientId: 'c3', storeId: 'a', date: '2026-10-09', time: '10:00', type: 'initial',
  project: '运动功能记录', therapistId: 't1', summary: '客户与康复师当场核对的记录',
  metricName1: '客户自述下蹲测试完成次数', metricValue1: '5', metricUnit1: '次',
  requestId: 'assessment-request-1', ...extra,
});
const evaluation = (extra = {}) => ({
  frontDeskId: 'f1', storeId: 'a', from: '2026-10-01', to: '2026-10-09',
  dataConclusion: 'met', receptionConclusion: 'improve', cashConclusion: 'unobserved',
  summary: '已核对接待情况', improvement: '补齐预约备注', dueDate: '2026-10-12',
  requestId: 'evaluation-request-1', ...extra,
});
function ctx(m, role = boss) {
  return { model: m, role, filters: { storeId: 'a' }, esc: value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])), icon: () => '', fmt: { money: value => `¥${value}` } };
}

test('ensure preserves existing records and seeds only fictional client examples once', () => {
  const m = new DemoModel({ now });
  fn('ensureEvaluations')(m);
  assert.equal(m.state.assessments.length, 2);
  assert.equal(m.state.assessments.filter(row => row.status === 'pending').length, 1);
  assert.equal(m.state.assessments.filter(row => row.status === 'confirmed').length, 1);
  const before = JSON.stringify(m.state.assessments);
  fn('ensureEvaluations')(m);
  assert.equal(JSON.stringify(m.state.assessments), before);
  assert.deepEqual(m.state.frontDeskEvaluations, []);
});

test('ensure does not invent demo assessments for a custom client state', () => {
  const original = new DemoModel({ now });
  const state = JSON.parse(JSON.stringify(original.state));
  state.clients = state.clients.map(row => ({ ...row, name: `自定义${row.name}` }));
  const m = new DemoModel({ now, seed: false, state });
  fn('ensureEvaluations')(m);
  assert.deepEqual(m.state.assessments, []);
});

test('front desk can record only authorized-store clients and cannot assign unrelated assessors', () => {
  const m = model();
  const record = fn('recordAssessment')(m, assessment(), frontA);
  assert.equal(record.status, 'pending');
  assert.equal(record.recordedBy, 'f1');
  assert.equal(record.recordedRole, 'frontdesk');
  assert.equal(record.createdAt, '2026-10-09T04:00:00.000Z');
  assert.throws(() => fn('recordAssessment')(m, assessment({ storeId: 'b', requestId: 'wrong-store' }), frontA), /门店|权限/);
  assert.throws(() => fn('recordAssessment')(m, assessment({ clientId: 'c2', therapistId: 't2', requestId: 'wrong-client' }), frontA), /客户|权限/);
  assert.throws(() => fn('recordAssessment')(m, assessment({ therapistId: 't4', requestId: 'wrong-assessor' }), frontA), /评估|康复师|权限/);
  assert.throws(() => fn('recordAssessment')(m, assessment(), customer), /权限|前台|康复师/);
  m.state.frontDesks[0].active = false;
  assert.throws(() => fn('assessmentRows')(m, frontA), /权限|停用|前台/);
});

test('assessment submit retries return one record and changed retry data cannot overwrite it', () => {
  const m = model();
  const first = fn('recordAssessment')(m, assessment(), frontA);
  const duplicate = fn('recordAssessment')(m, assessment(), frontA);
  assert.equal(first.id, duplicate.id);
  assert.equal(m.state.assessments.length, 1);
  assert.throws(() => fn('recordAssessment')(m, assessment({ metricValue1: '6' }), frontA), /同一|重复|提交/);
  assert.equal(m.state.assessments[0].metrics[0].value, '5');
});

test('real metric text is retained while incomplete, invalid date and excessive fields are rejected', () => {
  const m = model();
  const row = fn('recordAssessment')(m, assessment({ metricValue1: '客户表示 5 次；本次未统一测试', metricName2: '记录方式', metricValue2: '当面自述' }), therapistA);
  assert.equal(row.metrics[0].value, '客户表示 5 次；本次未统一测试');
  assert.equal(row.metrics[1].value, '当面自述');
  assert.throws(() => fn('recordAssessment')(m, assessment({ metricValue1: '', requestId: 'incomplete' }), frontA), /指标|名称|数值|完整/);
  assert.throws(() => fn('recordAssessment')(m, assessment({ date: '2026-02-30', requestId: 'bad-date' }), frontA), /日期/);
  assert.throws(() => fn('recordAssessment')(m, assessment({ time: '25:00', requestId: 'bad-time' }), frontA), /时间/);
  assert.throws(() => fn('recordAssessment')(m, assessment({ metricValue1: 'x'.repeat(201), requestId: 'oversize' }), frontA), /长度|超过/);
});

test('customers see only their confirmed records and unrelated therapists cannot see another client', () => {
  const m = model();
  const row = fn('recordAssessment')(m, assessment(), frontA);
  assert.deepEqual(fn('assessmentRows')(m, customer), []);
  assert.equal(fn('latestConfirmedAssessment')(m, customer, 'c3'), null);
  assert.throws(() => fn('confirmAssessment')(m, row.id, frontA), /确认|康复师|权限/);
  assert.throws(() => fn('confirmAssessment')(m, row.id, otherTherapist), /确认|康复师|权限/);
  const confirmed = fn('confirmAssessment')(m, row.id, therapistA);
  assert.equal(confirmed.confirmedBy, 't1');
  assert.equal(fn('confirmAssessment')(m, row.id, therapistA).id, row.id);
  assert.equal(fn('assessmentRows')(m, customer).length, 1);
  assert.equal(fn('latestConfirmedAssessment')(m, customer, 'c3').id, row.id);
  assert.deepEqual(fn('assessmentRows')(m, otherTherapist), []);
  assert.deepEqual(fn('assessmentRows')(m, frontB), []);
  assert.throws(() => fn('assessmentRows')(m, customer, { clientId: 'c1' }), /权限|客户/);
});

test('confirmed assessment does not consume a session or change cash, performance or the existing plan', () => {
  const m = model();
  const before = JSON.stringify({ clients: m.state.clients, packages: m.state.packages, services: m.state.services, receipts: m.state.receipts, refunds: m.state.refunds });
  const balance = m.remaining('c3');
  const row = fn('recordAssessment')(m, assessment(), boss);
  fn('confirmAssessment')(m, row.id, boss);
  assert.equal(m.remaining('c3'), balance);
  assert.equal(JSON.stringify({ clients: m.state.clients, packages: m.state.packages, services: m.state.services, receipts: m.state.receipts, refunds: m.state.refunds }), before);
});

test('every new assessment and employee evaluation change leaves a real actor audit event', () => {
  const m = model();
  const row = fn('recordAssessment')(m, assessment(), frontA);
  fn('recordAssessment')(m, assessment(), frontA);
  fn('confirmAssessment')(m, row.id, therapistA);
  fn('voidAssessment')(m, row.id, '按原资料核对更正', boss);
  const review = fn('recordFrontDeskEvaluation')(m, evaluation(), boss);
  fn('recordFrontDeskEvaluation')(m, evaluation(), boss);
  fn('voidFrontDeskEvaluation')(m, review.id, '选错期间', boss);
  const changes = m.state.audit.filter(item => ['assessment_recorded', 'assessment_confirmed', 'assessment_voided', 'frontdesk_evaluation_recorded', 'frontdesk_evaluation_voided'].includes(item.type));
  assert.equal(changes.length, 5);
  assert.equal(changes.find(item => item.type === 'assessment_recorded').actorId, 'f1');
  assert.equal(changes.find(item => item.type === 'assessment_recorded').actorType, 'frontdesk');
  assert.equal(changes.find(item => item.type === 'assessment_confirmed').actorId, 't1');
  assert.equal(changes.find(item => item.type === 'assessment_voided').reason, '按原资料核对更正');
  assert.equal(changes.find(item => item.type === 'frontdesk_evaluation_recorded').frontDeskId, 'f1');
  assert.ok(changes.every(item => item.createdAt === '2026-10-09T04:00:00.000Z'));
});

test('boss voids with a reason, preserves the original metric and makes customer latest fall back', () => {
  const m = model();
  const first = fn('recordAssessment')(m, assessment(), boss);
  fn('confirmAssessment')(m, first.id, boss);
  const second = fn('recordAssessment')(m, assessment({ date: '2026-10-09', time: '11:00', type: 'followup', metricValue1: '6', requestId: 'second' }), boss);
  fn('confirmAssessment')(m, second.id, boss);
  assert.equal(fn('latestConfirmedAssessment')(m, customer, 'c3').id, second.id);
  assert.throws(() => fn('voidAssessment')(m, second.id, '录入重复', frontA), /老板|权限/);
  assert.throws(() => fn('voidAssessment')(m, second.id, '', boss), /原因/);
  fn('voidAssessment')(m, second.id, '原纸质记录核对发现录入重复', boss);
  assert.equal(m.state.assessments.length, 2);
  const kept = m.state.assessments.find(row => row.id === second.id);
  assert.equal(kept.metrics[0].value, '6');
  assert.equal(kept.status, 'voided');
  assert.equal(kept.voidReason, '原纸质记录核对发现录入重复');
  assert.equal(fn('latestConfirmedAssessment')(m, customer, 'c3').id, first.id);
  assert.throws(() => fn('confirmAssessment')(m, second.id, boss), /撤销|确认/);
  assert.throws(() => fn('voidAssessment')(m, second.id, '再次撤销', boss), /已撤销/);
});

test('front desk work uses Shanghai operation dates and does not attribute cross-store audit to a selected store', () => {
  const m = model();
  m.state.appointments.push(
    { id: 'arrive1', clientId: 'c3', storeId: 'a', arrivalBy: 'f1', arrivalByRole: 'frontdesk', arrivalAt: '2026-10-08T16:30:00Z' },
    { id: 'arrive2', clientId: 'c1', storeId: 'b', arrivalBy: 'f1', arrivalByRole: 'frontdesk', arrivalAt: '2026-10-09T01:00:00Z' },
    { id: 'boss-arrive', clientId: 'c3', storeId: 'a', arrivalBy: 'boss', arrivalByRole: 'boss', arrivalAt: '2026-10-09T01:00:00Z' },
  );
  m.state.audit.push(
    { id: 'op1', type: 'appointment_saved', actorType: 'frontdesk', actorId: 'f1', createdAt: '2026-10-08T16:15:00Z' },
    { id: 'op2', type: 'appointment_cancelled', actorType: 'frontdesk', actorId: 'f1', createdAt: '2026-10-09T02:00:00Z' },
    { id: 'other-op', type: 'appointment_saved', actorType: 'frontdesk', actorId: 'f2', createdAt: '2026-10-09T02:00:00Z' },
  );
  const row = fn('frontDeskWorkSummary')(m, boss, 'f1', { from: '2026-10-09', to: '2026-10-09', storeId: 'a' });
  assert.equal(row.arrivalCount, 1);
  assert.equal(row.appointmentOperationCount, 2);
  assert.equal(row.appointmentOperationScope, 'all-operated-stores');
  assert.equal(row.to, '2026-10-09');
  const defaultRange = fn('frontDeskWorkSummary')(m, frontA, 'f1');
  assert.equal(defaultRange.from, '2026-10-01');
  assert.equal(defaultRange.to, '2026-10-09');
  assert.throws(() => fn('frontDeskWorkSummary')(m, frontA, 'f2'), /本人|权限/);
  assert.throws(() => fn('frontDeskWorkSummary')(m, boss, 'f1', { storeId: 'b' }), /授权|门店/);
});

test('work totals count actual valid receipts once, excluding pending platform parents and wrong operators', () => {
  const m = model();
  m.state.receipts.push(
    { id: 'cash1', storeId: 'a', date: '2026-10-09', recordedRole: 'frontdesk', recordedBy: 'f1', status: 'valid', amountMinor: 10001 },
    { id: 'platform-parent', storeId: 'a', date: '2026-10-09', recordedRole: 'frontdesk', recordedBy: 'f1', status: 'pending_settlement', amountMinor: 99999 },
    { id: 'platform-child', parentReceiptId: 'platform-parent', storeId: 'a', date: '2026-10-09', recordedRole: 'frontdesk', recordedBy: 'f1', status: 'valid', amountMinor: 9000 },
    { id: 'void', storeId: 'a', date: '2026-10-09', recordedRole: 'frontdesk', recordedBy: 'f1', status: 'revoked', amountMinor: 10000 },
    { id: 'other', storeId: 'a', date: '2026-10-09', recordedRole: 'frontdesk', recordedBy: 'f2', status: 'valid', amountMinor: 40000 },
    { id: 'old', storeId: 'a', date: '2026-10-08', recordedRole: 'frontdesk', recordedBy: 'f1', status: 'valid', amountMinor: 40000 },
  );
  const row = fn('frontDeskWorkSummary')(m, frontA, 'f1', { from: '2026-10-09', to: '2026-10-09', storeId: 'a' });
  assert.equal(row.receiptCount, 2);
  assert.equal(row.receiptAmountMinor, 19001);
  assert.equal(row.receiptAmount, 190.01);
  assert.deepEqual(row.receiptIds, ['cash1', 'platform-child']);
});

test('boss records evaluations with immutable period snapshots; front desk cannot assess themselves or read others', () => {
  const m = model();
  assert.throws(() => fn('recordFrontDeskEvaluation')(m, evaluation(), frontA), /老板|权限/);
  const row = fn('recordFrontDeskEvaluation')(m, evaluation(), boss);
  assert.equal(row.frontDeskId, 'f1');
  assert.equal(row.snapshot.receiptCount, 0);
  m.state.receipts.push({ id: 'later', storeId: 'a', date: '2026-10-09', recordedRole: 'frontdesk', recordedBy: 'f1', status: 'valid', amountMinor: 30000 });
  const stored = fn('frontDeskEvaluationRows')(m, frontA, 'f1')[0];
  assert.equal(stored.snapshot.receiptCount, 0);
  assert.equal(stored.snapshot.receiptAmountMinor, 0);
  stored.snapshot.receiptCount = 999;
  assert.equal(fn('frontDeskEvaluationRows')(m, frontA, 'f1')[0].snapshot.receiptCount, 0);
  assert.throws(() => fn('frontDeskEvaluationRows')(m, frontB, 'f1'), /本人|权限/);
  assert.throws(() => fn('frontDeskEvaluationRows')(m, therapistA, 'f1'), /权限|老板|前台/);
});

test('evaluation retries preserve one historical record and reject altered conclusions', () => {
  const m = model();
  const first = fn('recordFrontDeskEvaluation')(m, evaluation(), boss);
  assert.equal(fn('recordFrontDeskEvaluation')(m, evaluation(), boss).id, first.id);
  assert.equal(m.state.frontDeskEvaluations.length, 1);
  assert.throws(() => fn('recordFrontDeskEvaluation')(m, evaluation({ dataConclusion: 'improve' }), boss), /同一|提交/);
  assert.throws(() => fn('recordFrontDeskEvaluation')(m, evaluation({ dueDate: '', requestId: 'missing-due' }), boss), /日期|改进/);
  assert.throws(() => fn('recordFrontDeskEvaluation')(m, evaluation({ dataConclusion: 'perfect', requestId: 'wrong-conclusion' }), boss), /结论|项目/);
  assert.throws(() => fn('recordFrontDeskEvaluation')(m, evaluation({ from: '2026-10-10', to: '2026-10-09', requestId: 'reversed-period' }), boss), /日期|期间|开始/);
  assert.throws(() => fn('recordFrontDeskEvaluation')(m, evaluation({ storeId: 'b', requestId: 'wrong-store' }), boss), /授权|门店/);
});

test('only boss can void employee evaluation; original conclusions and snapshot remain readable', () => {
  const m = model();
  const row = fn('recordFrontDeskEvaluation')(m, evaluation(), boss);
  assert.throws(() => fn('voidFrontDeskEvaluation')(m, row.id, '错误', frontA), /老板|权限/);
  assert.throws(() => fn('voidFrontDeskEvaluation')(m, row.id, '', boss), /原因/);
  const original = JSON.stringify(row.snapshot);
  fn('voidFrontDeskEvaluation')(m, row.id, '核对时选错期间，保留后重新记录', boss);
  const kept = fn('frontDeskEvaluationRows')(m, frontA, 'f1')[0];
  assert.equal(kept.status, 'voided');
  assert.equal(kept.dataConclusion, 'met');
  assert.equal(JSON.stringify(kept.snapshot), original);
  assert.equal(kept.voidReason, '核对时选错期间，保留后重新记录');
  assert.equal(m.state.frontDeskEvaluations.length, 1);
});

test('assessment UI escapes recorded text and only offers confirmation to eligible staff', () => {
  const m = model();
  const row = fn('recordAssessment')(m, assessment({ summary: '<script>客户资料</script>', metricValue1: '<img src=x onerror=alert(1)>' }), frontA);
  const frontHtml = fn('renderAssessmentHistory')(ctx(m, frontA), 'c3');
  assert.ok(frontHtml.includes('&lt;script&gt;客户资料&lt;/script&gt;'));
  assert.ok(!frontHtml.includes('<script>'));
  assert.ok(!frontHtml.includes('data-action="assessment-confirm"'));
  const therapistHtml = fn('renderAssessmentHistory')(ctx(m, therapistA), 'c3');
  assert.ok(therapistHtml.includes('data-action="assessment-confirm"'));
  const detail = fn('evaluationDialog')('assessment-detail', row.id, ctx(m, frontA));
  assert.ok(detail.html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.throws(() => fn('evaluationDialog')('assessment-detail', row.id, ctx(m, customer)), /权限|确认/);
  const create = fn('evaluationDialog')('assessment-create', 'c3', ctx(m, frontA));
  assert.ok(create.html.includes('data-form="assessment-create"'));
  assert.ok(create.html.includes('name="metricValue1"'));
  assert.ok(create.html.includes('data-action="close-dialog"'));
});

test('reception and employee UI keep scoped records and private evaluation details out of unrelated roles', () => {
  const m = model();
  fn('recordAssessment')(m, assessment(), frontA);
  const aHtml = fn('renderReceptionAssessments')(ctx(m, frontA), 'a');
  assert.ok(aHtml.includes('周沐'));
  assert.ok(!aHtml.includes('许安然'));
  assert.throws(() => fn('renderReceptionAssessments')(ctx(m, frontA), 'b'), /门店|权限/);
  const row = fn('recordFrontDeskEvaluation')(m, evaluation({ summary: '<b>核对说明</b>' }), boss);
  const work = fn('renderFrontDeskWork')(ctx(m, frontA), 'f1');
  assert.ok(work.includes('跨门店经办量'));
  assert.ok(!work.includes('个人销售额'));
  assert.ok(!work.includes('data-action="frontdesk-evaluate"'));
  const detail = fn('evaluationDialog')('frontdesk-evaluation-detail', row.id, ctx(m, frontA));
  assert.ok(detail.html.includes('&lt;b&gt;核对说明&lt;/b&gt;'));
  assert.throws(() => fn('evaluationDialog')('frontdesk-evaluation-detail', row.id, ctx(m, frontB)), /本人|权限/);
  const form = fn('evaluationDialog')('frontdesk-evaluate', 'f1', ctx(m));
  assert.ok(form.html.includes('data-form="frontdesk-evaluate"'));
  assert.ok(form.html.includes('name="dataConclusion"'));
  assert.equal(fn('evaluationDialog')('unrelated-dialog', '', ctx(m)), null);
});

test('employee work drawer remains usable when boss previous page selected another store', () => {
  const m = model();
  const context = ctx(m);
  context.filters.storeId = 'b';
  const html = fn('renderFrontDeskWork')(context, 'f1');
  assert.ok(html.includes('A店前台'));
  assert.ok(html.includes('按A店统计'));
});

test('assessment rejects same-day and cross-day future Shanghai times without saving or audit effects', () => {
  const m = new DemoModel({ today: '2026-10-10', now: () => '2026-10-09T01:00:00.000Z' });
  fn('ensureEvaluations')(m);
  m.state.assessments = [];
  const beforeAudit = JSON.stringify(m.state.audit);
  assert.throws(() => fn('recordAssessment')(m, assessment({ time: '23:59' }), frontA), /尚未发生|未来|时间/);
  assert.throws(() => fn('recordAssessment')(m, assessment({ date: '2026-10-10', time: '00:00', requestId: 'next-day' }), frontA), /尚未发生|未来|时间/);
  assert.equal(m.state.assessments.length, 0);
  assert.equal(JSON.stringify(m.state.audit), beforeAudit);
});

test('assessment accepts actual past and current Shanghai minute across UTC midnight boundaries', () => {
  const m = new DemoModel({ now: () => '2026-10-08T16:00:59.000Z' });
  fn('ensureEvaluations')(m);
  m.state.assessments = [];
  const prior = fn('recordAssessment')(m, assessment({ date: '2026-10-08', time: '23:59', requestId: 'prior-minute' }), frontA);
  const current = fn('recordAssessment')(m, assessment({ date: '2026-10-09', time: '00:00', requestId: 'current-minute' }), frontA);
  assert.equal(prior.date, '2026-10-08');
  assert.equal(current.time, '00:00');
  assert.throws(() => fn('recordAssessment')(m, assessment({ date: '2026-10-09', time: '00:01', requestId: 'next-minute' }), frontA), /尚未发生|未来|时间/);
});

test('confirmation prevents a pre-existing future pending assessment from reaching the customer', () => {
  const m = new DemoModel({ now: () => '2026-10-09T01:00:00.000Z' });
  fn('ensureEvaluations')(m);
  m.state.assessments = [];
  const prior = fn('recordAssessment')(m, assessment({ time: '08:59' }), frontA);
  // Represents an older saved pending record accepted by the pre-fix version.
  const stored = m.state.assessments.find(row => row.id === prior.id);
  stored.time = '23:59';
  const beforeAudit = JSON.stringify(m.state.audit);
  assert.throws(() => fn('confirmAssessment')(m, prior.id, therapistA), /尚未发生|未来|时间/);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.confirmedAt, undefined);
  assert.deepEqual(fn('assessmentRows')(m, customer), []);
  assert.equal(JSON.stringify(m.state.audit), beforeAudit);
  stored.date = '2026-10-10';
  stored.time = '00:00';
  assert.throws(() => fn('confirmAssessment')(m, prior.id, boss), /尚未发生|未来|时间/);
});

test('already saved and confirmed request retries retain their original record if local clock moves backward', () => {
  let clock = '2026-10-09T01:00:00.000Z';
  const m = new DemoModel({ now: () => clock });
  fn('ensureEvaluations')(m);
  m.state.assessments = [];
  const input = assessment({ time: '09:00' });
  const row = fn('recordAssessment')(m, input, frontA);
  const confirmed = fn('confirmAssessment')(m, row.id, therapistA);
  const beforeAudit = JSON.stringify(m.state.audit);
  clock = '2026-10-08T16:00:00.000Z';
  assert.equal(fn('recordAssessment')(m, input, frontA).id, row.id);
  assert.equal(fn('confirmAssessment')(m, row.id, therapistA).confirmedAt, confirmed.confirmedAt);
  assert.equal(m.state.assessments.length, 1);
  assert.equal(JSON.stringify(m.state.audit), beforeAudit);
});

test('assessment form defaults to the actual Shanghai date and minute even when demo date is later', () => {
  const m = new DemoModel({ today: '2026-10-10', now: () => '2026-10-09T01:07:45.000Z' });
  fn('ensureEvaluations')(m);
  m.state.assessments = [];
  const form = fn('evaluationDialog')('assessment-create', 'c3', ctx(m, frontA));
  assert.match(form.html, /name="date" value="2026-10-09"/);
  assert.match(form.html, /name="time" value="09:07"/);
});

test('assessment detail does not reopen itself and keeps one eligible confirmation action', () => {
  const m = model();
  const row = fn('recordAssessment')(m, assessment(), frontA);
  const detail = fn('evaluationDialog')('assessment-detail', row.id, ctx(m, therapistA));
  assert.ok(!detail.html.includes('data-action="assessment-detail"'));
  assert.equal((detail.html.match(/data-action="assessment-confirm"/g) || []).length, 1);
  assert.ok(fn('renderAssessmentHistory')(ctx(m, therapistA), 'c3').includes('data-action="assessment-detail"'));
});

test('confirmation form has a single submit action without reopening the same detail or form', () => {
  const m = model();
  const row = fn('recordAssessment')(m, assessment(), frontA);
  const confirm = fn('evaluationDialog')('assessment-confirm', row.id, ctx(m, therapistA));
  assert.ok(!confirm.html.includes('data-action="assessment-detail"'));
  assert.ok(!confirm.html.includes('data-action="assessment-confirm"'));
  assert.equal((confirm.html.match(/type="submit"/g) || []).length, 1);
});

test('employee evaluation detail does not reopen itself while keeping boss correction path', () => {
  const m = model();
  const row = fn('recordFrontDeskEvaluation')(m, evaluation(), boss);
  const detail = fn('evaluationDialog')('frontdesk-evaluation-detail', row.id, ctx(m));
  assert.ok(!detail.html.includes('data-action="frontdesk-evaluation-detail"'));
  assert.equal((detail.html.match(/data-action="frontdesk-evaluation-void"/g) || []).length, 1);
});
