export const TODAY = '2026-10-08';

const copy = value => JSON.parse(JSON.stringify(value));
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const required = (value, label) => {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`请填写${label}`);
  return text;
};
const validDate = value => {
  const date = required(value, '日期');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('请选择有效日期');
  }
  return date;
};
const validTime = value => {
  const time = required(value, '时间');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效时间');
  return time;
};
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const pendingProgress = () => ({ status: 'pending', summary: '待康复师完成评估后更新', metrics: [] });

function seedClient(id, name, ownerId, storeId, packageId, phone) {
  return {
    id, name, phone, ownerId, storeId, packageId,
    goal: '运动功能恢复计划', phase: '评估与基础训练',
    nextStep: '进行基础训练与阶段复评',
    planNotes: '先完成评估，再根据您的目标安排训练。每个阶段复评后，由负责康复师调整后续计划。',
    progress: pendingProgress(), progressUpdatedAt: null,
    homeAdvice: '请按康复师当次指导练习。练习中如有不适，请停止并联系您的康复师。',
    planVersion: 1,
  };
}

function seedState() {
  return {
    stores: [
      { id: 'a', name: 'A店', address: '青岛市示例地址 A（预览用）' },
      { id: 'b', name: 'B店', address: '青岛市示例地址 B（预览用）' },
    ],
    therapists: [
      { id: 't1', name: '林予安', storeId: 'a', active: true },
      { id: 't2', name: '周亦宁', storeId: 'b', active: true },
      { id: 't3', name: '苏晴', storeId: 'a', active: true },
      { id: 't4', name: '何知行', storeId: 'b', active: true },
      { id: 't5', name: '许映', storeId: 'a', active: true },
    ],
    clients: [
      seedClient('c1', '陈一诺', 't1', 'a', 'p1', '13800000001'),
      seedClient('c2', '许安然', 't2', 'b', 'p2', '13800000002'),
      seedClient('c3', '周沐', 't1', 'a', 'p3', '13800000003'),
      seedClient('c4', '赵清禾', 't4', 'b', 'p4', '13800000004'),
      seedClient('c5', '王星野', 't5', 'a', 'p5', '13800000005'),
    ],
    packages: [
      { id: 'p0', clientId: 'c1', name: '历史运动评估套餐', amount: 1200, total: 4, openingUsed: 4, status: 'historical' },
      { id: 'p1', clientId: 'c1', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 0, status: 'current' },
      { id: 'p2', clientId: 'c2', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 0, status: 'current' },
      { id: 'p3', clientId: 'c3', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 8, status: 'current' },
      { id: 'p4', clientId: 'c4', name: '运动功能恢复套餐', amount: 3600, total: 12, openingUsed: 3, status: 'current' },
      { id: 'p5', clientId: 'c5', name: '运动功能恢复套餐', amount: 2400, total: 8, openingUsed: 2, status: 'current' },
    ],
    services: [
      {
        id: 's1', clientId: 'c1', packageId: 'p1', storeId: 'b', date: TODAY,
        time: '10:00', project: '首次评估', principalId: 't2', participantIds: ['t1', 't3'],
        ownerId: 't1', recordedBy: 't2', amount: 300, sessions: 1, status: 'valid',
        notes: '已完成首次评估。下一步进行基础训练与阶段复评。',
        requestId: 'seed-s1', createdAt: '2026-10-08T03:00:00.000Z',
      },
    ],
    appointments: [
      { id: 'a1', clientId: 'c1', date: '2026-10-10', time: '10:00', storeId: 'b', principalId: 't2', project: '阶段复评与训练', status: 'confirmed', requestNote: '' },
      { id: 'a2', clientId: 'c2', date: TODAY, time: '11:30', storeId: 'b', principalId: 't2', project: '基础训练', status: 'confirmed', requestNote: '' },
      { id: 'a3', clientId: 'c3', date: TODAY, time: '14:00', storeId: 'a', principalId: 't1', project: '阶段复评', status: 'confirmed', requestNote: '' },
    ],
    tasks: [
      { id: 'task1', clientId: 'c1', title: '完善首次评估与阶段计划', assigneeId: 't1', dueDate: TODAY, status: 'pending', type: 'assessment' },
      { id: 'task2', clientId: 'c3', title: '剩余 2 次，安排阶段复评', assigneeId: 't1', dueDate: '2026-10-10', status: 'pending', type: 'review' },
      { id: 'task3', clientId: 'c2', title: '完成本次训练后的服务记录', assigneeId: 't2', dueDate: TODAY, status: 'pending', type: 'service_note' },
    ],
    reviews: [], audit: [],
  };
}

