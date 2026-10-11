import {INITIAL_CASE_VERSION, INITIAL_CASE_FIELDS, normalizeInitialCase, projectInitialCase, renderInitialCaseFields, renderInitialCaseDetail, paperIntakeChoices, paperChoiceOptions, caseIsMinor} from './paper-case-form.js?v=20261011-customer-search-layout-7a';
/* Client-stated reception information. This module never makes a diagnosis or authorizes treatment. */
const clone = value => JSON.parse(JSON.stringify(value));
export const PAPER_SAFETY_QUESTIONS = Object.freeze([
  ['treatment', '正在接受医生治疗，或今天感觉身体不适'],
  ['acuteInjury', '近期有扭伤、挫伤等急性损伤'],
  ['lumbar', '有腰椎间盘等腰椎问题'],
  ['dislocation', '有习惯性脱臼'],
  ['gout', '有痛风或风湿相关问题'],
  ['pregnancy', '已怀孕或疑似怀孕'],
  ['alcohol', '今天有饮酒'],
  ['osteoporosis', '有骨质疏松'],
  ['veins', '有静脉曲张'],
  ['breathing', '有呼吸或循环系统异常'],
].map(([key, label]) => Object.freeze({ key, label })));
const ANSWERS = Object.freeze({ yes: '是', no: '否', unknown: '不清楚' });
const SOURCES = Object.freeze({ douyin: '抖音', meituan: '美团', referral: '朋友介绍', wechat: '微信', nearby: '附近居民 / 路过', other: '其他', unknown: '暂未记录' });
const EXERCISE = Object.freeze({ never: '基本不运动', monthly: '每月 1–2 次', weekly_1_2: '每周 1–2 次', weekly_3_4: '每周 3–4 次', weekly_5: '每周 5 次及以上', unknown: '暂未记录' });
const DECISIONS = Object.freeze({ contact: '先联系康复师核对', assessment: '继续安排专业评估', other: '其他安排' });
const ROW_KEYS = ['formVersion','initialCase','version','history','id', 'clientId', 'storeId', 'appointmentId', 'ownerId', 'assessorId', 'date', 'time', 'age', 'problem', 'goal', 'bodyArea', 'duration', 'impact', 'pain', 'sex', 'source', 'referrer', 'exercise', 'recentCare', 'surgery', 'allergies', 'emergencyName', 'emergencyPhone', 'guardianName', 'guardianPhone', 'safetyNotes', 'answers', 'status', 'createdAt', 'createdBy', 'createdRole', 'reviewedAt', 'reviewedBy', 'reviewedRole', 'review'];
const text = (value, label, required = false, max = 1000) => {
  if (value != null && typeof value !== 'string') throw new Error(`请填写有效的${label}`);
  const result = (value ?? '').trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > max) throw new Error(`${label}不能超过 ${max} 字`);
  return result;
};
const number = (value, label, min, max) => {
  if (!['number', 'string'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) throw new Error(`请填写有效的${label}`);
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new Error(`${label}须为 ${min}–${max} 的整数`);
  return result;
};
const phone = (value, label, required = false) => {
  const result = text(value, label, required, 30).replace(/\s/g, '');
  if (result && !/^1\d{10}$/.test(result)) throw new Error(`${label}请填写 11 位手机号`);
  return result;
};
function choice(value, choices, label, fallback = '') {
  const result = text(value, label, false, 80) || fallback;
  if (result && !Object.hasOwn(choices, result)) throw new Error(`请选择有效的${label}`);
  return result;
}
function collection(model) {
  if (model.state.paperIntakes !== undefined && !Array.isArray(model.state.paperIntakes)) throw new Error('初访接待记录集合无效');
  return model.state.paperIntakes || [];
}
function actorStores(model, role) {
  if (!['boss', 'franchise_owner', 'manager', 'frontdesk', 'therapist'].includes(role?.type)) throw new Error('仅老板、店长、前台和康复师有接待记录权限');
  if(role.type==='franchise_owner')return model.ownerStoreIds(role);
  return model.receptionStoreIds(role);
}
function clientFor(model, role, clientId, appointmentId) {
  actorStores(model, role);
  const client = model.state.clients.find(row => row.id === clientId);
  const reception=appointmentId?model.receptionAppointment(role,appointmentId,{arrived:true}):null;
  const assigned=client&&model.isAssignedAssessor(role,client.assessorId,client.storeId);
  if (!client || !(model.canSeeClient(role, clientId)||assigned||reception?.clientId===clientId)) throw new Error('您没有该客户的接待记录权限');
  return client;
}
function canRead(model, role, row, stores) {
  const client = model.state.clients.find(item => item.id === row.clientId);
  if (!client) return false;
  if(model.isAssignedAssessor(role,row.assessorId,row.storeId))return true;
  if(row.appointmentId&&row.date===model.today&&row.createdBy===role.id&&row.createdRole===role.type){try{model.receptionAppointment(role,row.appointmentId);return true;}catch{return false;}}
  if(!model.canSeeClient(role,client.id))return false;
  // The unified owner can read cross-store records. A designated execution
  // therapist reads only records from that exact authorized store; professional
  // review remains with the unified owner in reviewPaperIntake.
  if (role.type === 'therapist') return client.ownerId === role.id ||
    (client.assessorId && model.state.appointments.some(a=>a.clientId===client.id&&a.storeId===row.storeId&&a.principalId===role.id)) ||
    (typeof model.clientStoreTherapist === 'function' && model.clientStoreTherapist(client.id, row.storeId) === role.id);
  return stores.includes(row.storeId);
}
function attention(row) {
  if(row.formVersion===INITIAL_CASE_VERSION)return [];
  return PAPER_SAFETY_QUESTIONS.filter(q => row.answers?.[q.key] !== 'no').map(q => ({ key: q.key, label: q.label, answer: Object.hasOwn(ANSWERS, row.answers?.[q.key]) ? row.answers[q.key] : 'unanswered' }));
}
function project(row, role) {
  const result = Object.fromEntries(ROW_KEYS.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
  if(row.formVersion!==INITIAL_CASE_VERSION) result.answers = Object.fromEntries(PAPER_SAFETY_QUESTIONS.filter(q => Object.hasOwn(ANSWERS, row.answers?.[q.key])).map(q => [q.key, row.answers[q.key]]));
  if (row.review) result.review = Object.fromEntries(['decision', 'nextStep', 'notes', 'assigneeId', 'dueDate', 'taskId', 'assignmentDefaulted'].filter(key => row.review[key] !== undefined).map(key => [key, row.review[key]]));
  result.attentionItems = attention(row);
  if(!['boss','franchise_owner'].includes(role?.type))delete result.history;
  if (role?.type === 'therapist') { delete result.guardianPhone; delete result.emergencyPhone; }
  return projectInitialCase(clone(result),role);
}
function readRecord(model, id, role) {
  const stores = actorStores(model, role), row = collection(model).find(item => item.id === id);
  if (!row || !canRead(model, role, row, stores)) throw new Error('您没有该接待记录的查看权限');
  return row;
}
function currentStamp(model) {
  const stamp = model.now();
  if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) throw new Error('记录时间无效，请稍后重试');
  const createdAt = new Date(stamp).toISOString();
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(createdAt));
  return { createdAt, date: model.today, time };
}
function localTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '时间未记录';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`;
}
function nextSequence(model) {
  const suffixes = Object.values(model.state).filter(Array.isArray).flatMap(rows => rows.map(row => Number(/(\d+)$/.exec(row?.id)?.[1] || 0)));
  const next = Math.max(model.sequence, 0, ...suffixes) + 1;
  if (!Number.isSafeInteger(next + 2)) throw new Error('记录编号超出可用范围');
  return next;
}
function followupAssignees(model, client, storeId) {
  const localId = typeof model.clientStoreTherapist === 'function' ? model.clientStoreTherapist(client.id, storeId) : '';
  const people=model.state.therapists.filter(t => t.active === true && ([client.ownerId, localId].includes(t.id) || client.assessorId && model.state.appointments.some(a=>a.clientId===client.id&&a.storeId===storeId&&a.principalId===t.id)) && model.canSeeClient({ type: 'therapist', id: t.id }, client.id));
  return client.assessorId || !people.some(t=>t.id===client.ownerId) ? [{id:'boss',name:'王勤涛',storeId},...people] : people;
}
function followupAssignment(model, client, storeId, data) {
  // Old callers did not supply assignment fields. An explicit but incomplete
  // assignment never falls back: new forms must choose both person and date.
  const assignmentDefaulted = !Object.hasOwn(data, 'assigneeId') && !Object.hasOwn(data, 'dueDate');
  const assigneeId = text(assignmentDefaulted ? (client.assessorId || !model.state.therapists.some(t=>t.id===client.ownerId&&t.active) ? 'boss' : client.ownerId) : data.assigneeId, '下一步负责人', true, 80);
  const dueDate = text(assignmentDefaulted ? model.today : data.dueDate, '计划日期', true, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(Date.parse(dueDate)) || new Date(dueDate).toISOString().slice(0, 10) !== dueDate) throw new Error('请填写有效的计划日期');
  if (dueDate < model.today) throw new Error('计划日期不能早于今天，请选择下一步实际计划完成的日期');
  if (!followupAssignees(model, client, storeId).some(t => t.id === assigneeId)) throw new Error('下一步负责人须为在职且有该客户授权的负责康复师或本店执行康复师');
  return { assigneeId, dueDate, assignmentDefaulted };
}
function audit(id, action, row, role, stamp, extra = {}) {
  return { id, type: action, actorId: role.id, actorType: role.type, createdAt: stamp, clientId: row.clientId, storeId: row.storeId, paperIntakeId: row.id, after: { status: row.status, ownerId: row.ownerId }, ...extra };
}
function normalized(model, data, role) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请填写初访接待表');
  const clientId = text(data.clientId, '客户', true, 80), storeId = text(data.storeId, '接待门店', true, 80);
  const appointment=data.appointmentId?model.receptionAppointment(role,data.appointmentId,{arrived:true}):null;
  if(appointment&&(appointment.clientId!==clientId||appointment.storeId!==storeId))throw new Error('预约与本次接待对象或门店不一致');
  const stores = appointment?[appointment.storeId]:actorStores(model, role), client = clientFor(model, role, clientId,data.appointmentId);
  if (!stores.includes(storeId)) throw new Error('您没有该门店的接待记录权限，或门店已停用');
  const owner = model.state.therapists.find(row => row.id === client.ownerId && row.active === true);
  if (!appointment && !owner && !client.assessorId) throw new Error('负责康复师不存在或已停用，请先由老板安排负责人');
  if (!appointment && role.type === 'therapist' && client.ownerId !== role.id&&!model.isAssignedAssessor(role,client.assessorId,storeId)) throw new Error('请从已到店预约填写本次初访信息');
  if(data.formVersion!==undefined&&data.formVersion!==INITIAL_CASE_VERSION&&data.formVersion!=='legacy_risk_v1')throw new Error('初诊表版本无效');
  if(data.formVersion===INITIAL_CASE_VERSION){
    const keys=new Set(['formVersion','clientId','storeId','appointmentId','assessorId','initialCase','requestId']);
    if(Object.keys(data).some(k=>!keys.has(k)))throw new Error('初诊表提交包含非法字段');
    if(role?.type==='therapist'&&data.initialCase?.phone!=null&&data.initialCase.phone!=='')throw new Error('康复师不能填写客户手机号，请由老板核对主档');
    if(!appointment)throw new Error('新版初诊表须关联今天实际已到店预约');
    const assessorId=data.assessorId||client.assessorId||'tao';
    if(!model.assessorRows(storeId).some(p=>p.id===assessorId))throw new Error('请选择本次门店在职评估师');
    return {formVersion:INITIAL_CASE_VERSION,clientId,storeId,appointmentId:appointment.id,ownerId:client.ownerId,assessorId,age:client.age??null,initialCase:normalizeInitialCase(data.initialCase,{client,date:model.today}),version:0,history:[]};
  }
  const age = number(data.age, '客户年龄', 0, 120), minor = age < 18;
  const assessorId=data.assessorId||client.assessorId||(appointment?'tao':undefined);
  if(assessorId&&!model.assessorRows(storeId).some(p=>p.id===assessorId))throw new Error('请选择本次门店在职评估师');
  const result = { clientId, storeId, ...(appointment?{appointmentId:appointment.id}:{}), ownerId: client.ownerId, ...(assessorId?{assessorId}:{}), age, problem: text(data.problem, '主要问题（客户自述）', true), goal: text(data.goal, '客户希望达到的目标', true), bodyArea: text(data.bodyArea, '主要部位', false, 80), duration: text(data.duration, '持续多久', false, 100), impact: text(data.impact, '影响日常活动', false, 300), pain: data.pain === '' || data.pain == null ? null : number(data.pain, '客户自述疼痛分数', 0, 10), sex: choice(data.sex, { male: '男', female: '女', undisclosed: '不方便填写' }, '性别'), source: choice(data.source, SOURCES, '客户来源', 'unknown'), referrer: text(data.referrer, '介绍人', false, 100), exercise: choice(data.exercise, EXERCISE, '运动频率', 'unknown'), recentCare: text(data.recentCare, '近期就医或病史'), surgery: text(data.surgery, '手术史'), allergies: text(data.allergies, '过敏情况'), emergencyName: text(data.emergencyName, '紧急联系人', false, 80), emergencyPhone: phone(data.emergencyPhone, '紧急联系人手机号'), guardianName: text(data.guardianName, '监护人姓名', minor, 80), guardianPhone: phone(data.guardianPhone, '监护人手机号', minor), safetyNotes: text(data.safetyNotes, '需注意的情况'), answers: {} };
  for (const question of PAPER_SAFETY_QUESTIONS) {
    const answer = data.answers?.[question.key] ?? data[`answer_${question.key}`];
    if (typeof answer !== 'string' || !Object.hasOwn(ANSWERS, answer)) throw new Error(`请逐项确认：${question.label}`);
    result.answers[question.key] = answer;
  }
  return result;
}

export function ensurePaperIntakes(model) {
  collection(model);
  if (model.state.paperIntakes !== undefined) return model;
  model.state.paperIntakes = [];
  if (!model._usesPreviewSeed || !model.state.clients.some(c => c.id === 'c3' && c.name === '周沐') || !model.state.clients.some(c => c.id === 'c2' && c.name === '许安然')) return model;
  const base = { age: 32, bodyArea: '膝部', duration: '两周', impact: '跑步与上下楼', pain: null, sex: '', source: 'referral', referrer: '朋友（示例）', exercise: 'weekly_1_2', recentCare: '', surgery: '', allergies: '', emergencyName: '', emergencyPhone: '', guardianName: '', guardianPhone: '', safetyNotes: '', answers: Object.fromEntries(PAPER_SAFETY_QUESTIONS.map(q => [q.key, 'no'])), status: 'pending', date: model.today, createdAt: `${model.today}T01:00:00.000Z`, createdRole: 'frontdesk' };
  model.state.paperIntakes = [
    { ...clone(base), id: 'paper-demo-a', clientId: 'c3', storeId: 'a', ownerId: 't1', time: '09:00', createdBy: 'f1', problem: '跑步后膝部不适（虚构示例）', goal: '逐步恢复跑步', safetyNotes: '客户记不清近期损伤情况，请负责人核对。', answers: { ...base.answers, acuteInjury: 'unknown' } },
    { ...clone(base), id: 'paper-demo-b', clientId: 'c2', storeId: 'b', ownerId: 't2', time: '09:30', createdBy: 'f2', problem: '久坐后肩颈不适（虚构示例）', bodyArea: '肩颈', goal: '改善久坐后的日常活动体验' },
  ];
  return model;
}

export function paperIntakeRows(model, role) {
  if (role?.type === 'customer') return [];
  const stores = actorStores(model, role);
  return collection(model).filter(row => canRead(model, role, row, stores)).sort((a, b) => `${b.date} ${b.time} ${b.id}`.localeCompare(`${a.date} ${a.time} ${a.id}`)).map(row=>project(row,role));
}

export function savePaperIntake(model, data, role) {
  if(Object.hasOwn(data,'id'))throw new Error('此入口只允许新建记录，已有记录不能通过新建入口修改');
  if(role?.type==='manager'&&!data.appointmentId)throw new Error('店长接待权限仅限今天已到店预约，请从预约填写本次接待表');
  const input = normalized(model, data, role), requestId = text(data.requestId, '接待提交标识', true, 100), inputKey = JSON.stringify(input);
  const prior = collection(model).find(row => row.requestId === requestId && row.createdBy === role.id && row.createdRole === role.type);
  if (prior) { if (prior.inputKey !== inputKey) throw new Error('同一提交的内容发生变化，请重新打开接待表'); return project(prior,role); }
  const moment = currentStamp(model), sequence = nextSequence(model);
  const row = { ...input, ...moment, id: `paper${sequence}`, status: 'pending', createdBy: role.id, createdRole: role.type, requestId, inputKey };
  const log = audit(`audit${sequence + 1}`, 'paper_intake_created', row, role, moment.createdAt);
  model.state.paperIntakes = [...collection(model), row]; model.state.audit = [...model.state.audit, log]; model.sequence = sequence + 1;
  return project(row,role);
}

export function reviewPaperIntake(model, id, data, role) {
  const row = readRecord(model, id, role), client = model._client(row.clientId);
  if(role.type==='boss')model._boss(role);else if(role.type==='franchise_owner')model.assertStoreOwner(role,[row.storeId]);
  else if (!model.isAssignedAssessor(role,row.assessorId,row.storeId)&&(role.type !== 'therapist' || (client.assessorId || !model._therapist(role.id).legacy || role.id !== client.ownerId) || !model.state.therapists.some(t => t.id === role.id && t.active === true))) throw new Error('仅老板或客户当前在职负责康复师有专业复核权限');
  if (!data || typeof data !== 'object') throw new Error('请填写复核记录');
  const decision = choice(data.decision, DECISIONS, '下一步安排');
  if (!decision) throw new Error('请选择下一步安排');
  const review = { decision, nextStep: text(data.nextStep, '下一步具体事项', true, 500), notes: text(data.notes, '复核说明', false, 1000), ...followupAssignment(model, client, row.storeId, data) }, requestId = text(data.requestId, '复核提交标识', true, 100), inputKey = JSON.stringify(review);
  if (row.reviewRequestId === requestId && row.reviewedBy === role.id) { if (row.reviewInputKey !== inputKey) throw new Error('同一复核提交的内容发生变化'); return project(row,role); }
  if (row.status !== 'pending') throw new Error('该记录已复核，请新增本次接待确认表记录变化');
  if(row.formVersion===INITIAL_CASE_VERSION)normalizeInitialCase(row.initialCase,{client:{...row.initialCase,id:row.clientId,age:row.age},date:row.date});
  if (row.formVersion!==INITIAL_CASE_VERSION&&PAPER_SAFETY_QUESTIONS.some(q => !Object.hasOwn(ANSWERS, row.answers?.[q.key]))) throw new Error('安全确认尚未逐项填写，请核对原记录');
  const moment = currentStamp(model), sequence = nextSequence(model), taskId = `task${sequence}`;
  const task = { id: taskId, clientId: row.clientId, storeId: row.storeId, paperIntakeId: row.id, type: 'intake_followup', title: review.nextStep, assigneeId: review.assigneeId, dueDate: review.dueDate, status: 'pending', createdBy: role.id, createdRole: role.type, createdAt: moment.createdAt };
  const updated = { ...row, status: 'reviewed', reviewedAt: moment.createdAt, reviewedBy: role.id, reviewedRole:role.type, review: { ...review, taskId }, reviewRequestId: requestId, reviewInputKey: inputKey };
  model.state.paperIntakes = collection(model).map(item => item.id === id ? updated : item);
  model.state.tasks = [...model.state.tasks, task];
  model.state.audit = [...model.state.audit, audit(`audit${sequence + 1}`, 'paper_intake_reviewed', updated, role, moment.createdAt, { before: { status: row.status }, note: review.nextStep, taskId, assigneeId: review.assigneeId, dueDate: review.dueDate, assignmentDefaulted: review.assignmentDefaulted })]; model.sequence = sequence + 1;
  return project(updated,role);
}

export function amendPaperIntake(model,data,role){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('请填写初诊修订资料');
 const row=collection(model).find(r=>r.id===data.id);if(!row)throw new Error('初诊记录不存在');
 model.assertStoreOwner(role,[row.storeId]);
 const allowed=new Set(['id','expectedVersion','initialCase','reason','requestId']);if(Object.keys(data).some(k=>!allowed.has(k)))throw new Error('初诊修订含非法字段，不能改变客户、预约或评估师');
 if(row.formVersion!==INITIAL_CASE_VERSION)throw new Error('旧风险问答记录保留原表，不能迁移为新版初诊表');
 const expectedVersion=number(data.expectedVersion,'记录版本',0,Number.MAX_SAFE_INTEGER),reason=text(data.reason,'修订原因',true,500),requestId=text(data.requestId,'修订提交标识',true,100);
 const initialCase=normalizeInitialCase(data.initialCase,{client:{...row.initialCase,id:row.clientId,age:row.age},date:row.date}),inputKey=JSON.stringify({id:row.id,expectedVersion,initialCase,reason});
 const prior=model.state.audit.find(a=>a.type==='paper_intake_amended'&&a.actorId===role.id&&a.actorType===role.type&&a.requestId===requestId);
 if(prior){if(prior.inputKey!==inputKey)throw new Error('同一提交的修订内容发生变化');return project(row,role);}
 if((row.version??0)!==expectedVersion)throw new Error('初诊表版本已更新，请重新核对');
 const stamp=currentStamp(model),sequence=nextSequence(model),before={formVersion:row.formVersion,initialCase:clone(row.initialCase),version:row.version??0};
 const entry={before,reason,actorId:role.id,actorRole:role.type,createdAt:stamp.createdAt};
 const updated={...row,initialCase,version:expectedVersion+1,history:[...(row.history||[]),entry]};
 model.state.paperIntakes=collection(model).map(r=>r.id===row.id?updated:r);model.state.audit=[...model.state.audit,audit(`audit${sequence}`,'paper_intake_amended',updated,role,stamp.createdAt,{before,reason,requestId,inputKey})];model.sequence=sequence;
 return project(updated,role);
}

function action(ctx, label, type, id, style = 'btn-outline') { return `<button type="button" class="btn ${style}" data-action="${type}" data-id="${ctx.esc(id)}">${label}</button>`; }
function names(ctx, kind, id) { return ctx.model.state[kind].find(row => row.id === id)?.name || '待核对'; }
function field(ctx, label, name, value = '', attrs = '') { return `<label class="field"><span>${label}</span><input name="${name}" value="${ctx.esc(value)}" ${attrs}></label>`; }
function area(ctx, label, name, value = '', attrs = '') { return `<label class="field span-all"><span>${label}</span><textarea name="${name}" rows="2" ${attrs}>${ctx.esc(value)}</textarea></label>`; }
function select(ctx, label, name, choices, value = '', blank = '请选择（选填）') { return `<label class="field"><span>${label}</span><select name="${name}"><option value="">${blank}</option>${Object.entries(choices).map(([key, title]) => `<option value="${key}"${key === value ? ' selected' : ''}>${title}</option>`).join('')}</select></label>`; }
function assessmentPerson(ctx,client) {return client?.assessorId?names(ctx,'assessors',client.assessorId):names(ctx,'therapists',client?.ownerId);}
function reviewable(ctx, row) {
  const client = ctx.model.state.clients.find(c => c.id === row.clientId);
  const authorized=ctx.model.isAssignedAssessor(ctx.role,row.assessorId,row.storeId)|| (ctx.role.type==='boss'?ctx.role.id==='boss':ctx.role.type==='franchise_owner'?ctx.model.isStoreOwner(ctx.role,[row.storeId]):ctx.role.type==='therapist'&&!client?.assessorId&&ctx.model.state.therapists.some(t=>t.id===ctx.role.id&&t.legacy)&&ctx.role.id===client?.ownerId&&ctx.model.state.therapists.some(t=>t.id===ctx.role.id&&t.active===true));
  return authorized&&row.status==='pending';
}
function handoffSummary(ctx,row,showResult=false) {
  const review=row.review;
  if(!review?.taskId)return '';
  const task=ctx.model.state.tasks.find(t=>t.id===review.taskId&&t.clientId===row.clientId&&t.storeId===row.storeId&&t.paperIntakeId===row.id);
  const personName=id=>id==='boss'?'老板':names(ctx,'therapists',id);
  const assigneeId=task?task.assigneeId:review.assigneeId,dueDate=task?task.dueDate:review.dueDate;
  const changed=task&&(task.assigneeId!==review.assigneeId||task.dueDate!==review.dueDate);
  const original=showResult&&changed?`<p class="meta">复核时安排：${ctx.esc(personName(review.assigneeId))} · ${ctx.esc(review.dueDate)}</p>`:'';
  return `<div class="paper-intake-handoff"><p class="meta">${task?'下一步负责人':'复核时安排：'} ${ctx.esc(personName(assigneeId))} · 计划日期 ${ctx.esc(dueDate)} · ${!task?'待核对待办':task.status==='completed'?'已处理':'待处理'}</p>${original}${review.assignmentDefaulted?'<p class="meta">旧版提交未选择负责人和日期，复核时默认交给当时负责康复师，计划当天处理。</p>':''}${showResult&&task?.completionResult?`<p>处理结果：${ctx.esc(task.completionResult)}</p>`:''}</div>`;
}
function summary(ctx, row) {
  return `<article class="paper-intake-row"><div class="section-head"><h3>${ctx.esc(names(ctx, 'clients', row.clientId))}</h3><span class="tag ${row.status === 'reviewed' ? 'tag-green' : ''}">${row.status === 'reviewed' ? (row.reviewedRole==='boss'?'已由老板复核':'已由负责人复核') : (row.assessorId?'待指定评估师复核':'待负责康复师复核')}</span></div><p class="paper-intake-problem">${ctx.esc(row.formVersion===INITIAL_CASE_VERSION?row.initialCase.illnessDetails||'初诊资料待专业核对':row.problem)}</p><p class="meta">${ctx.esc(row.date)} ${ctx.esc(row.time)} · ${ctx.esc(names(ctx, 'stores', row.storeId))} · 评估人员 ${ctx.esc(row.assessorId?names(ctx,'assessors',row.assessorId):assessmentPerson(ctx,ctx.model.state.clients.find(c=>c.id===row.clientId)))}</p><p class="paper-intake-attention">${row.formVersion===INITIAL_CASE_VERSION?'初诊资料已记录，仍须所选评估师专业复核。':row.attentionItems.length ? '需核对：' + row.attentionItems.map(item => `${ctx.esc(item.label)}（${ANSWERS[item.answer] || '未填写'}）`).join('；') : '十项已逐项填写，仍需负责人专业复核。'}</p><p class="meta">下一步：${ctx.esc(row.review?.nextStep || '联系本次所选评估师，核对后安排专业评估')}</p>${handoffSummary(ctx,row)}<div class="action-row">${action(ctx, '查看接待表', 'paper-intake-detail', row.id)}${reviewable(ctx, row) ? action(ctx, '复核与下一步', 'paper-intake-review', row.id, 'btn-primary') : ''}</div></article>`;
}

export function renderPaperIntakeInbox(ctx) {
  if (ctx.role.type === 'customer') return '';
  const stores = actorStores(ctx.model, ctx.role), selected = ctx.role.type !== 'therapist' && stores.includes(ctx.filters?.storeId) ? ctx.filters.storeId : '';
  const rows = paperIntakeRows(ctx.model, ctx.role).filter(row => row.status === 'pending' && (!selected || row.storeId === selected));
  return `<section class="paper-intake-inbox" aria-label="接待复核"><div class="section-head"><div><h2>初访与服务前确认 · 待复核 <span class="paper-intake-count">${rows.length}</span></h2><p class="meta">只看谁需要跟进、注意什么、谁来处理。</p></div>${action(ctx, '全部接待表', 'paper-intake-list', '', 'btn-small btn-outline')}</div><div data-client-search-list data-client-search-limit="3">${rows.map(row => summary(ctx, row)).join('') || '<p class="muted">当前没有待复核接待表。</p>'}</div>${rows.length > 3 ? `<p class="meta">默认显示前 3 条；按姓名可查找全部待复核，也可点“全部接待表”查看。</p>` : ''}</section>`;
}

export function renderPaperIntakeList(ctx) {
  const stores = actorStores(ctx.model, ctx.role), selected = ctx.role.type === 'therapist' ? '' : stores.includes(ctx.filters?.storeId) ? ctx.filters.storeId : ctx.role.type === 'boss' ? '' : stores[0];
  const relationship = client => !selected || client.storeId === selected || ctx.model.state.packages.some(p => p.clientId === client.id && p.storeId === selected) || ctx.model.state.appointments.some(a => a.clientId === client.id && a.storeId === selected) || ctx.model.state.services.some(s => s.clientId === client.id && s.storeId === selected && s.status === 'valid');
  const clientId = ctx.filters?.clientId;
  const clients = paperIntakeChoices(ctx.model,ctx.role);
  const rows = paperIntakeRows(ctx.model, ctx.role).filter(row => (!selected || row.storeId === selected) && (!clientId || row.clientId === clientId));
  return `<section class="paper-intake-list"><p class="notice">初诊个案资料表：如实记录客户资料，交给本次所选评估师复核。历史表不能替代本次确认。</p><form class="toolbar" data-form="paper-intake-select"><label class="field"><span>按客户姓名搜索</span><input name="paperClientQuery" type="search" placeholder="输入姓名，忽略大小写和空白" autocomplete="off"></label><label class="field"><span>选择要接待的客户</span><select name="clientId" required>${paperChoiceOptions(clients,ctx.esc)}</select></label><input type="hidden" name="appointmentId" value=""><p class="meta" data-paper-search-hint>${clients.length?'请核对姓名和档案号。':'暂无今天实际已到店客户，请先核对预约与到店。'}</p><button class="btn btn-primary" type="submit" disabled>填写本次接待表</button></form><div class="paper-intake-list-rows">${rows.map(row=>summary(ctx,row)).join('')||'<div class="empty">当前暂无可查看的接待表。</div>'}</div></section>`;
}

export function paperIntakeDialog(type, id, ctx) {
  if (!['paper-intake-create', 'paper-intake-detail', 'paper-intake-review', 'paper-intake-list','paper-intake-amend'].includes(type)) return null;
  const { model, esc, role } = ctx;
  if (type === 'paper-intake-list') return { title: '初访与服务前确认记录', html: renderPaperIntakeList(ctx) };
  if (type === 'paper-intake-create') {
    const chosen=ctx.receptionAppointment||paperIntakeChoices(model,role).find(a=>a.clientId===id&&(!ctx.filters?.storeId||a.storeId===ctx.filters.storeId))?.appointmentId;
    const reception=chosen?model.receptionAppointment(role,chosen,{arrived:true}):null;
    if(role.type==='manager'&&!reception)throw new Error('店长接待权限仅限已到店预约，请从预约填写接待表');
    const client = clientFor(model, role, id,reception?.id), stores = reception?[reception.storeId]:actorStores(model, role), selected = stores.includes(ctx.filters?.storeId) ? ctx.filters.storeId : stores.includes(client.storeId) ? client.storeId : stores[0];
    if (!selected) throw new Error('暂无有效接待门店');
    if (!reception&&role.type === 'therapist' && client.ownerId !== role.id&&!model.isAssignedAssessor(role,client.assessorId,client.storeId)) throw new Error('请从已到店预约填写本次初访信息');
    const owner = model.state.therapists.find(t => t.id === client.ownerId && t.active === true);
    if (!reception && !owner && !client.assessorId) throw new Error('负责康复师已停用，请先联系老板核对负责人');
    if(!reception)throw new Error('请从今天实际已到店预约填写本次初诊表');
    return {title:'初诊个案资料表',html:`<form data-form="paper-intake-create" data-client-age="${esc(client.age??'')}"><input type="hidden" name="clientId" value="${esc(client.id)}"><input type="hidden" name="appointmentId" value="${esc(reception.id)}"><input type="hidden" name="storeId" value="${esc(reception.storeId)}"><label class="field"><span>本次评估师</span><select name="assessorId" required data-assessor-store>${model.assessorRows(selected).map(p=>`<option value="${esc(p.id)}"${p.id===(client.assessorId||'tao')?' selected':''}>${esc(p.name)}</option>`).join('')}</select></label>${renderInitialCaseFields(ctx,client)}<p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button><button type="submit" class="btn btn-primary">保存，交给所选评估师复核</button></div></form>`};
  }
  const raw = readRecord(model, id, role), row = project(raw,role), client = model.state.clients.find(c => c.id === row.clientId);
  if(type==='paper-intake-amend'){
   model.assertStoreOwner(role,[row.storeId]);if(row.formVersion!==INITIAL_CASE_VERSION)throw new Error('旧风险表保留原始资料，不能改为新纸表');
   return {title:'更正已保存初诊资料',html:`<form data-form="paper-intake-amend" data-client-age="${esc(row.age??'')}"><input type="hidden" name="id" value="${esc(row.id)}"><input type="hidden" name="expectedVersion" value="${esc(row.version??0)}">${renderInitialCaseFields({...ctx,model:{...model,today:row.date}}, {...row.initialCase,id:row.clientId,age:row.age},row.initialCase)}${area(ctx,'修改原因','reason','','required maxlength="500"')}<p class="notice">保留原内容及修改历史；不能更换客户、门店、预约或所选评估师。</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="submit" class="btn btn-primary">保存初诊资料更正</button></div></form>`};
  }
  if (type === 'paper-intake-review') {
    if (!reviewable(ctx, row)) throw new Error('仅老板或客户当前负责康复师可复核待处理接待表');
    const assignees=followupAssignees(model,client,row.storeId);
    const assignment=`<div class="form-grid"><label class="field"><span>下一步交给谁</span><select name="assigneeId" required><option value="">请选择已授权康复师</option>${assignees.map(t=>`<option value="${esc(t.id)}"${t.id===(client.assessorId?'boss':client.ownerId)?' selected':''}>${esc(t.name)} · ${esc(names(ctx,'stores',t.storeId))}</option>`).join('')}</select></label>${field(ctx,'计划完成日期','dueDate',model.today,`type="date" min="${esc(model.today)}" required`)}</div><p class="meta">本次评估师本人可从协同接待入口登记评估。下一步待办交给已授权负责人接续；完成时须留下结果。</p>`;
    return { title: '接待复核与下一步', html: `<form data-form="paper-intake-review"><input type="hidden" name="id" value="${esc(row.id)}"><div class="note"><strong>${esc(client.name)} · ${esc(row.date)} ${esc(row.time)}</strong>${row.formVersion===INITIAL_CASE_VERSION?renderInitialCaseDetail(ctx,row):`<p>${esc(row.problem)}</p><p>客户目标：${esc(row.goal)}</p>`}</div><p class="notice">${row.formVersion===INITIAL_CASE_VERSION?'初诊资料已记录，仍须所选评估师专业复核。':row.attentionItems.length ? '需核对：' + row.attentionItems.map(q => `${esc(q.label)}（${ANSWERS[q.answer] || '未填写'}）`).join('；') : '十项均记录为“否”，请结合本次情况专业复核。'}${row.safetyNotes ? '<br>客户补充：' + esc(row.safetyNotes) : ''}</p><p class="meta">${action(ctx, '查看完整接待表', 'paper-intake-detail', row.id)}</p>${select(ctx, '复核后的下一步', 'decision', DECISIONS, '', '请选择下一步安排')}${area(ctx, '下一步具体事项', 'nextStep', '', 'required maxlength="500" placeholder="写清接下来做什么、由谁安排"')}${assignment}${area(ctx, '复核说明（选填）', 'notes', '', 'maxlength="1000"')}<p class="meta">这里只记录本次专业核对与工作安排，原始客户回答完整保留；不会自动生成诊断或修改套餐次数。</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button><button type="submit" class="btn btn-primary">保存复核与下一步</button></div></form>` };
  }
  if(row.formVersion===INITIAL_CASE_VERSION)return {title:`${client.name}的初诊个案资料表`,html:`<p class="notice">${row.status==='reviewed'?'已由本次评估师复核':'待指定评估师复核'} · ${esc(row.date)} ${esc(row.time)}</p>${renderInitialCaseDetail(ctx,row)}<h3>下一步</h3><p>${esc(row.review?.nextStep||'待本次所选评估师核对')}</p>${handoffSummary(ctx,row,true)}<div class="action-row">${reviewable(ctx,row)?action(ctx,'复核与下一步','paper-intake-review',row.id,'btn-primary'):''}${model.isStoreOwner(role,[row.storeId])?action(ctx,'更正初诊资料','paper-intake-amend',row.id):''}${action(ctx,'关闭','close-dialog','')}</div>${model.isStoreOwner(role,[row.storeId])&&(row.history||[]).length?`<h3>修订历史</h3>${row.history.map(h=>`<p>${esc(h.createdAt)} · ${esc(h.reason)}</p>${renderInitialCaseDetail(ctx,{initialCase:h.before.initialCase})}`).join('')}`:''}`};
  const show = (label, value) => `<div class="detail-pair"><span class="muted">${label}</span><strong>${esc(value || '未记录')}</strong></div>`;
  return { title: `${client.name}的接待确认表`, html: `<div class="note"><strong>${row.status === 'pending' ? (row.assessorId?'待指定评估师复核':'待负责康复师复核') : row.reviewedRole==='boss'?'已由老板复核':'已由负责康复师复核'}</strong><p>${esc(row.date)} ${esc(row.time)} · ${esc(names(ctx, 'stores', row.storeId))} · 评估人员 ${esc((row.assessorId?names(ctx,'assessors',row.assessorId):assessmentPerson(ctx,client)))}</p><p>记录的是当时情况，历史表不能替代下一次服务前确认。</p></div><h3>主要问题与目标</h3><div class="detail-grid">${show('客户自述问题', row.problem)}${show('客户目标', row.goal)}${show('年龄', `${row.age} 岁`)}${show('主要部位', row.bodyArea)}${show('持续时间', row.duration)}${show('影响活动', row.impact)}${show('客户自述疼痛', row.pain == null ? '未记录' : `${row.pain} / 10`)}</div><h3>本次逐项确认</h3><div class="paper-intake-answers">${PAPER_SAFETY_QUESTIONS.map(q => `<div class="row"><span>${esc(q.label)}</span><strong class="${row.answers[q.key] === 'no' ? '' : 'paper-intake-attention'}">${ANSWERS[row.answers[q.key]] || '未填写'}</strong></div>`).join('')}</div>${row.safetyNotes ? `<p class="paper-intake-problem">情况说明：${esc(row.safetyNotes)}</p>` : ''}<details class="paper-intake-section"><summary>背景与联系人（按需查看）</summary><div class="detail-grid">${show('性别', { male: '男', female: '女', undisclosed: '不方便填写' }[row.sex])}${show('客户来源', SOURCES[row.source])}${show('介绍人', row.referrer)}${show('运动频率', EXERCISE[row.exercise])}${show('客户自述就医 / 病史', row.recentCare)}${show('手术情况', row.surgery)}${show('过敏情况', row.allergies)}${show('紧急联系人', [row.emergencyName, row.emergencyPhone].filter(Boolean).join(' · '))}${show('监护人', [row.guardianName, row.guardianPhone].filter(Boolean).join(' · '))}</div></details><h3>下一步</h3><p class="paper-intake-problem">${esc(row.review?.nextStep || '联系本次所选评估师复核，再安排专业评估')}</p>${row.review ? `<p class="meta">${esc(DECISIONS[row.review.decision])} · ${esc(localTimestamp(row.reviewedAt))} · 复核人 ${esc(row.reviewedRole==='boss'?'王勤涛':names(ctx, row.reviewedRole==='manager'?'storeManagers':'therapists', row.reviewedBy))}</p>${row.review.notes ? `<p>${esc(row.review.notes)}</p>` : ''}${handoffSummary(ctx,row,true)}` : ''}<p class="meta">录入人 ${esc(row.createdRole === 'boss' ? '老板' : names(ctx, row.createdRole === 'frontdesk' ? 'frontDesks' : row.createdRole === 'manager' ? 'storeManagers' : 'therapists', row.createdBy))} · ${esc(localTimestamp(row.createdAt))}</p><div class="action-row">${reviewable(ctx, row) ? action(ctx, '复核与下一步', 'paper-intake-review', row.id, 'btn-primary') : ''}${role.type!=='manager'&&(role.type!=='therapist'||client.ownerId===role.id)?action(ctx, '新增本次接待确认', 'paper-intake-create', row.clientId):''}${action(ctx, '关闭', 'close-dialog', '')}</div>` };
}

export function updatePaperIntakeForm(form, ctx) {
  if (!['paper-intake-create','paper-intake-amend'].includes(form?.dataset.form)) return;
  if(form.elements.formVersion?.value===INITIAL_CASE_VERSION){
    const minor=caseIsMinor({age:form.dataset.clientAge===''?null:Number(form.dataset.clientAge)},form.elements.birthDate?.value||'',ctx.model.today);
    const guardian=form.querySelector('[data-paper-guardian]');if(guardian)guardian.hidden=!minor;
    for(const el of form.querySelectorAll('[data-paper-guardian-field]'))el.required=minor;
    const submit=form.querySelector('[type="submit"]');if(submit)submit.disabled=form.dataset.busy==='true';return;
  }
  const ageValue = form.elements.age?.value, minor = ageValue !== '' && Number(ageValue) < 18 && Number(ageValue) >= 0;
  const guardian = form.querySelector('[data-paper-guardian]'); if (guardian) guardian.hidden = !minor;
  for (const element of form.querySelectorAll('[data-paper-guardian-field]')) element.required = minor;
  let incomplete = 0, attentionCount = 0;
  for (const q of PAPER_SAFETY_QUESTIONS) {
    const answer = form.elements[`answer_${q.key}`]?.value;
    if (!Object.hasOwn(ANSWERS, answer)) incomplete++;
    else if (answer !== 'no') attentionCount++;
  }
  const notes = form.querySelector('[data-paper-safety-notes]'); if (notes) notes.hidden = !attentionCount;
  const hint = form.querySelector('[data-paper-safety-hint]');
  if (hint) hint.textContent = incomplete ? `还有 ${incomplete} 项未填写，请逐项确认。` : attentionCount ? `${attentionCount} 项需要负责人重点核对，可在下方补充说明。` : '十项已填写，保存后仍须交给负责康复师复核。';
  const submit = form.querySelector('[type="submit"]'); if (submit) submit.disabled = form.dataset.busy === 'true' || incomplete > 0;
}
