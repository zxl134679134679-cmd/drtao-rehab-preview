/* Confirmed working hours. Changes never cancel appointments or alter consumption and cash. */
const clone = value => JSON.parse(JSON.stringify(value));
const pick = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, clone(value[key])]));
const SCHEDULE_KEYS = ['id', 'therapistId', 'storeId', 'date', 'status', 'startTime', 'endTime', 'version', 'changedBy', 'changedRole', 'changedAt', 'reason'];
const REQUEST_KEYS = ['id', 'therapistId', 'storeId', 'date', 'status', 'reason', 'requestedBy', 'requestedRole', 'requestedAt', 'decidedBy', 'decidedRole', 'decidedAt', 'decisionReason'];
const NOTICE_KEYS = ['id', 'scheduleId', 'changeRequestId', 'therapistId', 'storeId', 'date', 'reason', 'approvalReason', 'changedBy', 'changedRole', 'approvedBy', 'approvedRole', 'approvedAt', 'createdAt', 'readAt', 'readBy', 'wechatStatus'];
const pendingAppointment = status => ['confirmed', 'reschedule_requested', 'pending_reassignment'].includes(status);
const scheduleProjection = row => pick(row, SCHEDULE_KEYS);
const requestProjection = row => ({ ...pick(row, REQUEST_KEYS), before: scheduleProjection(row.before), after: scheduleProjection(row.after) });
const noticeProjection = row => ({ ...pick(row, NOTICE_KEYS), before: scheduleProjection(row.before), after: scheduleProjection(row.after) });
const text = (value, label, max = 1000) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`请填写有效的${label}（最多 ${max} 字）`);
  return value.trim();
};
const validDate = value => {
  const result = text(value, '排班日期', 10), stamp = Date.parse(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== result) throw new Error('请选择有效排班日期');
  return result;
};
const halfHour = (value, label) => {
  const result = text(value, label, 5);
  if (!/^([01]\d|2[0-3]):(00|30)$/.test(result)) throw new Error(`${label}须选择整点或半点时间`);
  return result;
};
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const version = value => {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new Error('请核对排班版本');
  return Number(value);
};
function activeStore(model, storeId) {
  const row = model._store(storeId);
  if (row.active === false) throw new Error('门店已停用，不能操作该门店排班');
  return row;
}
function actorStores(model, role) {
  let ids;
  if (role?.type === 'boss') { model._boss(role); ids = model.state.stores.map(row => row.id); }
  else if (role?.type === 'manager') ids = [model.managerStoreId(role)];
  else if (role?.type === 'frontdesk') ids = model.frontDeskStoreIds(role);
  else if (role?.type === 'therapist') ids = [model._therapist(role.id).storeId];
  else throw new Error('没有查看排班的工作权限');
  const active = ids.filter(id => model._store(id).active !== false);
  if (!active.length) throw new Error('授权门店已停用，暂无有效排班权限');
  return active;
}
function currentSchedule(model, therapistId, date) {
  return model.state.staffSchedules?.find(row => row.therapistId === therapistId && row.date === date) || { therapistId, date, storeId: '', status: 'unassigned', startTime: '', endTime: '', version: 0 };
}
function initialized(model) {
  if (!Array.isArray(model.state.staffSchedules) || !Array.isArray(model.state.scheduleChangeRequests) || !Array.isArray(model.state.scheduleNotifications)) throw new Error('排班尚未初始化，请刷新页面后重试');
}
function writable(model, role, row, before, mode) {
  if (mode === 'request') {
    if (role?.type !== 'frontdesk') throw new Error('仅授权前台可提交排班调整申请');
  } else if (!['boss', 'manager'].includes(role?.type)) throw new Error('仅老板或本店店长可确认修改排班');
  const stores = actorStores(model, role), therapist = model._therapist(row.therapistId);
  activeStore(model, therapist.storeId); activeStore(model, row.storeId);
  if (!stores.includes(row.storeId) || (before.storeId && !stores.includes(before.storeId))) throw new Error('没有原排班或目标门店权限，店长只能修改本店排班');
  if (role.type !== 'boss' && (!stores.includes(therapist.storeId) || row.storeId !== therapist.storeId)) throw new Error('只能操作本店所属康复师的本店排班');
}
function inputSchedule(model, data) {
  const therapistId = text(data?.therapistId, '康复师', 80), storeId = text(data?.storeId, '排班门店', 80), date = validDate(data?.date);
  if (date < model.today) throw new Error('不能修改过去日期的排班');
  if (!['work', 'rest'].includes(data.status)) throw new Error('请选择上班或休息的排班状态');
  const status = data.status, startTime = status === 'work' ? halfHour(data.startTime, '上班时间') : '', endTime = status === 'work' ? halfHour(data.endTime, '下班时间') : '';
  if (status === 'work' && minutes(endTime) <= minutes(startTime)) throw new Error('下班时间必须晚于上班时间');
  return { therapistId, storeId, date, status, startTime, endTime, reason: text(data.reason, '修改原因'), expectedVersion: version(data.expectedVersion), requestId: text(data.requestId, '提交标识', 150) };
}
function sameShift(a, b) { return ['therapistId', 'date', 'storeId', 'status', 'startTime', 'endTime'].every(key => a[key] === b[key]); }
function assertVersion(before, expected) { if (before.version !== expected) throw new Error('排班已更新，版本发生变化。请重新打开并核对后再提交'); }
function assertAppointments(model, candidate) {
  const conflicts = model.state.appointments.filter(row => pendingAppointment(row.status) && row.date === candidate.date && (row.principalId === candidate.therapistId || row.participantIds?.includes(candidate.therapistId)) &&
    (candidate.status !== 'work' || row.storeId !== candidate.storeId || minutes(row.time) < minutes(candidate.startTime) || minutes(row.time) + 60 > minutes(candidate.endTime)));
  if (conflicts.length) throw new Error(`这项修改会影响 ${conflicts.length} 个现有预约（${conflicts.map(row => `${row.time} ${model.state.clients.find(c => c.id === row.clientId)?.name || '客户'}`).join('、')}）。请先处理预约，再修改排班`);
}
function stage(model) {
  return Object.assign(Object.create(Object.getPrototypeOf(model)), model, { state: { ...model.state, staffSchedules: model.state.staffSchedules.map(clone), scheduleChangeRequests: model.state.scheduleChangeRequests.map(clone), scheduleNotifications: model.state.scheduleNotifications.map(clone), audit: [...model.state.audit] } });
}
function id(model, prefix) {
  const ids = new Set(['staffSchedules', 'scheduleChangeRequests', 'scheduleNotifications', 'audit'].flatMap(key => model.state[key].map(row => row.id)));
  let result; do { result = model._id(prefix); } while (ids.has(result)); return result;
}
function commit(model, staged) {
  for (const key of ['staffSchedules', 'scheduleChangeRequests', 'scheduleNotifications', 'audit']) model.state[key] = staged.state[key];
  model.sequence = staged.sequence;
}
function audit(staged, type, data, role, stamp) {
  staged.state.audit.push({ id: id(staged, 'audit'), type, ...clone(data), actorId: role.id, actorType: role.type, createdAt: stamp });
}
function priorOperation(model, role, requestId) {
  const direct = model.state.scheduleNotifications.find(row => row.operation === 'save' && row.changedBy === role.id && row.changedRole === role.type && row.requestId === requestId);
  if (direct) return { kind: 'save', row: direct, inputKey: direct.inputKey };
  const request = model.state.scheduleChangeRequests.find(row => row.requestedBy === role.id && row.requestedRole === role.type && row.requestId === requestId);
  if (request) return { kind: 'request', row: request, inputKey: request.inputKey };
  const decision = model.state.scheduleChangeRequests.find(row => row.decidedBy === role.id && row.decidedRole === role.type && row.decisionRequestId === requestId);
  return decision ? { kind: 'decision', row: decision, inputKey: decision.decisionInputKey } : null;
}
function replay(prior, kind, inputKey) {
  if (!prior) return null;
  if (prior.kind !== kind || prior.inputKey !== inputKey) throw new Error('此提交标识已用于其他内容或操作，提交内容发生变化，请重新提交');
  return prior.row;
}
function applyChange(staged, after, before, { reason, proposer, approver, stamp, changeRequestId = '', operation = 'approval', requestId = '', inputKey = '', approvalReason = '' }) {
  const saved = { ...pick(after, ['therapistId', 'storeId', 'date', 'status', 'startTime', 'endTime']), id: before.id || id(staged, 'schedule'), version: before.version + 1, reason, changedBy: approver.id, changedRole: approver.type, changedAt: stamp };
  const index = staged.state.staffSchedules.findIndex(row => row.therapistId === saved.therapistId && row.date === saved.date);
  if (index < 0) staged.state.staffSchedules.push(saved); else staged.state.staffSchedules[index] = saved;
  staged.state.scheduleNotifications.push({ id: id(staged, 'scheduleNotice'), scheduleId: saved.id, changeRequestId, therapistId: saved.therapistId, storeId: saved.storeId, date: saved.date, before: scheduleProjection(before), after: scheduleProjection(saved), reason, approvalReason, changedBy: proposer.id, changedRole: proposer.type, approvedBy: approver.id, approvedRole: approver.type, approvedAt: stamp, createdAt: stamp, readAt: null, readBy: null, wechatStatus: 'pending_integration', operation, requestId, inputKey });
  audit(staged, 'schedule_changed', { scheduleId: saved.id, therapistId: saved.therapistId, storeId: saved.storeId, date: saved.date, before: scheduleProjection(before), after: scheduleProjection(saved), reason, changeRequestId }, approver, stamp);
  return saved;
}

