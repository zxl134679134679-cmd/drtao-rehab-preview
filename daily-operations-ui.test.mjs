import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import { ensureSchedules } from './schedules.js';

let ui = {};
try { ui = await import('./daily-operations-ui.js'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const boss = { type: 'boss', id: 'boss' }, manager = { type: 'manager', id: 'm1' };
const front = { type: 'frontdesk', id: 'f1' }, otherFront = { type: 'frontdesk', id: 'f2' };
const ctx = (model, role = boss, filters = {}) => ({ model, role, filters });
const render = (context, options) => {
  assert.equal(typeof ui.renderDailyOperations, 'function', 'daily operations must render actual registered business records');
  return ui.renderDailyOperations(context, options);
};
const photo = () => [{ id: 'daily-ui-photo', name: '留底.png', width: 1, height: 1, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }];
function fixture() {
  const model = ensureSchedules(ensureStorePackageExamples(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T08:00:00.000Z' })));
  const receipt = model.recordReceipt({ clientId: 'c1', storeId: 'a', purpose: 'package', channel: 'direct', method: 'wechat', amount: '1000', date: model.today, time: '09:00', requestId: 'daily-receipt' }, front);
  model.refundReceipt({ receiptId: receipt.id, amount: '100', date: model.today, time: '09:30', reason: '核对后退款', requestId: 'daily-refund' }, boss);
  const arrange = (clientId, time) => model.saveAppointment({ clientId, storeId: 'a', date: model.today, time, principalId: 't1', project: '运动评估' }, front);
  const first = arrange('c3', '10:00'), second = arrange('c3', '11:00');
  model.recordArrival(first.id, { notes: '', requestId: 'daily-arrival-one' }, front);
  model.recordArrival(second.id, { notes: '', requestId: 'daily-arrival-two' }, front);
  model.registerService({ appointmentId: first.id, clientId: 'c3', storeId: 'a', date: model.today, time: '10:00', principalId: 't1', participantIds: ['t3'], project: first.project, notes: '实际完成本次评估', evidencePhotos: photo(), requestId: 'daily-service' }, { type: 'therapist', id: 't1' });
  const ownerArrival = arrange('c1', '13:00');
  model.recordArrival(ownerArrival.id, { notes: '', requestId: 'daily-boss-arrival' }, boss);
  model.createReceptionClient({ name: '本店新档案', phone: '13800000101', age: '30', problem: '想恢复跑步', storeId: 'a', ownerId: 't1', requestId: 'daily-new-file' }, front);
  model.createReceptionClient({ name: '另一门店新档案', phone: '13800000102', age: '28', problem: '日常活动不适', storeId: 'b', ownerId: 't2', requestId: 'daily-other-file' }, otherFront);
  model.recordReceipt({ clientId: 'c2', storeId: 'b', purpose: 'single', channel: 'direct', method: 'cash', amount: '700', date: model.today, time: '12:00', requestId: 'daily-other-receipt' }, otherFront);
  return model;
}
function row(html, attribute, id) {
  return html.match(new RegExp(`<div\\b[^>]*${attribute}="${id}"[^>]*>[\\s\\S]*?<\\/div>`))?.[0] || '';
}

test('daily card defaults to today and separates cash from completed services and actual front desk reception', () => {
  const model = fixture(), before = JSON.stringify([model.state, model.sequence]);
  const html = render(ctx(model, boss, { storeId: 'a' }));
  assert.match(html, /2026-10-09/);
  assert.match(html, /麦岛店/);
  assert.match(row(html, 'data-daily-stat', 'net-income'), /¥900\.00/);
  assert.match(row(html, 'data-daily-stat', 'service-count'), />1<small>\s*次/);
  assert.match(html, /实际净到账.*消费业绩|实际净到账[^<]*≠[^<]*消费业绩/);
  assert.match(row(html, 'data-daily-therapist', 't1'), /主服务 1 次.*协作 0 次/);
  assert.match(row(html, 'data-daily-therapist', 't3'), /主服务 0 次.*协作 1 次/);
  const reception = row(html, 'data-daily-frontdesk', 'f1');
  assert.match(reception, /实际接待 1 人/);
  assert.match(reception, /新建档 1 份/);
  assert.match(html, /新建档.*不代表到店|新建档.*≠.*到店/);
  assert.match(html, /老板.*登记.*不计入.*前台/);
  assert.match(html, /尚未登记的接待不计入/);
  assert.doesNotMatch(html, /另一门店新档案|data-daily-frontdesk="f2"|10%|30%|60%|提成/);
  assert.equal(JSON.stringify([model.state, model.sequence]), before);
});

test('daily card follows a selected period and store while treating therapist filter as a separate service view', () => {
  const model = fixture();
  const period = render(ctx(model, boss, { from: '2026-10-08', to: '2026-10-09', therapistId: 't5' }));
  assert.match(period, /期间店务/);
  assert.match(period, /2026-10-08.*2026-10-09/);
  assert.match(row(period, 'data-daily-stat', 'net-income'), /¥1,600\.00/);
  assert.match(row(period, 'data-daily-stat', 'service-count'), />2<small>\s*次/);
  assert.match(period, /店务按门店汇总.*不受康复师筛选/);
  assert.match(row(period, 'data-daily-frontdesk', 'f1'), /实际接待 1 人次.*新建档 1 份/);
  assert.match(period, /按各店每日去重累计/);
  assert.doesNotMatch(period, /期间人数/);
  const selected = render(ctx(model, boss, { storeId: 'a', from: model.today, to: model.today }));
  assert.match(selected, /每日店务/);
  assert.doesNotMatch(selected, /期间店务|data-daily-frontdesk="f2"/);
});

test('manager daily view is local and has no business action or private customer detail', () => {
  const model = fixture(), html = render(ctx(model, manager));
  assert.match(html, /麦岛店/);
  assert.match(row(html, 'data-daily-stat', 'net-income'), /¥900\.00/);
  assert.doesNotMatch(html, /崂山店|data-daily-frontdesk="f2"|data-action=|data-form=|<button|1380000|想恢复跑步/);
  assert.throws(() => render(ctx(model, manager, { storeId: 'b' })), /门店|权限/);
  assert.throws(() => render(ctx(model, { type: 'boss', id: 'forged' })), /老板|权限/);
  for (const role of [front, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }]) assert.equal(render(ctx(model, role)), '');
});

test('empty day stays zero and folded staff lists escape user entered employee names', () => {
  const model = fixture();
  model.updateFrontDesk({ id: 'f1', name: '<img src=x onerror=alert(1)>', storeIds: ['a'], active: true, phone: '', notes: '', reason: '更新展示名称', expectedVersion: 0, requestId: 'daily-ui-front-name' }, boss);
  const html = render(ctx(model, boss, { storeId: 'a', from: '2026-10-07', to: '2026-10-07' }));
  assert.match(row(html, 'data-daily-stat', 'net-income'), /¥0\.00/);
  assert.match(row(html, 'data-daily-stat', 'service-count'), />0<small>\s*次/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img|<details[^>]*\bopen\b/);
  assert.match(row(html, 'data-daily-frontdesk', 'f1'), /实际接待 0 人.*新建档 0 份/);
});

test('compact employee module keeps front desk counts visible without repeating the existing income hero', () => {
  const html = render(ctx(fixture(), boss, { storeId: 'a' }), { compact: true });
  assert.match(html, /每日员工工作/);
  assert.doesNotMatch(html, /data-daily-stat="net-income"|data-daily-stat="service-count"|¥900\.00/);
  assert.match(html, /<details[^>]*aria-label="康复师工作量"/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
  const outsideDetails = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
  assert.match(outsideDetails, /data-daily-frontdesk="f1"/);
  assert.match(outsideDetails, /实际接待 1 人.*新建档 1 份/);
});
