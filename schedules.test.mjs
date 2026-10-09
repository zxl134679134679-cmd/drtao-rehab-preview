import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';

let api = {};
try { api = await import('./schedules.js'); } catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const call = (name, ...args) => { assert.equal(typeof api[name], 'function', `${name} must implement the scheduling workflow`); return api[name](...args); };
const fresh = () => new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T03:00:00.000Z' });
const boss = { type: 'boss', id: 'boss' }, manager = { type: 'manager', id: 'm1' }, front = { type: 'frontdesk', id: 'f1' };
const input = overrides => ({ therapistId: 't1', storeId: 'a', date: '2026-10-09', status: 'work', startTime: '09:00', endTime: '18:30', reason: '晚间培训调整下班时间', expectedVersion: 1, requestId: 'schedule-save-1', ...overrides });
const init = () => { const model = fresh(); call('ensureSchedules', model); return model; };
const unchanged = (model, fn, pattern) => { const before = JSON.stringify([model.state, model.sequence]); assert.throws(fn, pattern); assert.equal(JSON.stringify([model.state, model.sequence]), before); };
const business = model => JSON.stringify([model.state.clients, model.state.packages, model.state.receipts, model.state.refunds, model.state.services, model.state.appointments, model.state.tasks, model.state.reviews]);

test('preview initializes fourteen days of home-store schedules once, while loaded state gets no invented schedule', () => {
  const model = init(); assert.equal(model.state.staffSchedules.length, 70);
  assert.equal(call('scheduleStatus', model, 't1', '2026-10-09').startTime, '09:00'); assert.equal(call('scheduleStatus', model, 't1', '2026-10-22').endTime, '19:00');
  assert.equal(call('scheduleStatus', model, 't5', '2026-10-09').status, 'rest'); assert.equal(call('scheduleStatus', model, 't5', '2026-10-10').status, 'work');
  const before = JSON.stringify([model.state, model.sequence]); call('ensureSchedules', model); assert.equal(JSON.stringify([model.state, model.sequence]), before);
  const loaded = new DemoModel({ state: fresh().state, today: '2026-10-09' }); call('ensureSchedules', loaded); assert.deepEqual(loaded.state.staffSchedules, []);
});

test('unknown dates stay unassigned and reading schedule cannot alter stored fields', () => {
  const model = init(), unknown = call('scheduleStatus', model, 't1', '2026-10-23'); assert.equal(unknown.status, 'unassigned'); assert.equal(unknown.version, 0);
  const row = call('scheduleStatus', model, 't1', '2026-10-09'); row.endTime = '01:00'; assert.equal(call('scheduleStatus', model, 't1', '2026-10-09').endTime, '19:00');
  assert.throws(() => call('scheduleStatus', model, 'missing', '2026-10-09'), /在职|康复师/);
});

test('schedule visibility resolves actual active accounts and ignores claimed store scope', () => {
  const model = init(); assert.equal(call('scheduleRows', model, boss, { date: model.today }).length, 5);
  assert.deepEqual(call('scheduleRows', model, { ...manager, storeId: 'b' }, { date: model.today }).map(x => x.therapistId), ['t1', 't3', 't5']);
  assert.deepEqual(call('scheduleRows', model, front, { date: model.today }).map(x => x.storeId), ['a', 'a', 'a']);
  assert.equal(call('scheduleRows', model, { type: 'therapist', id: 't2' }, { date: model.today }).length, 1);
  assert.deepEqual(call('scheduleRows', model, { type: 'customer', id: 'c1' }), []);
  assert.deepEqual(call('scheduleRows', model, front, { storeId: 'b' }), []);
  for (const role of [{ type: 'boss', id: 'fake' }, { type: 'manager', id: 'fake' }, { type: 'frontdesk', id: 'fake' }, { type: 'therapist', id: 'fake' }]) unchanged(model, () => call('scheduleRows', model, role), /权限|老板|在职|停用/);
  model.state.storeManagers[0].active = false; assert.throws(() => call('scheduleRows', model, manager), /在职|停用|权限/);
});