export function ensureSchedules(model) {
  const hadSchedules = model.state.staffSchedules !== undefined;
  for (const key of ['staffSchedules', 'scheduleChangeRequests', 'scheduleNotifications']) {
    if (model.state[key] !== undefined && !Array.isArray(model.state[key])) throw new Error('排班数据集合无效');
  }
  model.state.staffSchedules ??= []; model.state.scheduleChangeRequests ??= []; model.state.scheduleNotifications ??= [];
  if (!hadSchedules && model._usesPreviewSeed) {
    for (let offset = 0; offset < 14; offset++) {
      const day = new Date(`${model.today}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + offset); const date = day.toISOString().slice(0, 10);
      for (const therapist of model.state.therapists.filter(row => row.active === true && model._store(row.storeId).active !== false)) {
        const rest = therapist.id === 't5' && offset === 0;
        model.state.staffSchedules.push({ id: `schedule-example-${therapist.id}-${date}`, therapistId: therapist.id, storeId: therapist.storeId, date, status: rest ? 'rest' : 'work', startTime: rest ? '' : '09:00', endTime: rest ? '' : '19:00', version: 1, changedBy: 'boss', changedRole: 'boss', changedAt: model._timestamp(), reason: '虚构示例排班' });
      }
    }
  }
  return model;
}

export function scheduleStatus(model, therapistId, date) {
  model._therapist(therapistId); validDate(date);
  return scheduleProjection(currentSchedule(model, therapistId, date));
}
export function scheduleRows(model, role, filters = {}) {
  if (role?.type === 'customer') return [];
  const stores = actorStores(model, role);
  return (model.state.staffSchedules || []).filter(row => stores.includes(row.storeId) && model.state.therapists.some(t => t.id === row.therapistId && t.active === true) && (role.type !== 'therapist' || row.therapistId === role.id) && (!filters.storeId || row.storeId === filters.storeId) && (!filters.date || row.date === filters.date) && (!filters.therapistId || row.therapistId === filters.therapistId)).map(scheduleProjection);
}
export function saveSchedule(model, data, role) {
  if (!['boss', 'manager'].includes(role?.type)) throw new Error('仅老板或本店店长可确认修改排班');
  initialized(model); const input = inputSchedule(model, data), before = currentSchedule(model, input.therapistId, input.date);
  writable(model, role, input, before, 'save');
  const inputKey = JSON.stringify(input), previous = replay(priorOperation(model, role, input.requestId), 'save', inputKey);
  if (previous) return scheduleProjection(previous.after);
  assertVersion(before, input.expectedVersion); if (sameShift(input, before)) throw new Error('排班没有变化，无需重复确认'); assertAppointments(model, input);
  const staged = stage(model), stamp = staged._timestamp(), saved = applyChange(staged, input, before, { reason: input.reason, proposer: role, approver: role, stamp, operation: 'save', requestId: input.requestId, inputKey });
  commit(model, staged); return scheduleProjection(saved);
}
export function requestScheduleChange(model, data, role) {
  if (role?.type !== 'frontdesk') throw new Error('仅授权前台可提交排班调整申请');
  initialized(model); const input = inputSchedule(model, data), before = currentSchedule(model, input.therapistId, input.date);
  writable(model, role, input, before, 'request');
  const inputKey = JSON.stringify(input), previous = replay(priorOperation(model, role, input.requestId), 'request', inputKey);
  if (previous) return requestProjection(previous);
  assertVersion(before, input.expectedVersion); if (sameShift(input, before)) throw new Error('排班没有变化，无需提交申请'); assertAppointments(model, input);
  const staged = stage(model), stamp = staged._timestamp(), row = { id: id(staged, 'scheduleRequest'), therapistId: input.therapistId, storeId: input.storeId, date: input.date, status: 'pending', before: scheduleProjection(before), after: { ...pick(input, ['therapistId', 'storeId', 'date', 'status', 'startTime', 'endTime']), version: before.version + 1 }, reason: input.reason, requestedBy: role.id, requestedRole: role.type, requestedAt: stamp, requestId: input.requestId, inputKey };
  staged.state.scheduleChangeRequests.push(row); audit(staged, 'schedule_change_requested', { changeRequestId: row.id, therapistId: row.therapistId, storeId: row.storeId, date: row.date, reason: row.reason, before: row.before, after: row.after }, role, stamp);
  commit(model, staged); return requestProjection(row);
}
export function decideScheduleChange(model, changeId, data, role) {
  if (!['boss', 'manager'].includes(role?.type)) throw new Error('仅老板或本店店长可审批排班申请');
  initialized(model); const row = model.state.scheduleChangeRequests.find(r => r.id === changeId); if (!row) throw new Error('排班调整申请不存在');
  const before = currentSchedule(model, row.therapistId, row.date); writable(model, role, row.after, row.before, 'approve');
  if (row.date < model.today) throw new Error('不能审批过去日期的排班调整');
  if (!['approved', 'rejected'].includes(data?.decision)) throw new Error('请选择同意或拒绝申请');
  const reason = text(data.reason, '审批原因'), requestId = text(data.requestId, '提交标识', 150), inputKey = JSON.stringify({ changeId, decision: data.decision, reason });
  const previous = replay(priorOperation(model, role, requestId), 'decision', inputKey); if (previous) return requestProjection(previous);
  if (row.status !== 'pending') throw new Error('此申请已经由一位负责人处理，无需再次审批');
  if (data.decision === 'approved') { assertVersion(before, row.before.version); assertAppointments(model, row.after); }
  const staged = stage(model), target = staged.state.scheduleChangeRequests.find(r => r.id === changeId), stamp = staged._timestamp();
  if (data.decision === 'approved') target.after = scheduleProjection(applyChange(staged, target.after, before, { reason: target.reason, proposer: { id: target.requestedBy, type: target.requestedRole }, approver: role, stamp, changeRequestId: changeId, approvalReason: reason }));
  Object.assign(target, { status: data.decision, decidedBy: role.id, decidedRole: role.type, decidedAt: stamp, decisionReason: reason, decisionRequestId: requestId, decisionInputKey: inputKey });
  audit(staged, 'schedule_change_decided', { changeRequestId: target.id, therapistId: target.therapistId, storeId: target.storeId, date: target.date, decision: target.status, reason }, role, stamp);
  commit(model, staged); return requestProjection(target);
}
export function scheduleRequestRows(model, role) {
  if (role?.type === 'customer') return [];
  const stores = actorStores(model, role);
  return (model.state.scheduleChangeRequests || []).filter(row => stores.includes(row.storeId) && model.state.therapists.some(t => t.id === row.therapistId && t.active === true) && (role.type !== 'therapist' || row.therapistId === role.id)).map(requestProjection);
}
export function bossScheduleNotifications(model, role) {
  if (role?.type !== 'boss' || role.id !== 'boss') return [];
  return (model.state.scheduleNotifications || []).map(noticeProjection);
}
export function markScheduleNotificationRead(model, noticeId, role) {
  model._boss(role); initialized(model); const notice = model.state.scheduleNotifications.find(row => row.id === noticeId); if (!notice) throw new Error('排班通知不存在');
  if (!notice.readAt) { const stamp = model._timestamp(); notice.readAt = stamp; notice.readBy = 'boss'; }
  return noticeProjection(notice);
}
export function assertScheduleAvailability(model, input) {
  if (model.state.staffSchedules === undefined) throw new Error('这一天尚未排班，请先联系店长确认上班时间');
  if (!Array.isArray(model.state.staffSchedules)) throw new Error('排班数据无效，请联系老板核对');
  const therapist = model._therapist(input.principalId); activeStore(model, therapist.storeId); activeStore(model, input.storeId);
  const date = validDate(input.date), time = halfHour(input.time, '预约开始时间'), duration = input.duration ?? 60;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration <= 0 || duration > 1440) throw new Error('预约时长须为有效分钟数');
  const matches = model.state.staffSchedules.filter(row => row.therapistId === therapist.id && row.date === date);
  if (matches.length > 1) throw new Error('这一天有重复排班，请联系老板或店长核对后再预约');
  const schedule = matches[0] || currentSchedule(model, therapist.id, date);
  if (schedule.status === 'unassigned') throw new Error('这一天尚未排班，请先联系店长确认上班时间');
  if (schedule.status !== 'work') throw new Error('康复师这一天休息，请选择其他日期或康复师');
  if (schedule.storeId !== input.storeId) throw new Error('康复师这一天在其他门店上班，请核对排班门店');
  const startTime = halfHour(schedule.startTime, '已确认排班的上班时间'), endTime = halfHour(schedule.endTime, '已确认排班的下班时间');
  if (minutes(endTime) <= minutes(startTime)) throw new Error('已确认排班时间无效，请联系老板或店长核对');
  if (minutes(time) < minutes(startTime) || minutes(time) + duration > minutes(endTime)) throw new Error(`预约完整时长须在上班时间 ${startTime}–${endTime} 内`);
  return true;
}