export class DemoModel {
  constructor() {
    this.state = seedState();
    this.sequence = 100;
  }

  _id(prefix) { return `${prefix}${++this.sequence}`; }
  _client(id) {
    const row = this.state.clients.find(item => item.id === id);
    if (!row) throw new Error('客户不存在');
    return row;
  }
  _store(id) {
    const row = this.state.stores.find(item => item.id === id);
    if (!row) throw new Error('门店不存在');
    return row;
  }
  _therapist(id, active = true) {
    const row = this.state.therapists.find(item => item.id === id);
    if (!row || (active && !row.active)) throw new Error('请选择在职康复师');
    return row;
  }
  _boss(role) {
    if (role?.type !== 'boss' || role.id !== 'boss') throw new Error('仅老板有权限进行此操作');
  }
  _staff(role, clientId) {
    if (role?.type === 'boss') this._boss(role);
    else if (role?.type === 'therapist') {
      this._therapist(role.id);
      if (!this.canSeeClient(role, clientId)) throw new Error('您没有查看或登记该客户的权限');
    } else throw new Error('您没有登记或管理服务的权限，仅康复师和老板可以操作');
    return this._client(clientId);
  }
  _log(type, data, role) {
    const row = { id: this._id('audit'), type, ...copy(data), actorId: role.id, createdAt: new Date().toISOString() };
    this.state.audit.unshift(row);
    return row;
  }

  remaining(clientId) {
    const client = this._client(clientId);
    const pack = this.state.packages.find(item => item.id === client.packageId);
    if (!pack) throw new Error('该客户还没有当前套餐');
    const used = this.state.services.filter(item => item.packageId === pack.id && item.status === 'valid').reduce((total, item) => total + item.sessions, 0);
    return pack.total - pack.openingUsed - used;
  }

  unitValue(packageId) {
    const pack = this.state.packages.find(item => item.id === packageId);
    if (!pack || !pack.total) throw new Error('套餐不存在或总次数无效');
    return money(pack.amount / pack.total);
  }

  canSeeClient(role, clientId) {
    const client = this.state.clients.find(item => item.id === clientId);
    if (!client) return false;
    if (role?.type === 'boss' && role.id === 'boss') return true;
    if (role?.type === 'customer') return role.id === clientId;
    if (role?.type !== 'therapist' || !this.state.therapists.some(item => item.id === role.id && item.active)) return false;
    return client.ownerId === role.id || this.state.services.some(item => item.clientId === clientId && item.status === 'valid' && (item.principalId === role.id || item.participantIds.includes(role.id)));
  }

  visibleClients(role) {
    return this.state.clients.filter(item => this.canSeeClient(role, item.id));
  }

  serviceRows(filters = {}) {
    return this.state.services.filter(item =>
      (!filters.storeId || item.storeId === filters.storeId) &&
      (!filters.therapistId || item.principalId === filters.therapistId) &&
      (!filters.clientId || item.clientId === filters.clientId) &&
      (!filters.from || item.date >= filters.from) &&
      (!filters.to || item.date <= filters.to),
    ).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  }

  performance(therapistId, filters = {}) {
    return money(this.serviceRows({ ...filters, therapistId }).filter(item => item.status === 'valid').reduce((total, item) => total + item.amount, 0));
  }

