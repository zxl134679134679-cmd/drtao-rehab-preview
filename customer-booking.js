// Desired times are requests, not live availability or confirmed appointments.
// The preview's existing appointment model remains the confirmation authority.
import { assertScheduleAvailability } from './schedules.js?v=20261009-personnel';
const clone = value => JSON.parse(JSON.stringify(value));
const fields = ['id', 'clientId', 'storeId', 'date', 'time', 'principalId', 'project', 'status', 'requestedBy', 'requestedRole', 'requestedAt', 'appointmentId', 'confirmedBy', 'confirmedRole', 'confirmedAt', 'cancelledBy', 'cancelledRole', 'cancelledAt'];
const publicRow = row => clone(Object.fromEntries(fields.filter(key => row[key] !== undefined).map(key => [key, row[key]])));
function text(value, label, limit = 80) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > limit) throw new Error(`请填写有效的${label}`);
  return value.trim();
}
function date(value) {
  const result = text(value, '预约日期', 10);
  const parsed = Date.parse(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== result) throw new Error('请选择有效预约日期');
  return result;
}
function time(value) {
  const result = text(value, '期望开始时间', 5);
  if (!/^([01]\d|2[0-3]):(00|30)$/.test(result)) throw new Error('预约开始时间请选择整点或半点');
  return result;
}
function customer(model, role) {
  if (role?.type !== 'customer') throw new Error('预约申请仅客户本人可以提交或取消');
  return model._client(role.id);
}
function isBoss(role) { return role?.type === 'boss' && role.id === 'boss'; }
function reader(model, role) {
  if (isBoss(role)) return;
  if (role?.type === 'customer') return customer(model, role);
  if (role?.type === 'frontdesk') return model._frontDesk(role.id);
  if (role?.type === 'manager') return model.managerStoreId(role);
  if (role?.type === 'therapist') return model._therapist(role.id);
  throw new Error('您没有查看预约申请的权限');
}
function confirmActor(model, row, role) {
  if (isBoss(role)) return model._boss(role);
  if (role?.type === 'frontdesk') return model._bookingActor(role, row.clientId, row.storeId);
  if (role?.type === 'therapist' && model._client(row.clientId).ownerId === role.id) return model._staff(role, row.clientId);
  throw new Error('仅老板、授权门店前台或该客户的负责康复师有权限确认；店长只读');
}
function assignment(model, row) {
  if (row.date < model.today) throw new Error('不能申请或确认过去的预约日期');
  const store = model._store(row.storeId);
  if (store.active === false) throw new Error('该门店已停用，请选择其他门店');
  const person = model._therapist(row.principalId);
  if (!model.canSeeClient({ type: 'therapist', id: person.id }, row.clientId)) throw new Error('请先联系负责康复师安排所选门店的服务人员');
  assertScheduleAvailability(model, row);
}
function request(model, id) {
  ensureCustomerBooking(model);
  const row = model.state.bookingRequests.find(item => item.id === id);
  if (!row) throw new Error('预约申请不存在，请刷新后核对');
  return row;
}
function stage(model) {
  const stamp = model._timestamp();
  return Object.assign(Object.create(Object.getPrototypeOf(model)), model, {
    now: () => stamp,
    state: { ...model.state, bookingRequests: model.state.bookingRequests.map(clone), appointments: [...model.state.appointments], tasks: model.state.tasks.map(clone), audit: [...model.state.audit] },
  });
}
function commit(model, staged, row) {
  model.state = staged.state;
  model.sequence = staged.sequence;
  return publicRow(row);
}

export function ensureCustomerBooking(model) {
  if (model.state.bookingRequests === undefined) model.state.bookingRequests = [];
  if (!Array.isArray(model.state.bookingRequests)) throw new Error('预约申请数据集合无效，不能重置已有记录');
  const ids = new Set(), submissions = new Set();
  for (const row of model.state.bookingRequests) {
    if (!row || typeof row !== 'object') throw new Error('预约申请记录无效');
    text(row.id, '预约申请标识'); text(row.clientId, '客户标识'); text(row.storeId, '门店标识'); text(row.principalId, '康复师标识');
    text(row.project, '服务项目', 120); date(row.date); time(row.time); text(row.requestId, '提交标识'); text(row.inputKey, '预约提交内容', 2000);
    if (row.requestAliases !== undefined && !Array.isArray(row.requestAliases)) throw new Error('预约申请提交别名须为有效数组');
    for (const key of [row.requestId, ...(row.requestAliases || [])]) {
      if (text(key, '提交标识别名') !== key) throw new Error('预约申请提交标识别名无效');
      const submission = JSON.stringify([row.clientId, key]);
      if (submissions.has(submission)) throw new Error('预约申请包含重复的客户提交标识或别名，请核对');
      submissions.add(submission);
    }
    if (ids.has(row.id) || !['pending', 'confirmed', 'cancelled'].includes(row.status) || row.requestedRole !== 'customer' || row.requestedBy !== row.clientId || !Number.isFinite(Date.parse(row.requestedAt))) throw new Error('预约申请包含无效或重复记录，请核对');
    if (row.status === 'confirmed') text(row.appointmentId, '已确认预约标识');
    ids.add(row.id);
  }
  return model;
}

