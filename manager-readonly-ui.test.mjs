import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { ensureSchedules, scheduleStatus, scheduleRows, scheduleRequestRows, requestScheduleChange, saveSchedule, decideScheduleChange, bossScheduleNotifications } from './schedules.js';
import { renderSchedulePage, renderScheduleInbox, scheduleDialog } from './schedules-ui.js';
import { cashDialog, renderCashClosingSummary } from './cash.js';

const boss = { type: 'boss', id: 'boss' };
const manager = { type: 'manager', id: 'm1' };
const front = { type: 'frontdesk', id: 'f1' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const context = (model, role) => ({ model, role, filters: {}, esc, icon: () => '' });
const fixture = () => ensureSchedules(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T08:00:00.000Z' }));
const proposal = model => ({ therapistId: 't1', storeId: 'a', date: model.today, status: 'work', startTime: '09:00', endTime: '18:30', reason: '晚间培训调整下班时间', expectedVersion: scheduleStatus(model, 't1', model.today).version, requestId: 'readonly-request' });
const unchanged = (model, operation) => {
  const before = JSON.stringify([model.state, model.sequence]);
  assert.throws(operation, /老板|前台|只读|查看|权限/);
  assert.equal(JSON.stringify([model.state, model.sequence]), before);
};

test('local manager can monitor schedule and pending proposal without any modification or approval entry', () => {
  const model = fixture();
  requestScheduleChange(model, proposal(model), front);
  const page = renderSchedulePage(context(model, manager));
  const inbox = renderScheduleInbox(context(model, manager));
  assert.match(page, /林予安/);
  assert.match(page, /09:00–19:00/);
  assert.match(page, /晚间培训调整下班时间/);
  assert.doesNotMatch(page, /周亦宁|何知行/);
  for (const html of [page, inbox]) {
    assert.doesNotMatch(html, /data-action="schedule-(edit|request|decision)"|data-form="schedule-(save|request|decision)"/);
    assert.doesNotMatch(html, /您或老板任一人批准|老板或本店店长任一人批准/);
    assert.match(html, /老板/);
  }
});

test('manager cannot open schedule write dialogs even by supplying a real pending request ID', () => {
  const model = fixture(), row = requestScheduleChange(model, proposal(model), front);
  for (const [type, id] of [['schedule-edit', `t1|${model.today}`], ['schedule-request', `t1|${model.today}`], ['schedule-decision', row.id]]) {
    unchanged(model, () => scheduleDialog(type, id, context(model, manager)));
  }
});

test('manager schedule API calls cannot save or decide while local read projections remain available', () => {
  const model = fixture(), input = proposal(model), row = requestScheduleChange(model, input, front);
  unchanged(model, () => saveSchedule(model, { ...input, requestId: 'manager-save' }, manager));
  for (const decision of ['approved', 'rejected']) {
    unchanged(model, () => decideScheduleChange(model, row.id, { decision, reason: '店长尝试处理', requestId: `manager-${decision}` }, manager));
  }
  unchanged(model, () => requestScheduleChange(model, { ...input, requestId: 'manager-request' }, manager));
  assert.equal(scheduleRows(model, manager, { date: model.today }).length, 3);
  assert.equal(scheduleRequestRows(model, manager)[0].status, 'pending');
});

test('front desk proposes and boss approval alone changes hours and retains the boss notification', () => {
  const model = fixture(), row = requestScheduleChange(model, proposal(model), front);
  assert.equal(scheduleStatus(model, 't1', model.today).endTime, '19:00');
  assert.equal(bossScheduleNotifications(model, boss).length, 0);
  const requestHtml = scheduleDialog('schedule-request', `t1|${model.today}`, context(model, front)).html;
  assert.match(requestHtml, /data-form="schedule-request"/);
  assert.doesNotMatch(requestHtml, /老板或本店店长任一人批准|老板／店长审批/);
  const approval = scheduleDialog('schedule-decision', row.id, context(model, boss)).html;
  assert.match(approval, /data-form="schedule-decision"/);
  decideScheduleChange(model, row.id, { decision: 'approved', reason: '老板核对后批准', requestId: 'boss-readonly-approval' }, boss);
  assert.equal(scheduleStatus(model, 't1', model.today).endTime, '18:30');
  const notice = bossScheduleNotifications(model, boss)[0];
  assert.equal(notice.changedBy, 'f1');
  assert.equal(notice.approvedBy, 'boss');
  assert.equal(notice.wechatStatus, 'pending_integration');
});

test('manager monitors a balanced submitted daily closing without save or confirmation controls', () => {
  const model = fixture();
  model.recordReceipt({ clientId: 'c1', storeId: 'a', purpose: 'single', channel: 'direct', method: 'wechat', amount: '300', date: model.today, time: '09:00', requestId: 'manager-readonly-receipt' }, front);
  const closing = model.saveCashClosing({ storeId: 'a', date: model.today, actualWechat: '300', actualAlipay: '0', actualCash: '0', actualBank: '0', notes: '前台已核对', version: 0, requestId: 'manager-readonly-closing' }, front);
  const before = JSON.stringify([model.state, model.sequence]);
  const html = cashDialog('cash-closing', JSON.stringify({ storeId: 'a', date: model.today }), context(model, manager)).html;
  assert.match(html, /¥300\.00/);
  assert.match(html, /前台已核对/);
  assert.match(html, /data-form="cash-closing-select"/);
  assert.doesNotMatch(html, /data-action="cash-closing-confirm"|data-form="cash-closing"|name="actualWechat"/);
  assert.match(html, /老板/);
  unchanged(model, () => cashDialog('cash-closing-confirm', closing.id, context(model, manager)));
  assert.throws(() => cashDialog('cash-closing', JSON.stringify({ storeId: 'b', date: model.today }), context(model, manager)), /门店|权限/);
  const summary = renderCashClosingSummary(context(model, manager));
  assert.match(summary, /麦岛店/);
  assert.doesNotMatch(summary, /崂山店|由老板或店长确认/);
  assert.equal(JSON.stringify([model.state, model.sequence]), before);
  assert.match(cashDialog('cash-closing-confirm', closing.id, context(model, boss)).html, /data-form="cash-closing-confirm"/);
});