  collaborationRows(therapistId, filters = {}) {
    const { therapistId: ignored, ...remainingFilters } = filters;
    return this.serviceRows(remainingFilters).filter(item => item.status === 'valid' && item.participantIds.includes(therapistId));
  }

  registerService(data, role) {
    const client = this._staff(role, data.clientId);
    const requestId = required(data.requestId, '提交标识');
    const input = {
      clientId: client.id, storeId: required(data.storeId, '服务门店'),
      date: validDate(data.date), time: validTime(data.time), project: required(data.project, '服务项目'),
      principalId: required(data.principalId, '主康复师'),
      participantIds: [...new Set(data.participantIds || [])].filter(id => id !== data.principalId).sort(),
      notes: required(data.notes, '本次服务记录'),
    };
    const inputKey = JSON.stringify(input);
    const existing = this.state.services.find(item => item.requestId === requestId && item.recordedBy === role.id);
    if (existing) {
      if (existing.inputKey && existing.inputKey !== inputKey) throw new Error('同一提交请求的内容发生变化，请重新打开登记表');
      return existing;
    }
    if (input.date > TODAY) throw new Error('不能登记尚未发生的未来服务');
    this._store(input.storeId);
    this._therapist(input.principalId);
    input.participantIds.forEach(id => this._therapist(id));
    if (this.remaining(client.id) < 1) throw new Error('套餐次数已用完，请先由老板确认套餐');
    const row = {
      id: this._id('s'), ...input, packageId: client.packageId, ownerId: client.ownerId,
      recordedBy: role.id, amount: this.unitValue(client.packageId), sessions: 1,
      status: 'valid', requestId, inputKey, createdAt: new Date().toISOString(),
    };
    this.state.services.unshift(row);
    row.appointmentSnapshots = this.state.appointments.filter(item => item.clientId === client.id && item.date === row.date && item.time === row.time && ['confirmed', 'reschedule_requested'].includes(item.status)).map(item => ({ id: item.id, status: item.status }));
    row.appointmentSnapshots.forEach(snapshot => {
      const appointment = this.state.appointments.find(item => item.id === snapshot.id);
      appointment.status = 'completed';
      appointment.serviceId = row.id;
    });
    this._log('service_registered', { serviceId: row.id, clientId: client.id, amount: row.amount }, role);
    return row;
  }

  revokeService(id, reason, role) {
    this._boss(role);
    const why = required(reason, '撤销原因');
    const row = this.state.services.find(item => item.id === id);
    if (!row) throw new Error('服务记录不存在');
    if (row.status === 'revoked') throw new Error('该服务记录已撤销，不能重复恢复次数');
    row.status = 'revoked';
    row.revokeReason = why;
    row.revokedBy = role.id;
    row.revokedAt = new Date().toISOString();
    (row.appointmentSnapshots || []).forEach(snapshot => {
      const appointment = this.state.appointments.find(item => item.id === snapshot.id);
      if (appointment?.status === 'completed' && appointment.serviceId === row.id) {
        appointment.status = snapshot.status;
        delete appointment.serviceId;
      }
    });
    this._log('service_revoked', { serviceId: id, clientId: row.clientId, reason: why, reversedAmount: row.amount }, role);
    return row;
  }

