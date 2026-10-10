/* Assessment records and employee reviews for the fictional in-memory preview. */
const clone = value => JSON.parse(JSON.stringify(value));
const CONCLUSIONS = Object.freeze({ met: '符合要求', improve: '需改进', unobserved: '未观察' });
const ASSESSMENT_TYPES = Object.freeze({ initial: '初次评估', followup: '阶段复评' });
const STATUSES = Object.freeze({ pending: '待康复师确认', confirmed: '已确认', voided: '已撤销', valid: '已记录' });
const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });
const SHANGHAI_MOMENT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function text(value, label, max = 1000, required = true) {
  if (value != null && typeof value !== 'string') throw new Error(`请填写有效的${label}`);
  const result = (value ?? '').trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > max) throw new Error(`${label}长度不能超过 ${max} 字`);
  return result;
}
function date(value, label = '日期') {
  const result = text(value, label, 10);
  const parsed = Date.parse(`${result}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== result) throw new Error(`请选择有效的${label}`);
  return result;
}
function time(value) {
  const result = text(value, '时间', 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new Error('请选择有效时间');
  return result;
}
function stamp(model) {
  const value = model.now();
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('当前记录时间无效，请刷新后重试');
  return value;
}
function businessDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '';
  const parts = Object.fromEntries(SHANGHAI_DATE.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function currentDate(model) {
  const actual = businessDate(stamp(model));
  const demo = date(model.today);
  return actual > demo ? actual : demo;
}
function actualMoment(model) {
  const value = stamp(model);
  const parts = Object.fromEntries(SHANGHAI_MOMENT.formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, stamp: value };
}
function assertOccurred(model, row) {
  const actual = actualMoment(model);
  if (`${date(row.date)} ${time(row.time)}` > `${actual.date} ${actual.time}`) throw new Error('实际评估时间尚未发生，请核对日期和时间后再登记或确认');
  return actual;
}
function find(model, kind, id, label) {
  const row = model.state[kind]?.find(item => item.id === id);
  if (!row) throw new Error(`${label}不存在或已不可用`);
  return row;
}
function isBoss(role) { return role?.type === 'boss' && role.id === 'boss'; }
function assertBoss(role) { if (!isBoss(role)) throw new Error('仅老板有权限登记或撤销此记录'); }
function frontDesk(model, id, requireActive = true) {
  const row = find(model, 'frontDesks', id, '前台');
  if (requireActive && row.active !== true) throw new Error('前台账号已停用，您没有操作权限');
  return row;
}
function assertReader(model, role) {
  if (isBoss(role)) return;
  if (role?.type === 'frontdesk') return frontDesk(model, role.id);
  if (role?.type === 'therapist') {
    const person = find(model, 'therapists', role.id, '康复师');
    if (!person.active) throw new Error('康复师账号已停用，您没有操作权限');
    return;
  }
  if (role?.type === 'customer' && model.state.clients.some(row => row.id === role.id)) return;
  throw new Error('您没有查看此记录的权限');
}
function assertClient(model, role, clientId) {
  assertReader(model, role);
  const client = find(model, 'clients', clientId, '客户');
  if (!model.canSeeClient(role, clientId)) throw new Error('您没有此客户资料的查看或登记权限');
  return client;
}
function assertAssessmentWriter(model, role, clientId, storeId) {
  if (!isBoss(role) && !['frontdesk', 'therapist'].includes(role?.type)) throw new Error('评估资料仅前台、康复师或老板有权限登记');
  const client = assertClient(model, role, clientId);
  find(model, 'stores', storeId, '门店');
  if (role.type === 'frontdesk' && !frontDesk(model, role.id).storeIds.includes(storeId)) throw new Error('您没有此门店的评估登记权限');
  return client;
}
function canConfirm(model, role, row) {
  if (isBoss(role)) return true;
  if (row.assessorId) return false;
  if (role?.type !== 'therapist') return false;
  const person = model.state.therapists.find(item => item.id === role.id && item.active);
  const client = model.state.clients.find(item => item.id === row.clientId);
  return Boolean(person && person.legacy && client && model.canSeeClient(role, row.clientId) && (role.id === row.therapistId || role.id === client.ownerId));
}
function canReadAssessment(model, role, row) {
  if (!model.canSeeClient(role, row.clientId)) return false;
  if (role.type === 'customer') return row.clientId === role.id && row.status === 'confirmed';
  if (role.type === 'frontdesk') return frontDesk(model, role.id).storeIds.includes(row.storeId);
  return isBoss(role) || role.type === 'therapist';
}
function originalOrder(rows) {
  return rows.slice().sort((a, b) => `${b.date || b.to || ''} ${b.time || ''} ${b.createdAt || ''}`.localeCompare(`${a.date || a.to || ''} ${a.time || ''} ${a.createdAt || ''}`) || b.id.localeCompare(a.id));
}
function log(model, type, data, role) { model._log(type, clone(data), role); }
function nextId(model, prefix) {
  let id;
  do { id = model._id(prefix); } while ([...model.state.assessments, ...model.state.frontDeskEvaluations].some(row => row.id === id));
  return id;
}
function repeated(rows, role, requestId, inputKey) {
  const row = rows.find(item => item.recordedBy === role.id && item.recordedRole === role.type && item.requestId === requestId);
  if (!row) return null;
  if (row.inputKey !== inputKey) throw new Error('同一提交标识的内容已改变，请重新打开表单；原记录不会被覆盖');
  return row;
}

export function ensureEvaluations(model) {
  if (!model?.state || typeof model.now !== 'function') throw new Error('评估记录尚未准备好，请刷新页面');
  const addDemo = model.state.assessments === undefined;
  if (model.state.assessments === undefined) model.state.assessments = [];
  if (model.state.frontDeskEvaluations === undefined) model.state.frontDeskEvaluations = [];
  if (!Array.isArray(model.state.assessments) || !Array.isArray(model.state.frontDeskEvaluations)) throw new Error('评估记录数据无效，请重置示例后再试');
  const expectedNames = ['陈一诺', '许安然', '周沐', '赵清禾', '王星野', '顾清宁'];
  const standardDemo = model.state.clients.length === 6 && model.state.stores.length === 2 &&
    expectedNames.every((name, index) => model.state.clients.some(row => row.id === `c${index + 1}` && row.name === name)) &&
    ['a', 'b'].every(id => model.state.stores.some(row => row.id === id)) &&
    ['t1', 't2'].every(id => model.state.therapists.some(row => row.id === id && row.active)) &&
    ['f1', 'f2'].every(id => model.state.frontDesks?.some(row => row.id === id && row.active));
  if (addDemo && standardDemo) {
    const demoDate = date(model.today);
    const demoStamp = `${demoDate}T03:00:00.000Z`;
    const common = { type: 'initial', project: '运动功能记录（示例）', date: demoDate, time: '10:00', summary: '虚构示例：客户自述的测试完成次数，需由康复师核对；不代表康复结论。', metrics: [{ name: '客户自述下蹲测试完成次数', value: '5', unit: '次' }], recordedRole: 'frontdesk', createdAt: demoStamp, example: true };
    model.state.assessments.push(
      { id: 'assessment-example-a', ...clone(common), clientId: 'c3', storeId: 'a', therapistId: 't1', recordedBy: 'f1', status: 'pending' },
      { id: 'assessment-example-b', ...clone(common), clientId: 'c1', storeId: 'b', therapistId: 't2', recordedBy: 'f2', status: 'confirmed', confirmedBy: 't2', confirmedRole: 'therapist', confirmedAt: demoStamp },
    );
  }
  return model;
}

export function assessmentRows(model, role, { clientId = '', storeId = '' } = {}) {
  ensureEvaluations(model);
  assertReader(model, role);
  if (clientId) assertClient(model, role, clientId);
  if (storeId) {
    find(model, 'stores', storeId, '门店');
    if (role.type === 'frontdesk' && !frontDesk(model, role.id).storeIds.includes(storeId)) throw new Error('您没有此门店的评估记录查看权限');
  }
  return clone(originalOrder(model.state.assessments.filter(row => (!clientId || row.clientId === clientId) && (!storeId || row.storeId === storeId) && canReadAssessment(model, role, row))));
}

export function latestConfirmedAssessment(model, role, clientId) {
  return assessmentRows(model, role, { clientId }).find(row => row.status === 'confirmed') || null;
}

export function recordAssessment(model, data, role) {
  ensureEvaluations(model);
  const requestId = text(data.requestId, '提交标识', 80);
  const clientId = text(data.clientId, '客户', 80), storeId = text(data.storeId, '评估门店', 80);
  assertAssessmentWriter(model, role, clientId, storeId);
  const client=model._client(clientId);
  let assessorId,therapistId;
  if (data.assessorId || !data.therapistId || client.assessorId) {
    assessorId=text(data.assessorId || client.assessorId || 'tao','评估师',80);
    if(assessorId!=='tao'||data.therapistId)throw new Error('评估师固定为涛博士，治疗师不能代替评估师');
    if(role.type==='therapist')throw new Error('专业评估资料请由前台代录或涛博士登记');
  } else {
    therapistId=text(data.therapistId,'历史评估康复师',80);
    const therapist=find(model,'therapists',therapistId,'历史评估康复师');
    if(!therapist.legacy||!therapist.active||!model.canSeeClient({type:'therapist',id:therapistId},clientId))throw new Error('请选择涛博士作为评估师');
  }
  const type = text(data.type, '评估类型', 20);
  if (!Object.hasOwn(ASSESSMENT_TYPES, type)) throw new Error('请选择初次评估或阶段复评');
  const metrics = [];
  for (let i = 1; i <= 3; i++) {
    const name = text(data[`metricName${i}`], `指标 ${i} 名称`, 80, false);
    const value = text(data[`metricValue${i}`], `指标 ${i} 实际值`, 200, false);
    const unit = text(data[`metricUnit${i}`], `指标 ${i} 单位`, 30, false);
    if (!name && !value && !unit) continue;
    if (!name || !value) throw new Error(`请完整填写指标 ${i} 的名称和实际值`);
    metrics.push({ name, value, unit });
  }
  if (!metrics.length) throw new Error('请至少完整填写一组指标名称和实际值');
  const input = { clientId, storeId, date: date(data.date), time: time(data.time), type, project: text(data.project, '评估项目', 80), ...(assessorId?{assessorId}:{therapistId}), summary: text(data.summary, '评估记录说明', 2000), metrics };
  const inputKey = JSON.stringify(input);
  const existing = repeated(model.state.assessments, role, requestId, inputKey);
  if (existing) return clone(existing);
  const actual = assertOccurred(model, input);
  const row = { id: nextId(model, 'assessment'), ...input, status: 'pending', recordedBy: role.id, recordedRole: role.type, createdAt: actual.stamp, requestId, inputKey };
  model.state.assessments.push(row);
  log(model, 'assessment_recorded', { assessmentId: row.id, clientId, storeId, therapistId, status: row.status }, role);
  return clone(row);
}

function getAssessment(model, id, role) {
  ensureEvaluations(model);
  assertReader(model, role);
  const row = find(model, 'assessments', id, '评估记录');
  if (!canReadAssessment(model, role, row)) throw new Error('您没有查看此评估记录的权限；客户仅查看已确认的本人记录');
  return row;
}

export function confirmAssessment(model, id, role) {
  const row = getAssessment(model, id, role);
  if (!canConfirm(model, role, row)) throw new Error('仅指定评估康复师、客户负责人或老板有权限确认评估');
  if (row.status === 'voided') throw new Error('已撤销的评估不能再次确认，请重新登记正确记录');
  if (row.status === 'confirmed') return clone(row);
  if (row.status !== 'pending') throw new Error('当前评估状态不可确认，请刷新后核对');
  const actual = assertOccurred(model, row);
  row.status = 'confirmed'; row.confirmedBy = role.id; row.confirmedRole = role.type; row.confirmedAt = actual.stamp;
  log(model, 'assessment_confirmed', { assessmentId: row.id, clientId: row.clientId, storeId: row.storeId, therapistId: row.therapistId }, role);
  return clone(row);
}

export function voidAssessment(model, id, reason, role) {
  assertBoss(role);
  const row = getAssessment(model, id, role);
  const why = text(reason, '撤销原因', 1000);
  if (row.status === 'voided') throw new Error('此评估记录已撤销，不能重复撤销');
  const previousStatus = row.status;
  row.status = 'voided'; row.voidReason = why; row.voidedBy = role.id; row.voidedAt = stamp(model);
  log(model, 'assessment_voided', { assessmentId: row.id, clientId: row.clientId, storeId: row.storeId, previousStatus, reason: why }, role);
  return clone(row);
}

function employeeReader(model, role, id) {
  const target = frontDesk(model, id, !isBoss(role));
  if (isBoss(role)) return target;
  if (role?.type !== 'frontdesk' || role.id !== id) throw new Error('仅老板或前台本人有权限查看此工作记录');
  frontDesk(model, role.id);
  return target;
}
function period(model, options = {}) {
  const today = currentDate(model);
  const from = date(options.from || `${today.slice(0, 7)}-01`, '开始日期');
  const to = date(options.to || today, '结束日期');
  if (from > to) throw new Error('统计期间的开始日期不能晚于结束日期');
  if (to > today) throw new Error('统计结束日期不能晚于今天');
  return { from, to };
}
function uniqueRows(rows) { return [...new Map(rows.map(row => [row.id, row])).values()]; }

export function frontDeskWorkSummary(model, role, frontDeskId, options = {}) {
  ensureEvaluations(model);
  const target = employeeReader(model, role, frontDeskId);
  const { from, to } = period(model, options);
  const storeId = options.storeId || '';
  if (storeId && !target.storeIds.includes(storeId)) throw new Error('请选择此前台当前授权的门店');
  if (storeId) find(model, 'stores', storeId, '门店');
  const stores = new Set(storeId ? [storeId] : target.storeIds);
  const between = value => value >= from && value <= to;
  const arrivals = uniqueRows(model.state.appointments.filter(row => stores.has(row.storeId) && row.arrivalByRole === 'frontdesk' && row.arrivalBy === frontDeskId && row.arrivalAt && between(businessDate(row.arrivalAt))));
  // Old appointment events do not preserve a reliable historical store. Report
  // these as this employee's cross-store operations, never as selected-store work.
  const operations = uniqueRows(model.state.audit.filter(row => row.actorType === 'frontdesk' && row.actorId === frontDeskId && ['appointment_saved', 'appointment_cancelled', 'appointment_no_show'].includes(row.type) && between(businessDate(row.createdAt))));
  const receipts = uniqueRows((model.state.receipts || []).filter(row => stores.has(row.storeId) && row.recordedRole === 'frontdesk' && row.recordedBy === frontDeskId && row.status === 'valid' && between(row.date)));
  const receiptAmountMinor = receipts.reduce((sum, row) => {
    if (!Number.isSafeInteger(row.amountMinor) || row.amountMinor < 0) throw new Error('收款记录金额待核对，不能生成工作统计');
    const next = sum + row.amountMinor;
    if (!Number.isSafeInteger(next)) throw new Error('收款汇总金额超出支持范围，请缩短统计期间');
    return next;
  }, 0);
  return { frontDeskId, storeId, from, to, arrivalCount: arrivals.length, arrivalIds: arrivals.map(row => row.id), appointmentOperationCount: operations.length, appointmentOperationIds: operations.map(row => row.id), appointmentOperationScope: 'all-operated-stores', receiptCount: receipts.length, receiptIds: receipts.map(row => row.id), receiptAmountMinor, receiptAmount: receiptAmountMinor / 100 };
}

export function recordFrontDeskEvaluation(model, data, role) {
  ensureEvaluations(model);
  assertBoss(role);
  const requestId = text(data.requestId, '提交标识', 80);
  const frontDeskId = text(data.frontDeskId, '前台人员', 80), storeId = text(data.storeId, '考核门店', 80);
  frontDesk(model, frontDeskId);
  const { from, to } = period(model, { from: data.from, to: data.to });
  const conclusions = {};
  for (const [key, label] of [['dataConclusion', '资料记录'], ['receptionConclusion', '接待配合'], ['cashConclusion', '收款交接']]) {
    conclusions[key] = text(data[key], `${label}结论`, 20);
    if (!Object.hasOwn(CONCLUSIONS, conclusions[key])) throw new Error(`请选择有效的${label}项目结论`);
  }
  const improvement = text(data.improvement, '改进事项', 2000, false);
  const dueDate = data.dueDate ? date(data.dueDate, '改进计划日期') : '';
  if (improvement && !dueDate) throw new Error('填写改进事项后，请填写有效的改进计划日期');
  const input = { frontDeskId, storeId, from, to, ...conclusions, summary: text(data.summary, '考核说明', 2000), improvement, dueDate };
  const inputKey = JSON.stringify(input), existing = repeated(model.state.frontDeskEvaluations, role, requestId, inputKey);
  if (existing) return clone(existing);
  const snapshot = clone(frontDeskWorkSummary(model, role, frontDeskId, { from, to, storeId }));
  const row = { id: nextId(model, 'frontdesk-evaluation'), ...input, snapshot, status: 'valid', recordedBy: role.id, recordedRole: role.type, createdAt: stamp(model), requestId, inputKey };
  model.state.frontDeskEvaluations.push(row);
  log(model, 'frontdesk_evaluation_recorded', { evaluationId: row.id, frontDeskId, storeId, from, to }, role);
  return clone(row);
}

export function frontDeskEvaluationRows(model, role, frontDeskId) {
  ensureEvaluations(model);
  const target = employeeReader(model, role, frontDeskId);
  return clone(originalOrder(model.state.frontDeskEvaluations.filter(row => row.frontDeskId === frontDeskId && (isBoss(role) || target.storeIds.includes(row.storeId)))));
}

function getEmployeeEvaluation(model, id, role) {
  ensureEvaluations(model);
  const row = find(model, 'frontDeskEvaluations', id, '前台考核记录');
  if (!frontDeskEvaluationRows(model, role, row.frontDeskId).some(item => item.id === id)) throw new Error('您没有此考核记录的查看权限');
  return row;
}

export function voidFrontDeskEvaluation(model, id, reason, role) {
  assertBoss(role);
  const row = getEmployeeEvaluation(model, id, role);
  const why = text(reason, '撤销原因', 1000);
  if (row.status === 'voided') throw new Error('此前台考核记录已撤销，不能重复撤销');
  row.status = 'voided'; row.voidReason = why; row.voidedBy = role.id; row.voidedAt = stamp(model);
  log(model, 'frontdesk_evaluation_voided', { evaluationId: row.id, frontDeskId: row.frontDeskId, storeId: row.storeId, reason: why }, role);
  return clone(row);
}

function ui(ctx) {
  const esc = ctx.esc || (value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])));
  const name = (kind, id) => id === 'boss' ? '老板' : ctx.model.state[kind]?.find(row => row.id === id)?.name || '历史人员';
  const actorName = row => name(row.recordedRole === 'frontdesk' ? 'frontDesks' : 'therapists', row.recordedBy);
  const button = (label, type, id = '', primary = false) => `<button type="button" class="btn ${primary ? 'btn-primary' : 'btn-outline'}" data-action="${esc(type)}" data-id="${esc(id)}">${esc(label)}</button>`;
  const field = (label, key, value = '', type = 'text', attrs = '') => `<label class="field"><span>${esc(label)}</span><input type="${type}" name="${key}" value="${esc(value)}" ${attrs}></label>`;
  const hidden = (key, value) => `<input type="hidden" name="${key}" value="${esc(value)}">`;
  const select = (label, key, rows, value = '') => `<label class="field"><span>${esc(label)}</span><select name="${key}" required>${rows.map(row => `<option value="${esc(row.id)}" ${row.id === value ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label>`;
  const textarea = (label, key, attrs = '') => `<label class="field span-all"><span>${esc(label)}</span><textarea name="${key}" rows="3" ${attrs}></textarea></label>`;
  const form = (type, body, label) => `<form data-form="${type}">${body}<div class="dialog-footer"><button type="submit" class="btn btn-primary">${esc(label)}</button>${button('返回', 'close-dialog')}</div></form>`;
  const status = row => `<span class="tag ${row.status === 'confirmed' || row.status === 'valid' ? 'tag-green' : row.status === 'voided' ? 'tag-warn' : ''}">${esc(STATUSES[row.status] || '待核对')}</span>`;
  const money = value => ctx.fmt?.money ? ctx.fmt.money(value) : `¥${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;
  return { esc, name, actorName, button, field, hidden, select, textarea, form, status, money };
}
function metricsHtml(ctx, row) {
  const x = ui(ctx);
  return `<dl class="evaluation-metrics">${row.metrics.map(metric => `<div class="assessment-metric-row"><dt>${x.esc(metric.name)}</dt><dd>${x.esc(metric.value)}${metric.unit ? ` <small>${x.esc(metric.unit)}</small>` : ''}</dd></div>`).join('')}</dl>`;
}
function assessmentCard(ctx, row, showClient = false, mode = 'list') {
  const x = ui(ctx);
  return `<article class="evaluation-record"><div class="section-head"><div><h3>${showClient ? `${x.esc(x.name('clients', row.clientId))} · ` : ''}${x.esc(ASSESSMENT_TYPES[row.type])}</h3><p class="meta">${x.esc(row.date)} ${x.esc(row.time)} · ${x.esc(x.name('stores', row.storeId))}</p></div>${x.status(row)}</div><p><strong>${x.esc(row.project)}</strong></p>${metricsHtml(ctx, row)}<p class="evaluation-summary">${x.esc(row.summary)}</p><p class="meta">评估康复师 ${x.esc(x.name(row.assessorId?'assessors':'therapists', row.assessorId||row.therapistId))} · 录入 ${x.esc(x.actorName(row))}</p>${row.status === 'confirmed' ? `<p class="meta">确认 ${x.esc(x.name('therapists', row.confirmedBy))} · ${x.esc(businessDate(row.confirmedAt))}</p>` : ''}${row.status === 'voided' ? `<p class="notice">撤销原因：${x.esc(row.voidReason)}。原数据保留供核对。</p>` : ''}${row.example ? '<p class="meta">虚构示例数据</p>' : ''}<div class="action-row">${mode === 'list' ? x.button('查看记录', 'assessment-detail', row.id) : ''}${mode !== 'confirm' && row.status === 'pending' && canConfirm(ctx.model, ctx.role, row) ? x.button('核对并确认', 'assessment-confirm', row.id, true) : ''}${mode !== 'confirm' && isBoss(ctx.role) && row.status !== 'voided' ? x.button('撤销错误记录', 'assessment-void', row.id) : ''}</div></article>`;
}

export function renderAssessmentHistory(ctx, clientId) {
  const client = assertClient(ctx.model, ctx.role, clientId);
  const rows = assessmentRows(ctx.model, ctx.role, { clientId });
  const x = ui(ctx);
  return `<section class="evaluation-section"><div class="section-head"><div><h2>${ctx.role.type === 'customer' ? '我的评估记录' : `${x.esc(client.name)}的评估记录`}</h2><p class="meta">逐次保存实际记录，确认后客户可查看。</p></div>${ctx.role.type !== 'customer' ? x.button('登记评估', 'assessment-create', clientId, true) : ''}</div><div class="evaluation-records">${rows.map(row => assessmentCard(ctx, row)).join('') || '<div class="empty">暂无可查看的评估记录。涛博士核对并确认后，会显示在这里。</div>'}</div><p class="meta">记录评估资料不会扣套餐次数，也不改变收款与消费业绩。</p></section>`;
}

export function renderReceptionAssessments(ctx, storeId) {
  if (!isBoss(ctx.role) && ctx.role.type !== 'frontdesk') throw new Error('仅老板和授权前台可使用此门店评估登记入口');
  const rows = assessmentRows(ctx.model, ctx.role, { storeId });
  const x = ui(ctx), pending = rows.filter(row => row.status === 'pending');
  return `<section class="evaluation-section"><div class="section-head"><div><h2>最近登记</h2><p class="meta">前台代录资料，康复师核对后确认。</p></div>${x.button('登记评估', 'assessment-create', '', true)}</div><p class="meta">本店待确认 ${pending.length} 条 · 历史 ${rows.length} 条</p><div class="evaluation-records">${rows.map(row => assessmentCard(ctx, row, true)).join('') || '<div class="empty">本店暂无评估记录，可从客户名单开始登记。</div>'}</div></section>`;
}

function summaryHtml(ctx, summary, snapshot = false) {
  const x = ui(ctx);
  return `<div class="evaluation-work-stats"><div><span>本人确认到店</span><strong>${summary.arrivalCount}<small> 次</small></strong></div><div><span>预约办理操作</span><strong>${summary.appointmentOperationCount}<small> 次</small></strong><small>跨门店经办量</small></div><div><span>登记到账</span><strong>${summary.receiptCount}<small> 笔</small></strong><small>${x.esc(x.money(summary.receiptAmount))}</small></div></div><p class="meta">${snapshot ? '保存时的工作记录快照' : '当前实际工作记录'} · ${x.esc(summary.from)} 至 ${x.esc(summary.to)}。到店、到账按${summary.storeId ? x.esc(x.name('stores', summary.storeId)) : '当前授权门店'}统计；预约操作是跨门店经办量，不能归为本店全部工作。到账金额为登记经办量，平台待结算不计入。</p>`;
}
function employeeCard(ctx, row, showDetail = true) {
  const x = ui(ctx);
  return `<article class="evaluation-record"><div class="section-head"><div><h3>${x.esc(row.from)} 至 ${x.esc(row.to)}</h3><p class="meta">${x.esc(x.name('stores', row.storeId))} · 老板记录</p></div>${x.status(row)}</div><div class="evaluation-conclusions"><span>资料记录 <strong>${x.esc(CONCLUSIONS[row.dataConclusion])}</strong></span><span>接待配合 <strong>${x.esc(CONCLUSIONS[row.receptionConclusion])}</strong></span><span>收款交接 <strong>${x.esc(CONCLUSIONS[row.cashConclusion])}</strong></span></div><p>${x.esc(row.summary)}</p>${row.improvement ? `<div class="note"><strong>改进事项</strong><p>${x.esc(row.improvement)}</p><p class="meta">计划日期 ${x.esc(row.dueDate)}</p></div>` : ''}${row.status === 'voided' ? `<p class="notice">已撤销：${x.esc(row.voidReason)}。原结论与工作快照保留。</p>` : ''}<div class="action-row">${showDetail ? x.button('查看考核记录', 'frontdesk-evaluation-detail', row.id) : ''}${isBoss(ctx.role) && row.status !== 'voided' ? x.button('撤销错误记录', 'frontdesk-evaluation-void', row.id) : ''}</div></article>`;
}

export function renderFrontDeskWork(ctx, frontDeskId) {
  const target = employeeReader(ctx.model, ctx.role, frontDeskId);
  const selectedStore = target.storeIds.includes(ctx.filters?.storeId) ? ctx.filters.storeId : target.storeIds[0] || '';
  const summary = frontDeskWorkSummary(ctx.model, ctx.role, frontDeskId, { storeId: selectedStore });
  const rows = frontDeskEvaluationRows(ctx.model, ctx.role, frontDeskId), x = ui(ctx);
  return `<section class="evaluation-section"><div class="section-head"><div><h2>${isBoss(ctx.role) ? `${x.esc(x.name('frontDesks', frontDeskId))}的工作记录` : '我的工作记录'}</h2><p class="meta">先看实际工作，再看老板的评估说明。</p></div>${isBoss(ctx.role) ? x.button('新增考核记录', 'frontdesk-evaluate', frontDeskId, true) : ''}</div>${summaryHtml(ctx, summary)}<p class="notice">工作数量供核对，不自动换成达标率或评级；没有观察的项目记录为“未观察”。</p><h3>历史考核记录</h3><div class="evaluation-records">${rows.map(row => employeeCard(ctx, row)).join('') || '<div class="empty">暂无考核记录。老板记录后，您可以查看结论、依据和改进事项。</div>'}</div></section>`;
}

export function evaluationDialog(type, id, ctx) {
  const known = ['assessment-create', 'assessment-history', 'assessment-detail', 'assessment-confirm', 'assessment-void', 'frontdesk-work', 'frontdesk-evaluate', 'frontdesk-evaluation-detail', 'frontdesk-evaluation-void'];
  if (!known.includes(type)) return null;
  if (type === 'assessment-create' && ctx.role.type === 'therapist' && !ctx.model._therapist(ctx.role.id).legacy) throw new Error('专业评估资料请由前台代录或涛博士登记');
  ensureEvaluations(ctx.model);
  const x = ui(ctx), { model, role } = ctx;
  if (type === 'assessment-history') return { title: '客户评估记录', html: renderAssessmentHistory(ctx, id) };
  if (type === 'assessment-create') {
    if (!isBoss(role) && !['frontdesk', 'therapist'].includes(role.type)) throw new Error('仅前台、康复师或老板有权限登记评估资料');
    assertReader(model, role);
    const clients = model.visibleClients(role);
    if (!id) return { title: '选择评估客户', html: `<p class="muted">选择本次需要登记资料的客户。</p><div class="evaluation-client-choices">${clients.map(client => x.button(client.name, 'assessment-create', client.id)).join('') || '<p class="empty">暂无可登记的客户，请先由老板安排客户到本店。</p>'}</div>` };
    const client = assertClient(model, role, id);
    const stores = role.type === 'frontdesk' ? model.state.stores.filter(store => frontDesk(model, role.id).storeIds.includes(store.id)) : model.state.stores;
    const assessors = model.state.assessors || [{id:'tao',name:'涛博士'}];
    if (!assessors.length) return { title: '客户评估资料登记', html: '<p class="empty">此客户暂没有可选的在职评估康复师，请先由老板核对客户负责人。</p>' };
    const selectedStore = stores.some(store => store.id === ctx.filters?.storeId) ? ctx.filters.storeId : stores.some(store => store.id === client.storeId) ? client.storeId : stores[0]?.id;
    const actual = actualMoment(model);
    return { title: `登记${client.name}的评估资料`, html: x.form(type, `${x.hidden('clientId', id)}<div class="note"><strong>${x.esc(client.name)}</strong><p>请代录实际评估资料；涛博士核对并确认后，客户才能查看。</p></div><div class="form-grid">${x.select('评估门店', 'storeId', stores, selectedStore)}${x.select('评估类型', 'type', Object.entries(ASSESSMENT_TYPES).map(([value, label]) => ({ id: value, name: label })), 'initial')}${x.field('实际评估日期', 'date', actual.date, 'date', `required max="${actual.date}"`)}${x.field('实际评估时间', 'time', actual.time, 'time', 'required')}${x.field('评估项目', 'project', '', 'text', 'required maxlength="80" placeholder="填写实际项目"')}${x.select('评估师', 'assessorId', assessors, 'tao')}${[1, 2, 3].map(i => `<fieldset class="evaluation-metric-field field span-all"><legend>指标 ${i}${i === 1 ? ' · 至少填写一组' : '（选填）'}</legend><div class="evaluation-metric-inputs">${x.field('指标名称', `metricName${i}`, '', 'text', `${i === 1 ? 'required' : ''} maxlength="80"`)}${x.field('实际记录值', `metricValue${i}`, '', 'text', `${i === 1 ? 'required' : ''} maxlength="200" placeholder="按原始记录填写"`)}${x.field('单位（选填）', `metricUnit${i}`, '', 'text', 'maxlength="30"')}</div></fieldset>`).join('')}${x.textarea('记录说明', 'summary', 'required maxlength="2000" placeholder="记录来源、观察与核对事项，不自动生成诊断或康复结论"')}</div><p class="meta">本次仅保存评估资料，不扣次数、不记收入；错误由老板写原因后撤销，原数据保留。</p>`, '保存 · 等待涛博士确认') };
  }
  if (['assessment-detail', 'assessment-confirm', 'assessment-void'].includes(type)) {
    const row = getAssessment(model, id, role);
    if (type === 'assessment-detail') return { title: '评估数据明细', html: assessmentCard(ctx, row, true, 'detail') };
    if (type === 'assessment-confirm') {
      if (!canConfirm(model, role, row) || row.status !== 'pending') throw new Error('仅有权限的评估康复师、客户负责人或老板可以确认待确认记录');
      assertOccurred(model, row);
      return { title: '核对并确认评估', html: x.form(type, `${x.hidden('id', id)}${assessmentCard(ctx, row, true, 'confirm')}<p class="notice">请先核对上述原始数据。确认后客户能查看；此操作不修改康复计划、不扣次数。</p>`, '已核对 · 确认发布') };
    }
    assertBoss(role);
    if (row.status === 'voided') throw new Error('此评估记录已撤销');
    return { title: '撤销错误评估记录', html: x.form(type, `${x.hidden('id', id)}<p class="notice">撤销后客户不再看到此记录，原数据与确认历史保留；请重新登记正确资料。</p>${x.textarea('撤销原因', 'reason', 'required maxlength="1000"')}`, '保留原记录并撤销') };
  }
  if (type === 'frontdesk-work') return { title: '前台工作与考核', html: renderFrontDeskWork(ctx, id || role.id) };
  if (type === 'frontdesk-evaluate') {
    assertBoss(role);
    const target = frontDesk(model, id), stores = model.state.stores.filter(store => target.storeIds.includes(store.id));
    const defaults = period(model), selectedStore = stores.some(store => store.id === ctx.filters?.storeId) ? ctx.filters.storeId : stores[0]?.id;
    const choices = Object.entries(CONCLUSIONS).map(([value, label]) => ({ id: value, name: label }));
    return { title: `记录${target.name}的工作考核`, html: x.form(type, `${x.hidden('frontDeskId', id)}<p class="muted">记录真实观察和改进安排，保存当时工作数量快照。不自动打分或计算准确率。</p><div class="form-grid">${x.select('考核门店', 'storeId', stores, selectedStore)}${x.field('开始日期', 'from', defaults.from, 'date', 'required')}${x.field('结束日期', 'to', defaults.to, 'date', `required max="${defaults.to}"`)}${x.select('资料记录', 'dataConclusion', choices, 'unobserved')}${x.select('接待配合', 'receptionConclusion', choices, 'unobserved')}${x.select('收款交接', 'cashConclusion', choices, 'unobserved')}${x.textarea('考核说明与核对依据', 'summary', 'required maxlength="2000"')}${x.textarea('需要改进的事项（选填）', 'improvement', 'maxlength="2000"')}${x.field('改进计划日期 · 有事项时必填', 'dueDate', '', 'date')}</div><p class="meta">只由老板登记和撤销。前台可查看本人记录；原结论与工作快照保留。</p>`, '保存考核记录') };
  }
  const row = getEmployeeEvaluation(model, id, role);
  if (type === 'frontdesk-evaluation-detail') return { title: `${x.name('frontDesks', row.frontDeskId)}的考核明细`, html: `${employeeCard(ctx, row, false)}${summaryHtml(ctx, row.snapshot, true)}<p class="meta">记录人 老板 · ${x.esc(businessDate(row.createdAt))}</p>` };
  assertBoss(role);
  if (row.status === 'voided') throw new Error('此前台考核记录已撤销');
  return { title: '撤销错误考核记录', html: x.form(type, `${x.hidden('id', id)}<p class="notice">原结论、统计期间和工作快照都会保留。需要更正时，请撤销后另记一条。</p>${x.textarea('撤销原因', 'reason', 'required maxlength="1000"')}`, '保留原记录并撤销') };
}
