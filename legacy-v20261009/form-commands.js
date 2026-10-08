// This is an input mapper, never an identity/permission checker or a domain
// writer. The server revalidates the payload, live account and resource scope.
// No server secret, token, role selection or computed balance comes from here.
export class FormCommandError extends Error {
  constructor(message) { super(message); this.name = 'FormCommandError'; this.code = 'INVALID_FORM'; }
}
const fail = message => { throw new FormCommandError(message); };
const aliases = new Map([
  ['register','register-service'], ['register-appointment','register-service'],
  ['edit-plan','publish-plan'], ['appointment-create','save-appointment'],
  ['appointment-edit','save-appointment'], ['appointment-cancel','cancel-appointment'],
  ['appointment-no-show','mark-no-show'], ['reschedule','request-reschedule'],
  ['task-complete','complete-task'], ['review','submit-review'], ['followup','close-followup'],
]);
const commands = new Set([
  'register-service','revoke-service','publish-plan','save-appointment','cancel-appointment',
  'mark-no-show','record-arrival','request-reschedule','complete-task','submit-review',
  'close-followup','add-store','add-therapist','deactivate-therapist','add-frontdesk',
  'deactivate-frontdesk','transfer-client','import-opening','import-opening-batch','renew-package','activate-package',
  'record-receipt','refund-receipt','void-receipt','void-refund','settle-receipt','create-invitation',
]);
function asText(value, name, max = 80, empty = false) {
  if (typeof value !== 'string') fail(`请填写有效的 ${name}`);
  const text = value.trim();
  if ((!empty && !text) || text.length > max) fail(`${name} 未填写或超过允许长度`);
  return text;
}
function fields(input) {
  const isForm = typeof FormData !== 'undefined' && input instanceof FormData;
  if (!isForm && !Array.isArray(input)) fail('表单输入须为 FormData 或字段 entries 数组');
  const data = new Map();
  let count = 0;
  for (const pair of isForm ? input.entries() : input) {
    if (++count > 1000 || !Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string') fail('表单字段格式无效或过多');
    if (!data.has(pair[0])) data.set(pair[0], []);
    data.get(pair[0]).push(pair[1]);
  }
  function raw(name, otherNames = []) {
    let found = false, value;
    for (const key of [name, ...otherNames]) {
      if (!data.has(key)) continue;
      if (found || data.get(key).length !== 1) fail(`${name} 出现重复或冲突字段，请重新打开表单`);
      found = true; value = data.get(key)[0];
    }
    return value;
  }
  const text = (name, max = 80, empty = false, otherNames = [], fallback) => {
    const value = raw(name, otherNames);
    return asText(value === undefined ? fallback : value, name, max, empty);
  };
  function many(name, min = 0, max = 20, length = 80, unique = true) {
    const values = data.get(name) || [];
    if (values.length < min || values.length > max) fail(`${name} 数量不符合要求`);
    const list = values.map(value => asText(value, name, length));
    if (unique && new Set(list).size !== list.length) fail(`${name} 不能重复选择`);
    return list;
  }
  return { raw, text, many, has: name => data.has(name) };
}
function integer(raw, name, minimum = 1, maximum = 999) {
  const value = asText(raw, name, 12);
  if (!/^\d+$/.test(value)) fail(`${name} 须为整数，不能截断或自动修正`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) fail(`${name} 超出允许范围`);
  return result;
}
function money(raw) {
  const text = asText(raw, 'amount', 20);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) fail('金额须为最多两位小数的正数，请按实际账单填写');
  const [whole, fraction = ''] = text.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor < 1n || minor > 100000000n) fail('金额须在 0.01 至 1,000,000 元之间');
  return Number(minor) / 100;
}
function day(raw) {
  const value = asText(raw, 'date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('请填写有效日期');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) fail('请填写真实存在的日期');
  return value;
}
function clock(raw) {
  const value = asText(raw, 'time', 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) fail('请填写有效的24小时时间');
  return value;
}
function choice(raw, name, values, fallback) {
  const value = raw === undefined ? fallback : asText(raw, name);
  if (!values.includes(value)) fail(`${name} 选项无效`);
  return value;
}
function checkbox(raw) {
  if (raw === undefined || raw === false || raw === 'false') return false;
  if (raw === true || raw === 'true' || raw === 'on') return true;
  fail('希望联系选项须为明确的勾选状态');
}
function progressFromForm(f, context) {
  const metricFields = f.has('progressMetricLabel') || f.has('progressMetricValue');
  if (context.progress !== undefined) {
    if (f.has('progressSummary') || f.has('progressStatus') || metricFields) fail('本次评估存在两份输入，请选择一份明确记录');
    const value = context.progress;
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.metrics) || value.metrics.length > 20) fail('本次评估格式无效');
    const status = choice(value.status, 'progress.status', ['pending','updated']);
    const summary = asText(value.summary, 'progress.summary', 3000, true);
    const metrics = value.metrics.map(metric => {
      if (!metric || typeof metric !== 'object' || Array.isArray(metric)) fail('本次评估指标格式无效');
      return { label: asText(metric.label,'progress.metric.label',80), value: asText(metric.value,'progress.metric.value',160) };
    });
    if (status === 'updated' && !summary) fail('请填写本次阶段复评说明');
    return {status,summary,metrics};
  }
  if (!f.has('progressSummary') && !f.has('progressStatus') && !metricFields) return undefined;
  const summary = f.text('progressSummary',3000,true,[], '');
  const status = choice(f.raw('progressStatus'),'progressStatus',['pending','updated'],summary ? 'updated' : 'pending');
  const labels = f.many('progressMetricLabel',0,20,80,false), values = f.many('progressMetricValue',0,20,160,false);
  if (labels.length !== values.length) fail('评估指标标签和值须成对填写');
  const metrics = labels.map((label,index)=>({label,value:asText(values[index],'progressMetricValue',160)}));
  if (status === 'updated' && !summary) fail('请填写本次阶段复评说明');
  return {status,summary,metrics};
}