  publishPlan(clientId, data, role) {
    const client = this._staff(role, clientId);
    if (role.type !== 'boss' && client.ownerId !== role.id) throw new Error('仅负责康复师或老板有权限发布计划');
    const next = {
      goal: required(data.goal, '康复目标'), phase: required(data.phase, '当前阶段'),
      nextStep: required(data.nextStep, '下一步安排'), planNotes: required(data.planNotes, '计划内容'),
      homeAdvice: required(data.homeAdvice, '居家指导'),
    };
    if (data.progress) {
      next.progress = copy(data.progress);
      if (!['pending', 'updated'].includes(next.progress.status) || !Array.isArray(next.progress.metrics)) throw new Error('请填写有效的康复进展记录');
      if (next.progress.status === 'updated' && !String(next.progress.summary || '').trim()) throw new Error('请填写阶段复评说明');
      next.progressUpdatedAt = next.progress.status === 'updated' ? TODAY : null;
    }
    let nextTask = null;
    if (String(data.taskTitle || '').trim()) {
      const assigneeId = data.assigneeId || client.ownerId;
      if (assigneeId !== 'boss') {
        this._therapist(assigneeId);
        if (!this.canSeeClient({ type: 'therapist', id: assigneeId }, clientId)) throw new Error('待办负责人尚未负责或参与过此客户的有效服务，请先由老板转交客户负责人，再安排待办');
      }
      nextTask = { clientId, title: String(data.taskTitle).trim(), dueDate: validDate(data.dueDate), assigneeId, status: 'pending', type: 'plan' };
    }
    const before = copy(client);
    Object.assign(client, next, { planVersion: (client.planVersion || 1) + 1 });
    if (nextTask) this.state.tasks.push({ id: this._id('task'), ...nextTask });
    this._log('plan_published', { clientId, before, after: copy(client) }, role);
    return client;
  }

  saveAppointment(data, role) {
    const client = this._staff(role, data.clientId);
    const input = {
      clientId: client.id, date: validDate(data.date), time: validTime(data.time),
      storeId: required(data.storeId, '服务门店'), principalId: required(data.principalId, '服务康复师'),
      project: required(data.project, '服务项目'),
    };
    if (input.date < TODAY) throw new Error('不能预约过去的日期');
    this._store(input.storeId);
    this._therapist(input.principalId);
    if (!this.canSeeClient({ type: 'therapist', id: input.principalId }, client.id)) throw new Error('服务康复师尚未负责或参与过此客户的有效服务，请先由老板转交客户负责人，再安排服务');
    const existing = data.id ? this.state.appointments.find(item => item.id === data.id) : null;
    if (data.id && !existing) throw new Error('预约记录不存在');
    if (existing && existing.clientId !== client.id) throw new Error('不能将预约转给其他客户');
    const conflict = this.state.appointments.find(item => item.id !== data.id && ['confirmed', 'reschedule_requested'].includes(item.status) && item.date === input.date && Math.abs(minutes(item.time) - minutes(input.time)) < 60 && (item.principalId === input.principalId || item.clientId === input.clientId));
    if (conflict) throw new Error('此时间与已有预约冲突，请检查康复师跨店安排及客户时间');
    const before = existing ? copy(existing) : null;
    const row = existing || { id: this._id('a') };
    Object.assign(row, input, { status: 'confirmed', requestNote: '', request: null });
    if (!existing) this.state.appointments.push(row);
    this.state.tasks.filter(item => item.appointmentId === row.id && item.type === 'reschedule').forEach(item => { item.status = 'completed'; });
    this._log('appointment_saved', { appointmentId: row.id, clientId: client.id, before, after: copy(row) }, role);
    return row;
  }

  cancelAppointment(id, reason, role) {
    const row = this.state.appointments.find(item => item.id === id);
    if (!row) throw new Error('预约记录不存在');
    this._staff(role, row.clientId);
    if (!['confirmed', 'reschedule_requested'].includes(row.status)) throw new Error('该预约已结束或已取消');
    row.cancelReason = required(reason, '取消原因');
    row.status = 'cancelled';
    this.state.tasks.filter(item => item.appointmentId === id && item.type === 'reschedule').forEach(item => { item.status = 'completed'; });
    this._log('appointment_cancelled', { appointmentId: id, clientId: row.clientId, reason: row.cancelReason }, role);
    return row;
  }

