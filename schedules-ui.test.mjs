import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';

let ui = {}, domain = {};
try { ui = await import('./schedules-ui.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
try { domain = await import('./schedules.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const call = (name, ...args) => { assert.equal(typeof ui[name], 'function', `${name} must implement staff scheduling UI`); return ui[name](...args); };
const roles = { boss: { type: 'boss', id: 'boss' }, manager: { type: 'manager', id: 'm1' }, frontdesk: { type: 'frontdesk', id: 'f1' }, therapist: { type: 'therapist', id: 't1' }, customer: { type: 'customer', id: 'c1' } };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const context = (model, role = roles.frontdesk, filters = {}) => ({ model, role, filters, esc, icon: () => '', fmt: { date: value => value }, view: 'schedules' });
const fresh = () => { const model = new DemoModel({ now: () => '2026-10-09T03:00:00.000Z' }); domain.ensureSchedules(model); return model; };

test('front desk can immediately read today\'s hours and rest status for authorized store only', () => {
  assert.equal(typeof ui.renderSchedulePage, 'function', 'visible scheduling page is missing');
  const html = call('renderSchedulePage', context(fresh()));
  assert.match(html, /康复师排班/); assert.match(html, /09:00/); assert.match(html, /休息/);
  assert.match(html, /林予安/); assert.match(html, /麦岛店/); assert.doesNotMatch(html, /周亦宁|何知行/);
  assert.match(html, /data-form="schedule-filters"/); assert.match(html, /name="date"/);
  assert.match(html, /申请调整/); assert.doesNotMatch(html, /data-action="schedule-edit"/);
});

test('boss and local manager see direct edit while therapist only sees their own read-only schedule', () => {
  assert.equal(typeof ui.renderSchedulePage, 'function');
  const model = fresh();
  const boss = call('renderSchedulePage', context(model, roles.boss));
  assert.match(boss, /data-action="schedule-edit"/); assert.match(boss, /周亦宁/);
  const manager = call('renderSchedulePage', context(model, roles.manager));
  assert.match(manager, /data-action="schedule-edit"/); assert.doesNotMatch(manager, /周亦宁|何知行/);
  const therapist = call('renderSchedulePage', context(model, roles.therapist));
  assert.match(therapist, /林予安/); assert.doesNotMatch(therapist, /苏晴|周亦宁|data-action="schedule-edit"|data-action="schedule-request"/);
  assert.throws(() => call('renderSchedulePage', context(model, roles.customer)), /权限|排班/);
});

test('tomorrow without a saved shift is visibly unassigned rather than assumed to be working', () => {
  assert.equal(typeof ui.renderSchedulePage, 'function');
  const html = call('renderSchedulePage', context(fresh(), roles.frontdesk, { scheduleDate: '2026-11-01' }));
  assert.match(html, /未排班/); assert.match(html, /2026-11-01/); assert.match(html, /先联系店长安排/);
});

test('shift and request dialogs retain version and half-hour choices, require reason and explain single approval', () => {
  assert.equal(typeof ui.scheduleDialog, 'function');
  const model = fresh();
  for (const [type, role, name] of [['schedule-edit', roles.manager, 'schedule-save'], ['schedule-request', roles.frontdesk, 'schedule-request']]) {
    const html = call('scheduleDialog', type, 't1|2026-10-09', context(model, role)).html;
    assert.match(html, new RegExp(`data-form="${name}"`));
    assert.match(html, /name="expectedVersion"/); assert.match(html, /name="therapistId" value="t1"/);
    assert.match(html, /value="09:30"/); assert.match(html, /value="19:30"/);
    assert.doesNotMatch(html, /type="time"|value="09:15"/);
    assert.match(html, /name="reason"[^>]*required[^>]*maxlength="500"/);
    assert.match(html, /老板或(?:本店)?店长/); assert.match(html, /系统内通知/); assert.match(html, /微信.*待正式接入/);
  }
  assert.throws(() => call('scheduleDialog', 'schedule-edit', 't1|2026-10-09', context(model)), /权限|老板|店长/);
  assert.throws(() => call('scheduleDialog', 'schedule-request', 't2|2026-10-09', context(model)), /权限|门店/);
});

test('rest controls hide and disable hour fields, preserving them for work mode and retry', () => {
  assert.equal(typeof ui.updateScheduleForm, 'function');
  const start = { disabled: false, required: true, value: '09:30' }, end = { disabled: false, required: true, value: '18:00' }, hours = { hidden: false }, explanation = { textContent: '' };
  const form = { dataset: { form: 'schedule-save' }, elements: { status: { value: 'rest' }, startTime: start, endTime: end }, querySelector: selector => selector === '[data-schedule-hours]' ? hours : selector === '[data-schedule-status-help]' ? explanation : null };
  call('updateScheduleForm', form, {});
  assert.equal(hours.hidden, true); assert.equal(start.disabled, true); assert.equal(end.required, false); assert.match(explanation.textContent, /休息/);
  form.elements.status.value = 'work'; call('updateScheduleForm', form, {});
  assert.equal(hours.hidden, false); assert.equal(start.disabled, false); assert.equal(end.required, true); assert.equal(start.value, '09:30'); assert.equal(end.value, '18:00');
});

test('workbench summaries provide schedule navigation without exposing another therapist', () => {
  assert.equal(typeof ui.renderScheduleSummary, 'function');
  const model = fresh(), html = call('renderScheduleSummary', context(model, roles.therapist));
  assert.match(html, /data-action="nav" data-id="schedules"/); assert.match(html, /本人/); assert.match(html, /09:00/); assert.doesNotMatch(html, /苏晴|周亦宁/);
  assert.equal(call('renderScheduleSummary', context(model, roles.customer)), '');
});

test('front desk with two authorized stores can request a change for the selected second store', () => {
  const model = fresh(); model.state.frontDesks.find(row => row.id === 'f1').storeIds = ['a', 'b'];
  const selected = context(model, roles.frontdesk, { storeId: 'b' });
  const page = call('renderSchedulePage', selected); assert.match(page, /周亦宁/); assert.doesNotMatch(page, /林予安/);
  const html = call('scheduleDialog', 'schedule-request', `t2|${model.today}`, selected).html;
  assert.match(html, /周亦宁/); assert.match(html, /name="storeId" value="b"/);
  assert.throws(() => call('scheduleDialog', 'schedule-request', `t2|${model.today}`, context(fresh())), /权限|门店/);
});

test('past dates remain visible but do not invite staff to modify historical shifts', () => {
  const model = fresh(), past = '2026-10-07';
  for (const role of [roles.boss, roles.manager, roles.frontdesk]) {
    const html = call('renderSchedulePage', context(model, role, { scheduleDate: past }));
    assert.match(html, /历史排班.*只读/); assert.doesNotMatch(html, /data-action="schedule-(edit|request)"/);
    assert.throws(() => call('scheduleDialog', role.type === 'frontdesk' ? 'schedule-request' : 'schedule-edit', `t1|${past}`, context(model, role)), /历史|过去/);
  }
});

test('boss notifications and pending decisions stay in browsable lists with honest delivery status', () => {
  assert.equal(typeof ui.renderScheduleInbox, 'function');
  const model = fresh(), row = domain.requestScheduleChange(model, { storeId: 'a', therapistId: 't1', date: model.today, status: 'work', startTime: '09:30', endTime: '19:00', reason: '虚构示例：调整上班时间', expectedVersion: domain.scheduleStatus(model, 't1', model.today).version, requestId: 'ui-request' }, roles.frontdesk);
  assert.match(call('renderScheduleInbox', context(model, roles.manager)), /待审批.*1|1.*待审批/);
  const decision = call('scheduleDialog', 'schedule-decision', row.id, context(model, roles.manager)).html;
  assert.match(decision, /data-form="schedule-decision"/); assert.match(decision, /value="approved"/); assert.match(decision, /value="rejected"/);
  assert.match(decision, /09:30/); assert.match(decision, /虚构示例：调整上班时间/);
  domain.decideScheduleChange(model, row.id, { decision: 'approved', reason: '确认安排', requestId: 'ui-decision' }, roles.manager);
  const notifications = domain.bossScheduleNotifications(model, roles.boss);
  const inbox = call('renderScheduleInbox', context(model, roles.boss));
  assert.match(inbox, /排班变更通知/); assert.match(inbox, /未读.*1|1.*未读/); assert.match(inbox, /09:30/);
  const detail = call('scheduleDialog', 'schedule-notification', notifications.at(-1).id, context(model, roles.boss)).html;
  assert.match(detail, /变更前/); assert.match(detail, /变更后/); assert.match(detail, /确认安排|虚构示例：调整上班时间/);
  assert.match(detail, /批准说明/); assert.match(detail, /确认安排/);
  assert.match(detail, /data-action="schedule-notification-read"/); assert.match(detail, /微信.*待正式接入/); assert.doesNotMatch(detail, /微信.*已送达/);
  assert.equal(call('renderScheduleInbox', context(model, roles.therapist)), '');
  assert.throws(() => call('scheduleDialog', 'schedule-notification', notifications[0].id, context(model, roles.frontdesk)), /权限|老板/);
});