test('boss and local manager apply changes directly, making one audit and one boss notification without touching business balances', () => {
  const model = init(), before = business(model), row = call('saveSchedule', model, input(), manager);
  assert.equal(row.endTime, '18:30'); assert.equal(row.version, 2); assert.equal(row.changedBy, 'm1'); assert.equal(row.changedRole, 'manager');
  assert.equal(business(model), before); assert.equal(model.state.scheduleNotifications.length, 1);
  const notice = call('bossScheduleNotifications', model, boss)[0]; assert.equal(notice.before.endTime, '19:00'); assert.equal(notice.after.endTime, '18:30'); assert.equal(notice.approvedBy, 'm1'); assert.equal(notice.reason, '晚间培训调整下班时间'); assert.equal(notice.wechatStatus, 'pending_integration'); assert.equal(notice.createdAt, '2026-10-09T03:00:00.000Z');
  assert.equal(model.state.audit.at(-1).type, 'schedule_changed'); assert.equal(model.state.audit.at(-1).actorType, 'manager');
  const rest = call('saveSchedule', model, input({ therapistId: 't3', status: 'rest', startTime: '09:00', endTime: '18:30', requestId: 'rest' }), boss); assert.equal(rest.status, 'rest'); assert.equal(rest.startTime, ''); assert.equal(rest.endTime, '');
});

test('front desk and therapists cannot directly change schedules and managers cannot change another store', () => {
  const model = init();
  for (const role of [front, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, { type: 'boss', id: 'fake' }]) unchanged(model, () => call('saveSchedule', model, input(), role), /老板|店长|权限/);
  unchanged(model, () => call('saveSchedule', model, input({ therapistId: 't2', storeId: 'b' }), manager), /本店|门店|权限/);
  unchanged(model, () => call('saveSchedule', model, input({ storeId: 'b' }), manager), /本店|门店|权限/);
  model.state.therapists[0].active = false; unchanged(model, () => call('saveSchedule', model, input(), boss), /在职|停用/);
  model.state.therapists[0].active = true; model.state.stores[0].active = false; unchanged(model, () => call('saveSchedule', model, input(), boss), /停用|门店/);
});

test('invalid, past, incomplete and non-half-hour shifts are rejected before any mutation', () => {
  const model = init();
  for (const change of [{ date: '2026-10-08' }, { date: '2026-02-30' }, { date: 'bad' }, { status: 'unknown' }, { startTime: '09:15' }, { endTime: '25:00' }, { endTime: '09:00' }, { endTime: '08:30' }, { startTime: '' }, { reason: '' }, { requestId: '' }, { expectedVersion: '' }, { expectedVersion: -1 }, { expectedVersion: 1.2 }]) unchanged(model, () => call('saveSchedule', model, input(change), boss), /日期|过去|上班|排班|时间|原因|提交|版本/);
});

test('initial schedule on an unassigned day uses version zero and advances to one', () => {
  const model = init(), row = call('saveSchedule', model, input({ date: '2026-10-23', expectedVersion: 0 }), boss);
  assert.equal(row.version, 1); assert.equal(row.date, '2026-10-23'); assert.equal(call('bossScheduleNotifications', model, boss)[0].before.status, 'unassigned');
});

test('replay of an applied save is idempotent but reusing its token with changed content is rejected', () => {
  const model = init(), row = call('saveSchedule', model, input(), manager), before = JSON.stringify([model.state, model.sequence]);
  assert.equal(call('saveSchedule', model, input(), manager).id, row.id); assert.equal(JSON.stringify([model.state, model.sequence]), before);
  unchanged(model, () => call('saveSchedule', model, input({ endTime: '18:00' }), manager), /提交|变化/);
  unchanged(model, () => call('saveSchedule', model, input({ requestId: 'new', expectedVersion: 1 }), manager), /更新|变化|版本/);
});