  requestReschedule(id, data, role) {
    const row = this.state.appointments.find(item => item.id === id);
    if (!row) throw new Error('预约记录不存在');
    if (role?.type !== 'customer' || role.id !== row.clientId) throw new Error('仅客户本人有权限提交改约申请');
    if (!['confirmed', 'reschedule_requested'].includes(row.status)) throw new Error('此预约已结束或已取消，不能改约');
    const request = { date: validDate(data.date), time: validTime(data.time), reason: required(data.reason || data.requestNote, '改约说明') };
    if (request.date < TODAY) throw new Error('不能改约到过去的日期');
    row.status = 'reschedule_requested';
    row.request = request;
    row.requestNote = request.reason;
    const existingTask = this.state.tasks.find(item => item.appointmentId === id && item.type === 'reschedule' && item.status === 'pending');
    if (existingTask) existingTask.title = `确认${this._client(row.clientId).name}的改约申请`;
    else this.state.tasks.push({ id: this._id('task'), clientId: row.clientId, appointmentId: id, title: `确认${this._client(row.clientId).name}的改约申请`, type: 'reschedule', assigneeId: this._client(row.clientId).ownerId, dueDate: TODAY, status: 'pending' });
    this._log('reschedule_requested', { appointmentId: id, clientId: row.clientId, request }, role);
    return row;
  }

  completeTask(id, role) {
    const row = this.state.tasks.find(item => item.id === id);
    if (!row) throw new Error('待办事项不存在');
    if (role?.type === 'boss') this._boss(role);
    else if (role?.type !== 'therapist' || role.id !== row.assigneeId || !this.canSeeClient(role, row.clientId)) throw new Error('仅待办负责人或老板有权限完成');
    if (row.type === 'reschedule' && this.state.appointments.find(item => item.id === row.appointmentId)?.status === 'reschedule_requested') throw new Error('请先确认新的预约时间或取消预约，再完成此待办');
    if (row.type === 'review_followup' && this.state.reviews.find(item => item.id === row.reviewId)?.followupStatus !== 'closed') throw new Error('请先填写反馈处理结果，再完成此待办');
    row.status = 'completed';
    row.completedBy = role.id;
    row.completedAt = new Date().toISOString();
    this._log('task_completed', { taskId: id, clientId: row.clientId }, role);
    return row;
  }

