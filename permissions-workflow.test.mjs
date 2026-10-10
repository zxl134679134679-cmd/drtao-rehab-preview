import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { savePaperIntake, reviewPaperIntake, paperIntakeRows, paperIntakeDialog, renderPaperIntakeList } from './paper-intake.js';
import { clientIntakeButton, receptionIntakeDialog } from './reception.js';
import { renderManager, managerDialog } from './manager.js';

const boss = { type: 'boss', id: 'boss' }, manager = { type: 'manager', id: 'm1' }, front = { type: 'frontdesk', id: 'f1' };
const fresh = () => new DemoModel({ now: () => '2026-10-09T03:00:00.000Z' });
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = (model, role, view = 'manager-overview') => ({ model, role, view, filters: { storeId: 'a' }, esc, icon: () => '', fmt: { money: n => `¥${n}`, date: n => n } });
const input = () => ({ clientId: 'c3', storeId: 'a', age: '32', problem: '跑步后膝部不舒服（虚构）', goal: '恢复日常活动', requestId: 'permission-intake', answers: Object.fromEntries(['treatment', 'acuteInjury', 'lumbar', 'dislocation', 'gout', 'pregnancy', 'alcohol', 'osteoporosis', 'veins', 'breathing'].map(key => [key, 'no'])) });
const unchanged = (model, fn) => { const before = JSON.stringify([model.state, model.sequence]); assert.throws(fn, /权限|店长|监管|复核/); assert.equal(JSON.stringify([model.state, model.sequence]), before); };

test('manager can supervise local intake but cannot create, review or replay a write', () => {
  const model = fresh(), row = savePaperIntake(model, input(), front);
  assert.equal(paperIntakeRows(model, manager)[0].id, row.id);
  assert.match(paperIntakeDialog('paper-intake-detail', row.id, ctx(model, manager)).html, /跑步后膝部/);
  unchanged(model, () => savePaperIntake(model, input(), manager));
  unchanged(model, () => paperIntakeDialog('paper-intake-create', 'c3', ctx(model, manager)));
  unchanged(model, () => reviewPaperIntake(model, row.id, { decision: 'assessment', nextStep: '安排评估', requestId: 'no-manager-review' }, manager));
});

test('manager client and intake surfaces keep sensitive writes unavailable including all booking writes', () => {
  const model = fresh(), row = savePaperIntake(model, input(), front);
  assert.equal(clientIntakeButton(ctx(model, manager)), '');
  unchanged(model, () => receptionIntakeDialog('reception-create-client', 'a', ctx(model, manager)));
  const pages = [renderManager(ctx(model, manager)), renderManager(ctx(model, manager, 'manager-clients')), managerDialog('manager-client', 'c3', ctx(model, manager)).html, receptionIntakeDialog('reception-client', 'c3', ctx(model, manager)).html, renderPaperIntakeList(ctx(model, manager)), paperIntakeDialog('paper-intake-detail', row.id, ctx(model, manager)).html];
  for (const html of pages) assert.doesNotMatch(html, /data-action="(?:reception-create-client|paper-intake-create|paper-intake-review)"|data-form="paper-intake-select"/);
  assert.doesNotMatch(pages[0], /data-action="appointment-create"/);
  assert.doesNotMatch(pages[0], /data-action="appointment-edit"|data-action="register"|data-action="cash-closing-confirm"/);
  assert.match(pages[4], /跑步后膝部/);
  assert.match(clientIntakeButton(ctx(model, front)), /新客户建档/);
  assert.match(renderPaperIntakeList(ctx(model, front)), /data-form="paper-intake-select"/);
});

test('verified boss can review and assign the next step with the actual boss identity preserved', () => {
  const model = fresh(), row = savePaperIntake(model, input(), front);
  assert.match(paperIntakeDialog('paper-intake-review', row.id, ctx(model, boss)).html, /data-form="paper-intake-review"/);
  const data = { decision: 'assessment', nextStep: '林予安核对后安排评估', assigneeId: 't1', dueDate: model.today, requestId: 'boss-intake-review' };
  const reviewed = reviewPaperIntake(model, row.id, data, boss);
  assert.equal(reviewed.reviewedBy, 'boss'); assert.equal(reviewed.reviewedRole, 'boss');
  assert.deepEqual(reviewed.answers, row.answers);
  const task = model.state.tasks.find(t => t.id === reviewed.review.taskId);
  assert.equal(task.createdRole, 'boss'); assert.equal(task.createdBy, 'boss'); assert.equal(task.assigneeId, 't1');
  assert.equal(model.state.audit.at(-1).actorType, 'boss');
  const detail = paperIntakeDialog('paper-intake-detail', row.id, ctx(model, front)).html;
  assert.match(detail, /已由老板复核/); assert.match(detail, /复核人 老板/);
  const before = JSON.stringify([model.state, model.sequence]);
  assert.equal(reviewPaperIntake(model, row.id, data, boss).id, row.id);
  assert.equal(JSON.stringify([model.state, model.sequence]), before);
  unchanged(model, () => reviewPaperIntake(model, row.id, { ...data, requestId: 'overwrite-boss-review' }, boss));
});

test('boss override validates identity, assignee and date before producing any records', () => {
  const model = fresh(), row = savePaperIntake(model, input(), front);
  const data = { decision: 'assessment', nextStep: '安排评估', assigneeId: 't1', dueDate: model.today, requestId: 'invalid-boss-review' };
  unchanged(model, () => reviewPaperIntake(model, row.id, data, { type: 'boss', id: 'fake' }));
  unchanged(model, () => reviewPaperIntake(model, row.id, data, front));
  const before = JSON.stringify([model.state, model.sequence]);
  assert.throws(() => reviewPaperIntake(model, row.id, { ...data, assigneeId: 't4' }, boss), /负责人|授权/);
  assert.throws(() => reviewPaperIntake(model, row.id, { ...data, dueDate: '2026-10-07' }, boss), /日期/);
  assert.equal(JSON.stringify([model.state, model.sequence]), before);
});