test('unchanged shifts do not fabricate a change, and a submit token cannot be reused across actions or requests', () => {
  const model = init(); unchanged(model, () => call('saveSchedule', model, input({ endTime: '19:00' }), manager), /没有变化|未变化/);
  call('saveSchedule', model, input(), manager);
  unchanged(model, () => call('saveSchedule', model, input({ therapistId: 't3' }), manager), /提交|变化/);
  const a = call('requestScheduleChange', model, input({ therapistId: 't3', requestId: 'request-one' }), front), b = call('requestScheduleChange', model, input({ therapistId: 't5', status: 'work', requestId: 'request-two' }), front);
  call('decideScheduleChange', model, a.id, { decision: 'approved', reason: '同意', requestId: 'decision' }, manager);
  unchanged(model, () => call('decideScheduleChange', model, b.id, { decision: 'approved', reason: '同意', requestId: 'decision' }, manager), /提交|用于|变化/);
});

test('front desk submits a scoped pending proposal without applying it or making a change notification', () => {
  const model = init(), before = business(model), request = call('requestScheduleChange', model, input(), front);
  assert.equal(request.status, 'pending'); assert.equal(request.requestedBy, 'f1'); assert.equal(request.before.version, 1); assert.equal(request.after.endTime, '18:30');
  assert.equal(call('scheduleStatus', model, 't1', model.today).endTime, '19:00'); assert.equal(business(model), before); assert.equal(model.state.scheduleNotifications.length, 0);
  assert.equal(model.state.audit.at(-1).type, 'schedule_change_requested');
  const stateBefore = JSON.stringify([model.state, model.sequence]); assert.equal(call('requestScheduleChange', model, input(), front).id, request.id); assert.equal(JSON.stringify([model.state, model.sequence]), stateBefore);
  unchanged(model, () => call('requestScheduleChange', model, input({ reason: '换原因' }), front), /提交|变化/);
});

test('only authorized front desk may request changes for its own-store therapist', () => {
  const model = init();
  for (const role of [boss, manager, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, { type: 'frontdesk', id: 'fake' }]) unchanged(model, () => call('requestScheduleChange', model, input(), role), /前台|权限|停用/);
  unchanged(model, () => call('requestScheduleChange', model, input({ therapistId: 't2', storeId: 'b' }), front), /门店|权限/);
  unchanged(model, () => call('requestScheduleChange', model, input({ therapistId: 't2' }), front), /所属|门店|权限/);
});

test('one local manager approval takes effect immediately and boss cannot create a second approval or notification', () => {
  const model = init(), request = call('requestScheduleChange', model, input(), front), data = { decision: 'approved', reason: '已与康复师确认', requestId: 'approval-1' };
  const row = call('decideScheduleChange', model, request.id, data, manager); assert.equal(row.status, 'approved'); assert.equal(row.decidedBy, 'm1'); assert.equal(row.decisionReason, '已与康复师确认'); assert.equal(call('scheduleStatus', model, 't1', model.today).endTime, '18:30');
  assert.equal(model.state.scheduleNotifications.length, 1); const notice = call('bossScheduleNotifications', model, boss)[0]; assert.equal(notice.changedBy, 'f1'); assert.equal(notice.approvedBy, 'm1');
  const before = JSON.stringify([model.state, model.sequence]); assert.equal(call('decideScheduleChange', model, request.id, data, manager).status, 'approved'); assert.equal(JSON.stringify([model.state, model.sequence]), before);
  unchanged(model, () => call('decideScheduleChange', model, request.id, { ...data, requestId: 'boss-approval' }, boss), /已经|已处理/);
  unchanged(model, () => call('decideScheduleChange', model, request.id, { ...data, reason: '变化' }, manager), /提交|变化/);
});