  submitReview(serviceId, data, role) {
    const service = this.state.services.find(item => item.id === serviceId);
    if (!service) throw new Error('服务记录不存在');
    if (role?.type !== 'customer' || role.id !== service.clientId) throw new Error('仅客户本人有权限评价本次服务');
    if (service.status !== 'valid' || service.date > TODAY) throw new Error('仅有效且已完成的服务可以评价');
    if (this.state.reviews.some(item => item.serviceId === serviceId)) throw new Error('本次服务已评价，每次服务只能评价一次');
    const score = Number(data.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('请选择 1 至 5 分的评分');
    const wantContact = Boolean(data.wantContact);
    const followup = score <= 3 || wantContact;
    const row = {
      id: this._id('r'), serviceId, clientId: service.clientId, score,
      feedback: String(data.feedback ?? '').trim(), wantContact,
      followupStatus: followup ? 'pending' : 'none', createdAt: new Date().toISOString(),
    };
    this.state.reviews.unshift(row);
    if (followup) this.state.tasks.push({ id: this._id('task'), type: 'review_followup', reviewId: row.id, clientId: row.clientId, title: `跟进${this._client(row.clientId).name}的服务反馈`, assigneeId: 'boss', dueDate: TODAY, status: 'pending' });
    this._log('review_submitted', { reviewId: row.id, serviceId, clientId: row.clientId, score }, role);
    return row;
  }

  closeFollowup(reviewId, resolution, role) {
    this._boss(role);
    const row = this.state.reviews.find(item => item.id === reviewId);
    if (!row) throw new Error('反馈不存在');
    if (row.followupStatus !== 'pending') throw new Error('此反馈没有待处理跟进');
    row.resolution = required(resolution, '反馈处理结果');
    row.followupStatus = 'closed';
    row.resolvedBy = role.id;
    row.resolvedAt = new Date().toISOString();
    this.state.tasks.filter(item => item.reviewId === reviewId).forEach(item => { item.status = 'completed'; item.completedBy = role.id; });
    this._log('review_followup_closed', { reviewId, clientId: row.clientId, resolution: row.resolution }, role);
    return row;
  }

  addStore(data, role) {
    this._boss(role);
    const name = required(data.name, '门店名称');
    if (this.state.stores.some(item => item.name === name)) throw new Error('门店名称重复，请使用可区分的名称');
    const row = { id: this._id('store'), name, address: required(data.address, '门店地址') };
    this.state.stores.push(row);
    this._log('store_added', { storeId: row.id, after: row }, role);
    return row;
  }

  addTherapist(data, role) {
    this._boss(role);
    this._store(data.storeId);
    const row = { id: this._id('t'), name: required(data.name, '康复师姓名'), storeId: data.storeId, active: true };
    this.state.therapists.push(row);
    this._log('therapist_added', { therapistId: row.id, after: row }, role);
    return row;
  }

  deactivateTherapist(id, role) {
    this._boss(role);
    const row = this._therapist(id);
    if (this.state.clients.some(item => item.ownerId === id)) throw new Error('该康复师仍有负责客户，请先转交客户再停用');
    if (this.state.appointments.some(item => item.principalId === id && ['confirmed', 'reschedule_requested'].includes(item.status))) throw new Error('该康复师仍有预约，请先改派或取消预约再停用');
    if (this.state.tasks.some(item => item.assigneeId === id && item.status === 'pending')) throw new Error('该康复师仍有未完成待办，请先处理后再停用');
    row.active = false;
    this._log('therapist_deactivated', { therapistId: id }, role);
    return row;
  }

  transferClient(clientId, newOwnerId, reason, role) {
    this._boss(role);
    const client = this._client(clientId);
    this._therapist(newOwnerId);
    const why = required(reason, '转交原因');
    const oldOwnerId = client.ownerId;
    if (oldOwnerId === newOwnerId) throw new Error('新负责人和当前负责人相同');
    client.ownerId = newOwnerId;
    this.state.tasks.filter(item => item.clientId === clientId && item.assigneeId === oldOwnerId && item.status === 'pending').forEach(item => { item.assigneeId = newOwnerId; });
    this._log('client_transferred', { clientId, oldOwnerId, newOwnerId, reason: why }, role);
    return client;
  }

  importOpening(data, role) {
    this._boss(role);
    const name = required(data.name, '客户姓名');
    const phone = required(data.phone, '手机号').replace(/\s/g, '');
    if (!/^1\d{10}$/.test(phone)) throw new Error('请输入 11 位手机号');
    if (this.state.clients.some(item => item.phone === phone)) throw new Error('该手机号已存在，请核对原客户档案，避免重复迁入');
    this._therapist(data.ownerId);
    this._store(data.storeId);
    const amount = Number(data.amount), total = Number(data.total), remaining = Number(data.remaining ?? data.openingRemaining);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(total) || total <= 0 || !Number.isInteger(remaining) || remaining < 0 || remaining > total) throw new Error('请核对套餐金额、总次数和剩余次数');
    const clientId = this._id('c'), packageId = this._id('p');
    const client = seedClient(clientId, name, data.ownerId, data.storeId, packageId, phone);
    const sourceNotes = String(data.notes ?? '').trim();
    client.openingNotes = sourceNotes;
    if (String(data.goal || '').trim()) client.goal = String(data.goal).trim();
    const pack = { id: packageId, clientId, name: String(data.packageName || '运动功能恢复套餐').trim(), amount: money(amount), total, openingUsed: total - remaining, status: 'current' };
    this.state.clients.push(client);
    this.state.packages.push(pack);
    this._log('opening_import', { clientId, packageId, total, remaining, openingUsed: total - remaining, sourceNotes, note: '纸质期初余额迁入，不计入系统消费业绩' }, role);
    return client;
  }
}