/**
 * Map a real UI form into a whitelisted API command.
 * context.client may be the current server-visible client, used only when a
 * clientId field is absent. context.view/role is never used as authorization.
 * Service context.photoIds must be IDs returned by actual uploads in this
 * operation; context.consent must be the user's explicit boolean confirmation.
 * context.progress, when provided, is a fresh explicit assessment input, never
 * an automatically copied client.progress. Omit conflicting progress fields.
 * This function does not upload, authenticate, generate requestIds or mutate
 * input/context. All role/scope/balance decisions remain server-side.
 */
export function mapFormCommand(formType, input, context = {}) {
  const command = aliases.get(formType) || formType;
  if (!commands.has(command)) fail('此入口没有正式写命令，不能提交示例、筛选或重置操作');
  if (!context || typeof context !== 'object' || Array.isArray(context)) fail('当前表单上下文无效');
  const f = fields(input);
  const clientId = () => f.text('clientId',80,false,[],context.client?.id);
  const optional = (payload, name, max = 80) => {
    const value = f.raw(name);
    if (value !== undefined) payload[name] = asText(value,name,max,true);
  };
  const when = () => ({date:day(f.raw('date')),time:clock(f.raw('time'))});
  let payload;
  switch (command) {
    case 'register-service': {
      if (context.consent !== true) fail('请明确确认已经征得客户同意后，再提交本次留底');
      const ids = context.photoIds;
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 3 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) fail('请先完成本次1–3张照片上传，使用上传成功的照片编号');
      payload = {clientId:clientId(),storeId:f.text('storeId'),...when(),project:f.text('project',120),principalId:f.text('principalId'),participantIds:f.many('participantIds'),notes:f.text('notes',4000),photoIds:ids.slice(),consent:true};
      const appointmentId = f.raw('appointmentId');
      if (appointmentId !== undefined) payload.appointmentId = asText(appointmentId,'appointmentId');
      if (payload.participantIds.includes(payload.principalId)) fail('主康复师不能同时选为协作人员');
      break;
    }
    case 'revoke-service': payload={serviceId:f.text('serviceId',80,false,['id']),reason:f.text('reason',1000)}; break;
    case 'publish-plan': {
      payload={clientId:clientId(),goal:f.text('goal',120),phase:f.text('phase',120),nextStep:f.text('nextStep',1000),planNotes:f.text('planNotes',4000),homeAdvice:f.text('homeAdvice',4000)};
      const progress = progressFromForm(f, context);
      if (progress !== undefined) payload.progress = progress;
      const title = f.text('taskTitle',500,true,[], '');
      if (title) { payload.taskTitle=title; payload.assigneeId=f.text('assigneeId'); payload.dueDate=day(f.raw('dueDate')); }
      break;
    }
    case 'save-appointment':
      payload={clientId:clientId(),...when(),storeId:f.text('storeId'),principalId:f.text('principalId'),project:f.text('project',120)};
      if (f.has('id')) payload.id=f.text('id');
      break;
    case 'cancel-appointment': case 'mark-no-show':
      payload={appointmentId:f.text('appointmentId',80,false,['id']),reason:f.text('reason',1000)}; break;
    case 'record-arrival':
      payload={appointmentId:f.text('appointmentId',80,false,['id'])}; optional(payload,'notes',1000); break;
    case 'request-reschedule':
      payload={appointmentId:f.text('appointmentId',80,false,['id']),...when(),reason:f.text('reason',1000)}; break;
    case 'complete-task': payload={taskId:f.text('taskId',80,false,['id'])}; break;
    case 'submit-review':
      payload={serviceId:f.text('serviceId',80,false,['id']),score:integer(f.raw('score'),'score',1,5),feedback:f.text('feedback',2000,true,[], ''),wantContact:checkbox(f.raw('wantContact'))}; break;
    case 'close-followup': payload={reviewId:f.text('reviewId',80,false,['id']),resolution:f.text('resolution',3000,false,['result'])}; break;
    case 'add-store': payload={name:f.text('name',120),address:f.text('address',500)}; break;
    case 'add-therapist': payload={name:f.text('name'),storeId:f.text('storeId')}; break;
    case 'deactivate-therapist': payload={therapistId:f.text('therapistId',80,false,['id'])}; break;
    case 'add-frontdesk': payload={name:f.text('name'),storeIds:f.many('storeIds',1,99)}; break;
    case 'deactivate-frontdesk': payload={frontDeskId:f.text('frontDeskId',80,false,['id'])}; break;
    case 'transfer-client': payload={clientId:clientId(),newOwnerId:f.text('newOwnerId',80,false,['ownerId']),reason:f.text('reason',1000)}; break;
    case 'import-opening': {
      const phone = f.text('phone',30).replace(/\s+/gu,'');
      if (!/^1\d{10}$/.test(phone)) fail('请核对11位手机号');
      payload={name:f.text('name'),phone,ownerId:f.text('ownerId'),storeId:f.text('storeId'),amount:money(f.raw('amount')),total:integer(f.raw('total'),'total'),remaining:integer(f.raw('remaining',['openingRemaining']),'remaining',0,999),packageName:f.text('packageName'),notes:f.text('notes',4000)};
      if (payload.remaining > payload.total) fail('期初剩余次数不能超过套餐总次数');
      if (f.has('goal')) payload.goal=f.text('goal',120);
      break;
    }
    case 'import-opening-batch': {
      const rows=context.openingRows;
      if(!Array.isArray(rows)||rows.length<1||rows.length>50)fail('每批请核对1至50名客户');
      payload={rows:rows.map(row=>{
        if(!row||typeof row!=='object'||Array.isArray(row))fail('批量客户资料格式无效');
        for(const key of ['amount','total','remaining'])if(typeof row[key]!=='number'||!Number.isFinite(row[key]))fail('批量金额和次数须经过明确检查');
        const entries=['name','phone','ownerId','storeId','packageName','notes','goal'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]);
        for(const key of ['amount','total','remaining'])entries.push([key,String(row[key])]);
        return mapFormCommand('import-opening',entries).payload;
      })};
      const batchLabel=f.text('batchLabel',120,true,[], '');
      if(batchLabel)payload.batchLabel=batchLabel;
      break;
    }
    case 'renew-package': payload={clientId:clientId(),name:f.text('name'),amount:money(f.raw('amount')),total:integer(f.raw('total'),'total'),reason:f.text('reason',1000)}; break;
    case 'activate-package': payload={packageId:f.text('packageId',80,false,['id']),reason:f.text('reason',1000)}; break;
    case 'record-receipt': {
      const channel=choice(f.raw('channel'),'channel',['direct','douyin','meituan','other_platform'],'direct');
      payload={storeId:f.text('storeId'),...when(),purpose:choice(f.raw('purpose'),'purpose',['package','renewal','single','other','platform_settlement']),method:choice(f.raw('method'),'method',['wechat','alipay','cash','bank']),amount:money(f.raw('amount')),channel,settlementStatus:choice(f.raw('settlementStatus'),'settlementStatus',['received','pending'],'received')};
      const client=f.text('clientId',80,true,[], '');
      if (client) payload.clientId=client;
      if (channel === 'direct') {
        if (!client || payload.settlementStatus !== 'received' || payload.purpose === 'platform_settlement') fail('门店直接收款须选择客户，并记录已到账款项');
      } else payload.reference=f.text('reference',160);
      optional(payload,'notes',2000);
      if (payload.purpose === 'other' && !payload.notes) fail('其他款项请说明用途');
      break;
    }
    case 'refund-receipt': payload={receiptId:f.text('receiptId',80,false,['id']),amount:money(f.raw('amount')),...when(),reason:f.text('reason',1000)}; break;
    case 'void-receipt': payload={receiptId:f.text('receiptId',80,false,['id']),reason:f.text('reason',1000)}; break;
    case 'void-refund': payload={refundId:f.text('refundId',80,false,['id']),reason:f.text('reason',1000)}; break;
    case 'settle-receipt':
      payload={receiptId:f.text('receiptId',80,false,['id']),amount:money(f.raw('amount')),...when(),reference:f.text('reference',160)}; optional(payload,'notes',2000); break;
    case 'create-invitation':
      // This role selects an invitation target, never the caller's identity.
      payload={role:choice(f.raw('role'),'role',['customer','therapist','frontdesk']),subjectId:f.text('subjectId')}; break;
  }
  return {command,payload};
}