test('boss may approve another store alone and rejecting a request preserves the old shift', () => {
  const model = init(), req = call('requestScheduleChange', model, input({ therapistId: 't2', storeId: 'b', date: '2026-10-11' }), { type: 'frontdesk', id: 'f2' });
  unchanged(model, () => call('decideScheduleChange', model, req.id, { decision: 'approved', reason: '核对', requestId: 'x' }, manager), /本店|权限/);
  const rejected = call('decideScheduleChange', model, req.id, { decision: 'rejected', reason: '需要保持当天正常营业时间', requestId: 'reject' }, boss); assert.equal(rejected.status, 'rejected'); assert.equal(model.state.scheduleNotifications.length, 0); assert.equal(call('scheduleStatus', model, 't2', '2026-10-11').endTime, '19:00');
  const next = call('requestScheduleChange', model, input({ therapistId: 't2', storeId: 'b', date: '2026-10-11', requestId: 'b-next' }), { type: 'frontdesk', id: 'f2' });
  assert.equal(call('decideScheduleChange', model, next.id, { decision: 'approved', reason: '老板核对完毕', requestId: 'boss-ok' }, boss).status, 'approved');
});

test('approval rejects a stale proposal without overwriting a newer directly confirmed schedule', () => {
  const model = init(), req = call('requestScheduleChange', model, input(), front);
  call('saveSchedule', model, input({ endTime: '18:00', requestId: 'direct-new' }), boss);
  unchanged(model, () => call('decideScheduleChange', model, req.id, { decision: 'approved', reason: '同意', requestId: 'stale-ok' }, manager), /更新|变化|版本/);
  assert.equal(call('scheduleStatus', model, 't1', model.today).endTime, '18:00'); assert.equal(model.state.scheduleChangeRequests[0].status, 'pending');
});

test('rest, shortened shift and moving stores cannot invalidate existing pending appointments', () => {
  for (const status of ['confirmed', 'reschedule_requested', 'pending_reassignment']) {
    const model = init(); model.state.appointments.push({ id: 'schedule-conflict', clientId: 'c3', storeId: 'a', principalId: 't1', date: model.today, time: '18:00', status });
    for (const change of [{ status: 'rest' }, { endTime: '18:30' }, { storeId: 'b', endTime: '19:00' }, { startTime: '18:30', endTime: '19:30' }]) unchanged(model, () => call('saveSchedule', model, input(change), boss), /预约|先处理/);
  }
});

test('conflict appearing after request must be handled before approval, with no silent booking cancellation', () => {
  const model = init(), req = call('requestScheduleChange', model, input({ therapistId: 't3', status: 'rest' }), front);
  model.state.appointments.push({ id: 'late-appointment', clientId: 'c5', storeId: 'a', principalId: 't3', date: model.today, time: '10:00', status: 'confirmed' });
  unchanged(model, () => call('decideScheduleChange', model, req.id, { decision: 'approved', reason: '同意', requestId: 'late-conflict' }, manager), /预约|先处理/);
  assert.equal(model.state.appointments.at(-1).status, 'confirmed'); assert.equal(model.state.scheduleChangeRequests[0].status, 'pending');
});

test('availability guard rejects missing schedules and requires a complete service within the confirmed working window', () => {
  const legacy = fresh(); assert.throws(() => call('assertScheduleAvailability', legacy, { principalId: 't5', storeId: 'a', date: modelDate(), time: '20:00' }), /排班|确认/);
  const model = init(); for (const time of ['09:00', '09:30', '18:00']) assert.equal(call('assertScheduleAvailability', model, { principalId: 't1', storeId: 'a', date: model.today, time }), true);
  for (const change of [{ time: '08:30' }, { time: '18:30' }, { storeId: 'b' }, { date: '2026-10-23' }, { principalId: 't5' }, { time: '09:15' }, { duration: 0 }, { duration: '60' }]) assert.throws(() => call('assertScheduleAvailability', model, { principalId: 't1', storeId: 'a', date: model.today, time: '09:00', ...change }), /排班|上班|休息|门店|时间|时长/);
});
function modelDate() { return '2026-10-09'; }