export function requestCustomerBooking(model, data, role) {
  const client = customer(model, role);
  if (!data || typeof data !== 'object' || (data.clientId !== undefined && data.clientId !== client.id)) throw new Error('只能为客户本人提交预约申请');
  const existingProject = [client.goal, client.phase].find(value => typeof value === 'string' && value.trim());
  const row = { clientId: client.id, storeId: text(data.storeId, '服务门店'), date: date(data.date), time: time(data.time), principalId: text(data.principalId || client.ownerId, '服务康复师'), project: text(data.project ?? existingProject ?? '康复服务', '服务项目', 120) };
  const requestId = text(data.requestId, '提交标识');
  const inputKey = JSON.stringify(row);
  ensureCustomerBooking(model);
  const existing = model.state.bookingRequests.find(item => item.clientId === client.id && (item.requestId === requestId || (item.requestAliases || []).includes(requestId)));
  if (existing) {
    if (existing.inputKey !== inputKey) throw new Error('同一提交请求的内容发生变化，请重新发起预约申请');
    return publicRow(existing);
  }
  assignment(model, row);
  if (model.state.appointments.some(item => ['confirmed', 'reschedule_requested', 'pending_reassignment'].includes(item.status) && ['clientId', 'storeId', 'date', 'time', 'principalId', 'project'].every(key => item[key] === row[key]))) throw new Error('此服务已有已确认预约，请查看我的预约，无需重复申请');
  const pending = model.state.bookingRequests.find(item => item.clientId === client.id && item.status === 'pending' && item.inputKey === inputKey);
  if (pending) {
    // Bind reopening keys to the original payload. This changes only internal
    // retry metadata, never the request, audit, sequence, appointment or cash.
    const staged = Object.assign(Object.create(Object.getPrototypeOf(model)), model, { state: { ...model.state, bookingRequests: model.state.bookingRequests.map(clone) } });
    const original = staged.state.bookingRequests.find(item => item.id === pending.id);
    original.requestAliases = [...(original.requestAliases || []), requestId];
    return commit(model, staged, original);
  }
  const staged = stage(model);
  let id;
  do { id = staged._id('booking'); } while (staged.state.bookingRequests.some(item => item.id === id));
  const result = { id, ...row, requestId, requestAliases: [], inputKey, status: 'pending', requestedBy: role.id, requestedRole: role.type, requestedAt: staged._timestamp() };
  staged.state.bookingRequests.push(result);
  staged._log('customer_booking_requested', { bookingRequestId: id, clientId: client.id, storeId: row.storeId, result: 'pending' }, role);
  return commit(model, staged, result);
}

export function cancelCustomerBooking(model, id, role) {
  const client = customer(model, role);
  const current = request(model, id);
  if (current.clientId !== client.id) throw new Error('仅客户本人可以取消自己的预约申请');
  if (current.status !== 'pending') throw new Error('只能取消待门店确认的申请；已确认预约请联系门店改约或取消');
  const staged = stage(model), row = staged.state.bookingRequests.find(item => item.id === id);
  Object.assign(row, { status: 'cancelled', cancelledBy: role.id, cancelledRole: role.type, cancelledAt: staged._timestamp() });
  staged._log('customer_booking_cancelled', { bookingRequestId: id, clientId: row.clientId, storeId: row.storeId, result: 'cancelled' }, role);
  return commit(model, staged, row);
}

export function customerBookingRows(model, role) {
  reader(model, role);
  ensureCustomerBooking(model);
  let storeIds;
  if (role.type === 'frontdesk') storeIds = model.frontDeskStoreIds(role);
  if (role.type === 'manager') storeIds = [model.managerStoreId(role)];
  return model.state.bookingRequests.filter(row => {
    if (isBoss(role)) return true;
    if (role.type === 'customer') return row.clientId === role.id;
    if (storeIds) return storeIds.includes(row.storeId);
    return model._client(row.clientId).ownerId === role.id && model.canSeeClient(role, row.clientId);
  }).map(publicRow);
}

export function confirmCustomerBooking(model, id, role) {
  reader(model, role);
  const current = request(model, id);
  confirmActor(model, current, role);
  if (current.status === 'confirmed') {
    if (!model.state.appointments.some(row => row.id === current.appointmentId && row.clientId === current.clientId)) throw new Error('已确认申请的预约记录不完整，请由老板核对');
    return publicRow(current);
  }
  if (current.status !== 'pending') throw new Error('已取消的申请不能确认，请客户重新发起预约');
  assignment(model, current);
  const staged = stage(model), row = staged.state.bookingRequests.find(item => item.id === id);
  const appointment = staged.saveAppointment({ clientId: row.clientId, storeId: row.storeId, date: row.date, time: row.time, principalId: row.principalId, project: row.project }, role);
  Object.assign(row, { status: 'confirmed', appointmentId: appointment.id, confirmedBy: role.id, confirmedRole: role.type, confirmedAt: staged._timestamp() });
  staged._log('customer_booking_confirmed', { bookingRequestId: id, appointmentId: appointment.id, clientId: row.clientId, storeId: row.storeId, result: 'confirmed' }, role);
  return commit(model, staged, row);
}

export function customerBookingConfirmation(model, id, role) {
  const visible = customerBookingRows(model, role).find(row => row.id === id);
  if (!visible) throw new Error('您没有查看该预约申请的权限');
  const row = request(model, id);
  if (row.status !== 'pending') return { canConfirm: false, reason: row.status === 'confirmed' ? '已安排预约，请查看预约记录' : '申请已取消' };
  try {
    confirmActor(model, row, role);
    assignment(model, row);
    return { canConfirm: true, reason: '确认时会再次检查康复师和客户的预约冲突' };
  } catch (error) {
    return { canConfirm: false, reason: `需客户负责人或老板确认：${error.message}` };
  }
}
