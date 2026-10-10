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
const ROW_KEYS = ['id', 'clientId', 'storeId', 'ownerId', 'assessorId', 'date', 'time', 'age', 'problem', 'goal', 'bodyArea', 'duration', 'impact', 'pain', 'sex', 'source', 'referrer', 'exercise', 'recentCare', 'surgery', 'allergies', 'emergencyName', 'emergencyPhone', 'guardianName', 'guardianPhone', 'safetyNotes', 'answers', 'status', 'createdAt', 'createdBy', 'createdRole', 'reviewedAt', 'reviewedBy', 'reviewedRole', 'review'];
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
  if (!['boss', 'manager', 'frontdesk', 'therapist'].includes(role?.type)) throw new Error('仅老板、店长、前台和康复师有接待记录权限');
  return model.receptionStoreIds(role);
}
function clientFor(model, role, clientId) {
  actorStores(model, role);
  const client = model.state.clients.find(row => row.id === clientId);
  if (!client || !model.canSeeClient(role, clientId)) throw new Error('您没有该客户的接待记录权限');
  return client;
}
function canRead(model, role, row, stores) {
  const client = model.state.clients.find(item => item.id === row.clientId);
  if (!client || !model.canSeeClient(role, client.id)) return false;
  // The unified owner can read cross-store records. A designated execution
  // therapist reads only records from that exact authorized store; professional
  // review remains with the unified owner in reviewPaperIntake.
  if (role.type === 'therapist') return client.ownerId === role.id ||
    (client.assessorId && model.state.appointments.some(a=>a.clientId===client.id&&a.storeId===row.storeId&&a.principalId===role.id)) ||
    (typeof model.clientStoreTherapist === 'function' && model.clientStoreTherapist(client.id, row.storeId) === role.id);
  return stores.includes(row.storeId);
}
function attention(row) {
  return PAPER_SAFETY_QUESTIONS.filter(q => row.answers?.[q.key] !== 'no').map(q => ({ key: q.key, label: q.label, answer: Object.hasOwn(ANSWERS, row.answers?.[q.key]) ? row.answers[q.key] : 'unanswered' }));
}
function project(row) {
  const result = Object.fromEntries(ROW_KEYS.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
  result.answers = Object.fromEntries(PAPER_SAFETY_QUESTIONS.filter(q => Object.hasOwn(ANSWERS, row.answers?.[q.key])).map(q => [q.key, row.answers[q.key]]));
  if (row.review) result.review = Object.fromEntries(['decision', 'nextStep', 'notes', 'assigneeId', 'dueDate', 'taskId', 'assignmentDefaulted'].filter(key => row.review[key] !== undefined).map(key => [key, row.review[key]]));
  result.attentionItems = attention(row);
  return clone(result);
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
  return client.assessorId || !people.some(t=>t.id===client.ownerId) ? [{id:'boss',name:'涛博士',storeId},...people] : people;
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
  const stores = actorStores(model, role), client = clientFor(model, role, clientId);
  if (!stores.includes(storeId)) throw new Error('您没有该门店的接待记录权限，或门店已停用');
  const owner = model.state.therapists.find(row => row.id === client.ownerId && row.active === true);
  if (!owner && !client.assessorId) throw new Error('负责康复师不存在或已停用，请先由老板安排负责人');
  if (role.type === 'therapist' && client.ownerId !== role.id) throw new Error('康复师只能记录本人负责客户的初访信息');
  const age = number(data.age, '客户年龄', 0, 120), minor = age < 18;
  const result = { clientId, storeId, ownerId: client.ownerId, ...(client.assessorId?{assessorId:client.assessorId}:{}), age, problem: text(data.problem, '主要问题（客户自述）', true), goal: text(data.goal, '客户希望达到的目标', true), bodyArea: text(data.bodyArea, '主要部位', false, 80), duration: text(data.duration, '持续多久', false, 100), impact: text(data.impact, '影响日常活动', false, 300), pain: data.pain === '' || data.pain == null ? null : number(data.pain, '客户自述疼痛分数', 0, 10), sex: choice(data.sex, { male: '男', female: '女', undisclosed: '不方便填写' }, '性别'), source: choice(data.source, SOURCES, '客户来源', 'unknown'), referrer: text(data.referrer, '介绍人', false, 100), exercise: choice(data.exercise, EXERCISE, '运动频率', 'unknown'), recentCare: text(data.recentCare, '近期就医或病史'), surgery: text(data.surgery, '手术史'), allergies: text(data.allergies, '过敏情况'), emergencyName: text(data.emergencyName, '紧急联系人', false, 80), emergencyPhone: phone(data.emergencyPhone, '紧急联系人手机号'), guardianName: text(data.guardianName, '监护人姓名', minor, 80), guardianPhone: phone(data.guardianPhone, '监护人手机号', minor), safetyNotes: text(data.safetyNotes, '需注意的情况'), answers: {} };
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
  return collection(model).filter(row => canRead(model, role, row, stores)).sort((a, b) => `${b.date} ${b.time} ${b.id}`.localeCompare(`${a.date} ${a.time} ${a.id}`)).map(project);
}

export function savePaperIntake(model, data, role) {
  if(role?.type==='manager'){model.managerStoreId(role);throw new Error('店长仅监管查看，不能录入接待表，请由前台或老板处理');}
  const input = normalized(model, data, role), requestId = text(data.requestId, '接待提交标识', true, 100), inputKey = JSON.stringify(input);
  const prior = collection(model).find(row => row.requestId === requestId && row.createdBy === role.id && row.createdRole === role.type);
  if (prior) { if (prior.inputKey !== inputKey) throw new Error('同一提交的内容发生变化，请重新打开接待表'); return project(prior); }
  const moment = currentStamp(model), sequence = nextSequence(model);
  const row = { ...input, ...moment, id: `paper${sequence}`, status: 'pending', createdBy: role.id, createdRole: role.type, requestId, inputKey };
  const log = audit(`audit${sequence + 1}`, 'paper_intake_created', row, role, moment.createdAt);
  model.state.paperIntakes = [...collection(model), row]; model.state.audit = [...model.state.audit, log]; model.sequence = sequence + 1;
  return project(row);
}

export function reviewPaperIntake(model, id, data, role) {
  const row = readRecord(model, id, role), client = clientFor(model, role, row.clientId);
  if(role.type==='boss')model._boss(role);
  else if (role.type !== 'therapist' || (client.assessorId || !model._therapist(role.id).legacy || role.id !== client.ownerId) || !model.state.therapists.some(t => t.id === role.id && t.active === true)) throw new Error('仅老板或客户当前在职负责康复师有专业复核权限');
  if (!data || typeof data !== 'object') throw new Error('请填写复核记录');
  const decision = choice(data.decision, DECISIONS, '下一步安排');
  if (!decision) throw new Error('请选择下一步安排');
  const review = { decision, nextStep: text(data.nextStep, '下一步具体事项', true, 500), notes: text(data.notes, '复核说明', false, 1000), ...followupAssignment(model, client, row.storeId, data) }, requestId = text(data.requestId, '复核提交标识', true, 100), inputKey = JSON.stringify(review);
  if (row.reviewRequestId === requestId && row.reviewedBy === role.id) { if (row.reviewInputKey !== inputKey) throw new Error('同一复核提交的内容发生变化'); return project(row); }
  if (row.status !== 'pending') throw new Error('该记录已复核，请新增本次接待确认表记录变化');
  if (PAPER_SAFETY_QUESTIONS.some(q => !Object.hasOwn(ANSWERS, row.answers?.[q.key]))) throw new Error('安全确认尚未逐项填写，请核对原记录');
  const moment = currentStamp(model), sequence = nextSequence(model), taskId = `task${sequence}`;
  const task = { id: taskId, clientId: row.clientId, storeId: row.storeId, paperIntakeId: row.id, type: 'intake_followup', title: review.nextStep, assigneeId: review.assigneeId, dueDate: review.dueDate, status: 'pending', createdBy: role.id, createdRole: role.type, createdAt: moment.createdAt };
  const updated = { ...row, status: 'reviewed', reviewedAt: moment.createdAt, reviewedBy: role.id, reviewedRole:role.type, review: { ...review, taskId }, reviewRequestId: requestId, reviewInputKey: inputKey };
  model.state.paperIntakes = collection(model).map(item => item.id === id ? updated : item);
  model.state.tasks = [...model.state.tasks, task];
  model.state.audit = [...model.state.audit, audit(`audit${sequence + 1}`, 'paper_intake_reviewed', updated, role, moment.createdAt, { before: { status: row.status }, note: review.nextStep, taskId, assigneeId: review.assigneeId, dueDate: review.dueDate, assignmentDefaulted: review.assignmentDefaulted })]; model.sequence = sequence + 1;
  return project(updated);
}

function action(ctx, label, type, id, style = 'btn-outline') { return `<button type="button" class="btn ${style}" data-action="${type}" data-id="${ctx.esc(id)}">${label}</button>`; }
function names(ctx, kind, id) { return ctx.model.state[kind].find(row => row.id === id)?.name || '待核对'; }
function field(ctx, label, name, value = '', attrs = '') { return `<label class="field"><span>${label}</span><input name="${name}" value="${ctx.esc(value)}" ${attrs}></label>`; }
function area(ctx, label, name, value = '', attrs = '') { return `<label class="field span-all"><span>${label}</span><textarea name="${name}" rows="2" ${attrs}>${ctx.esc(value)}</textarea></label>`; }
function select(ctx, label, name, choices, value = '', blank = '请选择（选填）') { return `<label class="field"><span>${label}</span><select name="${name}"><option value="">${blank}</option>${Object.entries(choices).map(([key, title]) => `<option value="${key}"${key === value ? ' selected' : ''}>${title}</option>`).join('')}</select></label>`; }
function assessmentPerson(ctx,client) {return client?.assessorId?'涛博士':names(ctx,'therapists',client?.ownerId);}
function reviewable(ctx, row) {
  const client = ctx.model.state.clients.find(c => c.id === row.clientId);
  const authorized=ctx.role.type==='boss'?ctx.role.id==='boss':ctx.role.type==='therapist'&&!client?.assessorId&&ctx.model.state.therapists.some(t=>t.id===ctx.role.id&&t.legacy)&&ctx.role.id===client?.ownerId&&ctx.model.state.therapists.some(t=>t.id===ctx.role.id&&t.active===true);
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
  return `<article class="paper-intake-row"><div class="section-head"><h3>${ctx.esc(names(ctx, 'clients', row.clientId))}</h3><span class="tag ${row.status === 'reviewed' ? 'tag-green' : ''}">${row.status === 'reviewed' ? (row.reviewedRole==='boss'?'已由老板复核':'已由负责人复核') : (row.assessorId?'待涛博士复核':'待负责康复师复核')}</span></div><p class="paper-intake-problem">${ctx.esc(row.problem)}</p><p class="meta">${ctx.esc(row.date)} ${ctx.esc(row.time)} · ${ctx.esc(names(ctx, 'stores', row.storeId))} · 评估人员 ${ctx.esc(assessmentPerson(ctx,ctx.model.state.clients.find(c=>c.id===row.clientId)))}</p><p class="paper-intake-attention">${row.attentionItems.length ? '需核对：' + row.attentionItems.map(item => `${ctx.esc(item.label)}（${ANSWERS[item.answer] || '未填写'}）`).join('；') : '十项已逐项填写，仍需负责人专业复核。'}</p><p class="meta">下一步：${ctx.esc(row.review?.nextStep || '联系负责康复师，核对后安排专业评估')}</p>${handoffSummary(ctx,row)}<div class="action-row">${action(ctx, '查看接待表', 'paper-intake-detail', row.id)}${reviewable(ctx, row) ? action(ctx, '复核与下一步', 'paper-intake-review', row.id, 'btn-primary') : ''}</div></article>`;
}

export function renderPaperIntakeInbox(ctx) {
  if (ctx.role.type === 'customer') return '';
  const stores = actorStores(ctx.model, ctx.role), selected = ctx.role.type !== 'therapist' && stores.includes(ctx.filters?.storeId) ? ctx.filters.storeId : '';
  const rows = paperIntakeRows(ctx.model, ctx.role).filter(row => row.status === 'pending' && (!selected || row.storeId === selected));
  return `<section class="paper-intake-inbox" aria-label="接待复核"><div class="section-head"><div><h2>初访与服务前确认 · 待复核 <span class="paper-intake-count">${rows.length}</span></h2><p class="meta">只看谁需要跟进、注意什么、谁来处理。</p></div>${action(ctx, '全部接待表', 'paper-intake-list', '', 'btn-small btn-outline')}</div>${rows.slice(0, 3).map(row => summary(ctx, row)).join('') || '<p class="muted">当前没有待复核接待表。</p>'}${rows.length > 3 ? `<p class="meta">还有 ${rows.length - 3} 条，请点“全部接待表”查看。</p>` : ''}</section>`;
}

export function renderPaperIntakeList(ctx) {
  const stores = actorStores(ctx.model, ctx.role), selected = ctx.role.type === 'therapist' ? '' : stores.includes(ctx.filters?.storeId) ? ctx.filters.storeId : ctx.role.type === 'boss' ? '' : stores[0];
  const relationship = client => !selected || client.storeId === selected || ctx.model.state.packages.some(p => p.clientId === client.id && p.storeId === selected) || ctx.model.state.appointments.some(a => a.clientId === client.id && a.storeId === selected) || ctx.model.state.services.some(s => s.clientId === client.id && s.storeId === selected && s.status === 'valid');
  const clientId = ctx.filters?.clientId;
  const clients = ctx.model.state.clients.filter(c => ctx.model.canSeeClient(ctx.role, c.id) && (ctx.role.type !== 'therapist' || c.ownerId === ctx.role.id) && relationship(c) && (!clientId || c.id === clientId));
  const rows = paperIntakeRows(ctx.model, ctx.role).filter(row => (!selected || row.storeId === selected) && (!clientId || row.clientId === clientId));
  return `<section class="paper-intake-list"><p class="notice">初访与服务前确认：如实记录客户的描述，交给负责康复师复核。今天的情况有变化，可以新增一份；历史表不能替代本次确认。</p>${ctx.role.type==='manager'?'<p class="meta">监管查看 · 不可录入和修改；接待记录由前台填写。</p>':`<form class="toolbar" data-form="paper-intake-select"><label class="field"><span>选择要接待的客户</span><select name="clientId" required><option value="">请选择已有档案的客户</option>${clients.map(c => `<option value="${ctx.esc(c.id)}"${c.id === clientId ? ' selected' : ''}>${ctx.esc(c.name)}</option>`).join('')}</select></label><button class="btn btn-primary" type="submit"${clients.length ? '' : ' disabled'}>填写本次接待表</button></form>`}<div class="paper-intake-list-rows">${rows.map(row => summary(ctx, row)).join('') || (ctx.role.type==='manager'?'<div class="empty">本店暂无接待表，请前台填写本次接待情况。</div>':'<div class="empty">本店暂无接待表。先选择客户，填写本次接待情况。</div>')}</div></section>`;
}

export function paperIntakeDialog(type, id, ctx) {
  if (!['paper-intake-create', 'paper-intake-detail', 'paper-intake-review', 'paper-intake-list'].includes(type)) return null;
  const { model, esc, role } = ctx;
  if (type === 'paper-intake-list') return { title: '初访与服务前确认记录', html: renderPaperIntakeList(ctx) };
  if (type === 'paper-intake-create') {
    if(role.type==='manager'){model.managerStoreId(role);throw new Error('店长仅监管查看，不能录入接待表，请由前台或老板处理');}
    const client = clientFor(model, role, id), stores = actorStores(model, role), selected = stores.includes(ctx.filters?.storeId) ? ctx.filters.storeId : stores.includes(client.storeId) ? client.storeId : stores[0];
    if (!selected) throw new Error('暂无有效接待门店');
    if (role.type === 'therapist' && client.ownerId !== role.id) throw new Error('康复师只能记录本人负责客户的初访信息');
    const owner = model.state.therapists.find(t => t.id === client.ownerId && t.active === true);
    if (!owner && !client.assessorId) throw new Error('负责康复师已停用，请先联系老板核对负责人');
    return { title: '初访与服务前确认', html: `<form data-form="paper-intake-create"><input type="hidden" name="clientId" value="${esc(client.id)}"><div class="note"><strong>${esc(client.name)} · ${esc(client.phone || '电话待补充')}</strong><p>负责康复师 ${esc(client.assessorId?'涛博士':owner.name)} · 记录日期 ${esc(model.today)}</p><p>只记录客户自述，不填写专业诊断。今天的情况请重新逐项询问。</p></div><section class="paper-intake-section"><h3>1. 客户哪里不舒服，想改善什么？</h3><div class="form-grid">${field(ctx, '年龄', 'age', client.age ?? '', 'type="number" required min="0" max="120" step="1" inputmode="numeric"')}${field(ctx, '主要部位（选填）', 'bodyArea', '', 'maxlength="80" placeholder="例如：右膝、肩颈"')}${area(ctx, '主要问题（客户自述）', 'problem', client.problem || '', 'required maxlength="1000" placeholder="按客户原话记录"')}${area(ctx, '客户希望达到的目标', 'goal', '', 'required maxlength="1000" placeholder="例如：能顺利上下楼，恢复跑步"')}${field(ctx, '持续多久（选填）', 'duration', '', 'maxlength="100" placeholder="例如：两周"')}${field(ctx, '影响什么活动（选填）', 'impact', '', 'maxlength="300" placeholder="例如：久坐、上下楼"')}${select(ctx, '客户自述疼痛分数（按现在感受，选填）', 'pain', Object.fromEntries(Array.from({ length: 11 }, (_, i) => [i, i === 0 ? '0 分 · 不痛' : i === 10 ? '10 分 · 能想象的最强疼痛' : `${i} 分`])), '', '未记录，不等于 0 分')}<label class="field"><span>本次接待门店</span><select name="storeId" required>${stores.map(storeId => `<option value="${esc(storeId)}"${storeId === selected ? ' selected' : ''}>${esc(names(ctx, 'stores', storeId))}</option>`).join('')}</select></label></div></section><details class="paper-intake-section"><summary>2. 背景信息（按需展开，选填）</summary><div class="form-grid">${select(ctx, '性别（选填）', 'sex', { male: '男', female: '女', undisclosed: '不方便填写' })}${select(ctx, '客户从哪里知道我们', 'source', SOURCES)}${field(ctx, '介绍人（选填）', 'referrer', '', 'maxlength="100"')}${select(ctx, '平时运动频率', 'exercise', EXERCISE)}${area(ctx, '既往史／就医与用药（客户自述，选填）', 'recentCare', '', 'maxlength="1000" placeholder="已知疾病、近期就医和正在用药；不知道就如实记录，专业核对由康复师完成"')}${area(ctx, '手术情况（选填）', 'surgery', '', 'maxlength="1000"')}${area(ctx, '药物、食物或其他过敏情况（选填）', 'allergies', '', 'maxlength="1000"')}${field(ctx, '紧急联系人（选填）', 'emergencyName', '', 'maxlength="80"')}${field(ctx, '紧急联系人手机号（选填）', 'emergencyPhone', '', 'type="tel" inputmode="tel" pattern="1[0-9]{10}" maxlength="11"')}</div></details><section class="paper-intake-section paper-intake-guardian" data-paper-guardian${client.age != null && client.age < 18 ? '' : ' hidden'}><h3>未成年客户监护人</h3><div class="form-grid">${field(ctx, '监护人姓名', 'guardianName', '', 'maxlength="80" data-paper-guardian-field')}${field(ctx, '监护人手机号', 'guardianPhone', '', 'type="tel" inputmode="tel" pattern="1[0-9]{10}" maxlength="11" data-paper-guardian-field')}</div><p class="meta">未满 18 岁须填写，年龄改变后自动提示。</p></section><section class="paper-intake-section"><h3>3. 本次服务前逐项确认</h3><p class="meta">每项都要询问。客户不确定时选“不清楚”；任何答案均不代表允许直接服务。</p><div class="paper-safety-questions">${PAPER_SAFETY_QUESTIONS.map((q, index) => `<fieldset class="paper-safety-question" data-safety-question="${q.key}"><legend>${index + 1}. ${q.label}？</legend><div class="paper-answer-choices">${Object.entries(ANSWERS).map(([key, label]) => `<label><input type="radio" name="answer_${q.key}" value="${key}" required><span>${label}</span></label>`).join('')}</div></fieldset>`).join('')}</div><p class="notice" data-paper-safety-hint>请逐项填写；保存后交给负责康复师复核。</p><div data-paper-safety-notes hidden>${area(ctx, '选“是”或“不清楚”的情况说明（选填）', 'safetyNotes', '', 'maxlength="1000" placeholder="简要写清部位、时间或客户不知道的情况"')}</div></section><p class="meta">这些信息用于接待和后续专业核对，授权老板、门店负责人、前台及该客户负责康复师按权限查看。请核对客户描述；预览只填写虚构资料，刷新恢复示例。</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button><button type="submit" class="btn btn-primary">保存，交给康复师复核</button></div></form>` };
  }
  const raw = readRecord(model, id, role), row = project(raw), client = model.state.clients.find(c => c.id === row.clientId);
  if (type === 'paper-intake-review') {
    if (!reviewable(ctx, row)) throw new Error('仅老板或客户当前负责康复师可复核待处理接待表');
    const assignees=followupAssignees(model,client,row.storeId);
    const assignment=`<div class="form-grid"><label class="field"><span>下一步交给谁</span><select name="assigneeId" required><option value="">请选择已授权康复师</option>${assignees.map(t=>`<option value="${esc(t.id)}"${t.id===(client.assessorId?'boss':client.ownerId)?' selected':''}>${esc(t.name)} · ${esc(names(ctx,'stores',t.storeId))}</option>`).join('')}</select></label>${field(ctx,'计划完成日期','dueDate',model.today,`type="date" min="${esc(model.today)}" required`)}</div><p class="meta">保存后生成待办，交给所选康复师处理；完成时须留下结果。</p>`;
    return { title: '接待复核与下一步', html: `<form data-form="paper-intake-review"><input type="hidden" name="id" value="${esc(row.id)}"><div class="note"><strong>${esc(client.name)} · ${esc(row.date)} ${esc(row.time)}</strong><p>${esc(row.problem)}</p><p>客户目标：${esc(row.goal)}</p></div><p class="notice">${row.attentionItems.length ? '需核对：' + row.attentionItems.map(q => `${esc(q.label)}（${ANSWERS[q.answer] || '未填写'}）`).join('；') : '十项均记录为“否”，请结合本次情况专业复核。'}${row.safetyNotes ? '<br>客户补充：' + esc(row.safetyNotes) : ''}</p><p class="meta">${action(ctx, '查看完整接待表', 'paper-intake-detail', row.id)}</p>${select(ctx, '复核后的下一步', 'decision', DECISIONS, '', '请选择下一步安排')}${area(ctx, '下一步具体事项', 'nextStep', '', 'required maxlength="500" placeholder="写清接下来做什么、由谁安排"')}${assignment}${area(ctx, '复核说明（选填）', 'notes', '', 'maxlength="1000"')}<p class="meta">这里只记录本次专业核对与工作安排，原始客户回答完整保留；不会自动生成诊断或修改套餐次数。</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button><button type="submit" class="btn btn-primary">保存复核与下一步</button></div></form>` };
  }
  const show = (label, value) => `<div class="detail-pair"><span class="muted">${label}</span><strong>${esc(value || '未记录')}</strong></div>`;
  return { title: `${client.name}的接待确认表`, html: `<div class="note"><strong>${row.status === 'pending' ? (row.assessorId?'待涛博士复核':'待负责康复师复核') : row.reviewedRole==='boss'?'已由老板复核':'已由负责康复师复核'}</strong><p>${esc(row.date)} ${esc(row.time)} · ${esc(names(ctx, 'stores', row.storeId))} · 评估人员 ${esc(assessmentPerson(ctx,client))}</p><p>记录的是当时情况，历史表不能替代下一次服务前确认。</p></div><h3>主要问题与目标</h3><div class="detail-grid">${show('客户自述问题', row.problem)}${show('客户目标', row.goal)}${show('年龄', `${row.age} 岁`)}${show('主要部位', row.bodyArea)}${show('持续时间', row.duration)}${show('影响活动', row.impact)}${show('客户自述疼痛', row.pain == null ? '未记录' : `${row.pain} / 10`)}</div><h3>本次逐项确认</h3><div class="paper-intake-answers">${PAPER_SAFETY_QUESTIONS.map(q => `<div class="row"><span>${esc(q.label)}</span><strong class="${row.answers[q.key] === 'no' ? '' : 'paper-intake-attention'}">${ANSWERS[row.answers[q.key]] || '未填写'}</strong></div>`).join('')}</div>${row.safetyNotes ? `<p class="paper-intake-problem">情况说明：${esc(row.safetyNotes)}</p>` : ''}<details class="paper-intake-section"><summary>背景与联系人（按需查看）</summary><div class="detail-grid">${show('性别', { male: '男', female: '女', undisclosed: '不方便填写' }[row.sex])}${show('客户来源', SOURCES[row.source])}${show('介绍人', row.referrer)}${show('运动频率', EXERCISE[row.exercise])}${show('客户自述就医 / 病史', row.recentCare)}${show('手术情况', row.surgery)}${show('过敏情况', row.allergies)}${show('紧急联系人', [row.emergencyName, row.emergencyPhone].filter(Boolean).join(' · '))}${show('监护人', [row.guardianName, row.guardianPhone].filter(Boolean).join(' · '))}</div></details><h3>下一步</h3><p class="paper-intake-problem">${esc(row.review?.nextStep || '联系负责康复师复核，再安排专业评估')}</p>${row.review ? `<p class="meta">${esc(DECISIONS[row.review.decision])} · ${esc(localTimestamp(row.reviewedAt))} · 复核人 ${esc(row.reviewedRole==='boss'?'老板':names(ctx, 'therapists', row.reviewedBy))}</p>${row.review.notes ? `<p>${esc(row.review.notes)}</p>` : ''}${handoffSummary(ctx,row,true)}` : ''}<p class="meta">录入人 ${esc(row.createdRole === 'boss' ? '老板' : names(ctx, row.createdRole === 'frontdesk' ? 'frontDesks' : row.createdRole === 'manager' ? 'storeManagers' : 'therapists', row.createdBy))} · ${esc(localTimestamp(row.createdAt))}</p><div class="action-row">${reviewable(ctx, row) ? action(ctx, '复核与下一步', 'paper-intake-review', row.id, 'btn-primary') : ''}${role.type!=='manager'&&(role.type!=='therapist'||client.ownerId===role.id)?action(ctx, '新增本次接待确认', 'paper-intake-create', row.clientId):''}${action(ctx, '关闭', 'close-dialog', '')}</div>` };
}

export function updatePaperIntakeForm(form, ctx) {
  if (form?.dataset.form !== 'paper-intake-create') return;
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