test('loaded invalid or duplicate working shifts cannot accidentally provide availability through NaN comparisons', () => {
  for (const change of [{ startTime: 'bad' }, { endTime: '' }, { startTime: '09:15' }, { startTime: '20:00' }, { endTime: '08:30' }]) {
    const model = init(), row = model.state.staffSchedules.find(x => x.therapistId === 't1' && x.date === model.today); Object.assign(row, change);
    assert.throws(() => call('assertScheduleAvailability', model, { principalId: 't1', storeId: 'a', date: model.today, time: '10:00' }), /排班|时间|核对/);
  }
  const duplicate = init(), row = duplicate.state.staffSchedules.find(x => x.therapistId === 't1' && x.date === duplicate.today); duplicate.state.staffSchedules.push({ ...row, id: 'duplicate' });
  assert.throws(() => call('assertScheduleAvailability', duplicate, { principalId: 't1', storeId: 'a', date: duplicate.today, time: '10:00' }), /重复|排班|核对/);
});

test('a failing server clock leaves the shift, proposal decision, notices and audit entirely unchanged', () => {
  const direct = init(); direct.now = () => 'invalid'; unchanged(direct, () => call('saveSchedule', direct, input(), manager), /时钟|时间/);
  const model = init(), req = call('requestScheduleChange', model, input(), front); model.now = () => 'invalid';
  unchanged(model, () => call('decideScheduleChange', model, req.id, { decision: 'approved', reason: '同意', requestId: 'clock-failure' }, manager), /时钟|时间/);
});

test('past decisions, stopped actors and stopped stores fail atomically', () => {
  const model = init(), req = call('requestScheduleChange', model, input(), front), data = { decision: 'approved', reason: '同意', requestId: 'approve' };
  model.today = '2026-10-10'; unchanged(model, () => call('decideScheduleChange', model, req.id, data, manager), /过去/); model.today = '2026-10-09';
  model.state.storeManagers[0].active = false; unchanged(model, () => call('decideScheduleChange', model, req.id, data, manager), /在职|权限/); model.state.storeManagers[0].active = true;
  model.state.stores[0].active = false; unchanged(model, () => call('decideScheduleChange', model, req.id, data, boss), /停用|门店/);
});

test('boss-only notifications can be read idempotently and cannot expose request tokens or mutable nested schedule references', () => {
  const model = init(); call('saveSchedule', model, input(), manager); const notice = call('bossScheduleNotifications', model, boss)[0];
  for (const role of [manager, front, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, { type: 'boss', id: 'fake' }]) { assert.deepEqual(call('bossScheduleNotifications', model, role), []); unchanged(model, () => call('markScheduleNotificationRead', model, notice.id, role), /老板|权限/); }
  assert.equal('requestId' in notice, false); assert.equal('inputKey' in notice, false); assert.equal('requestId' in notice.after, false); notice.after.endTime = '01:00'; assert.equal(call('bossScheduleNotifications', model, boss)[0].after.endTime, '18:30');
  const read = call('markScheduleNotificationRead', model, notice.id, boss); assert.equal(read.readBy, 'boss'); assert.equal(read.readAt, '2026-10-09T03:00:00.000Z');
  const before = JSON.stringify([model.state, model.sequence]); call('markScheduleNotificationRead', model, notice.id, boss); assert.equal(JSON.stringify([model.state, model.sequence]), before);
});

test('request collections expose authorized store history only and omit all request keys including nested payloads', () => {
  const model = init(); call('requestScheduleChange', model, input(), front); call('requestScheduleChange', model, input({ therapistId: 't2', storeId: 'b', requestId: 'other' }), { type: 'frontdesk', id: 'f2' });
  assert.equal(call('scheduleRequestRows', model, boss).length, 2); assert.equal(call('scheduleRequestRows', model, manager).length, 1); assert.equal(call('scheduleRequestRows', model, front).length, 1); assert.equal(call('scheduleRequestRows', model, { type: 'therapist', id: 't2' }).length, 1); assert.deepEqual(call('scheduleRequestRows', model, { type: 'customer', id: 'c1' }), []);
  const row = call('scheduleRequestRows', model, front)[0]; assert.equal('requestId' in row, false); assert.equal('inputKey' in row, false); assert.equal('requestId' in row.after, false); row.before.endTime = '00:00'; assert.equal(call('scheduleRequestRows', model, front)[0].before.endTime, '19:00');
});
