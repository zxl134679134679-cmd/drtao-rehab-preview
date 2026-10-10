/* Shared daily schedule UI. Role scope and every write are enforced by schedules.js. */
import { scheduleRows, scheduleRequestRows, bossScheduleNotifications, scheduleStatus } from './schedules.js?v=20261010-assessor-personnel-1';

const escDefault = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const TIMES = Object.freeze(Array.from({ length: 48 }, (_, index) => `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`));
const REQUEST_STATUS = Object.freeze({ pending: '待老板审批', approved: '已批准并生效', rejected: '已拒绝，原排班保留' });

function helpers(ctx, todayOnly = false) {
  const { model, role } = ctx;
  if (!['boss', 'manager', 'frontdesk', 'therapist'].includes(role?.type)) throw new Error('您没有康复师排班查看权限');
  const esc = ctx.esc || escDefault;
  const storeIds = model.receptionStoreIds(role);
  const stores = model.state.stores.filter(store => storeIds.includes(store.id));
  const requestedStore = ctx.filters?.storeId;
  const storeId = storeIds.includes(requestedStore) ? requestedStore : role.type === 'boss' ? '' : storeIds[0] || '';
  const date = todayOnly ? model.today : ctx.filters?.scheduleDate || ctx.filters?.date || model.today;
  const rows = scheduleRows(model, role, { date, storeId });
  const therapists = model.state.therapists.filter(therapist => therapist.active === true && storeIds.includes(therapist.storeId) && (!storeId || therapist.storeId === storeId) && (role.type !== 'therapist' || therapist.id === role.id));
  const name = (kind, id) => model.state[kind]?.find(row => row.id === id)?.name || '历史人员';
  const actorName = (id, type) => type === 'boss' || id === 'boss' ? '老板' : name(type === 'manager' ? 'storeManagers' : type === 'frontdesk' ? 'frontDesks' : 'therapists', id);
  const button = (label, action, id = '', style = 'btn-outline') => `<button type="button" class="btn ${style}" data-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`;
  const nav = (label = '查看全部排班') => `<button type="button" class="btn btn-outline" data-action="nav" data-id="schedules">${esc(label)}</button>`;
  return { ctx, model, role, esc, storeIds, stores, storeId, date, rows, therapists, name, actorName, button, nav, canEdit: role.type === 'boss' };
}

function shiftText(row) {
  if (!row || row.status === 'unassigned') return '未排班';
  if (row.status === 'rest') return '休息';
  return `${row.startTime}–${row.endTime}`;
}
function localStamp(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return '时间未记录';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
function rowFor(x, therapistId) { return x.rows.find(row => row.therapistId === therapistId) || { status: 'unassigned', version: 0 }; }
function shiftCard(x, therapist) {
  const row = rowFor(x, therapist.id), status = row.status, today = x.date === x.model.today, historical = x.date < x.model.today;
  const badge = status === 'rest' ? '休息' : status === 'work' ? '上班' : '未排班';
  const actionId = `${therapist.id}|${x.date}`;
  return `<article class="schedule-person-card"><div class="section-head"><div><h2>${x.esc(therapist.name)}</h2><p class="meta">${x.esc(x.name('stores', therapist.storeId))}</p></div><span class="tag ${status === 'work' ? 'tag-green' : status === 'unassigned' ? 'tag-warn' : ''}">${x.esc(badge)}</span></div><strong class="schedule-hours">${status === 'rest' ? (today ? '今天休息' : '当天休息') : x.esc(shiftText(row))}</strong><p class="schedule-person-help">${historical ? '历史排班只读，保留当时安排供核对。' : status === 'work' ? '预约请安排在上班时间内；可约时段以实际占用情况为准。' : status === 'rest' ? '休息当天不能安排新预约。' : '先联系老板安排，再为客户预约。'}</p>${historical ? '<p class="meta">历史日期不支持修改。</p>' : x.canEdit ? x.button(status === 'unassigned' ? '设置排班' : '修改排班', 'schedule-edit', actionId, 'btn-primary') : x.role.type === 'frontdesk' ? x.button('申请调整', 'schedule-request', actionId) : '<p class="meta">如需调整，请联系老板。</p>'}</article>`;
}
function changeComparison(x, before, after) {
  return `<dl class="schedule-comparison"><div><dt>变更前</dt><dd>${x.esc(shiftText(before))}</dd></div><div><dt>变更后</dt><dd>${x.esc(shiftText(after))}</dd></div></dl>`;
}
function requestCard(x, row) {
  const canDecide = x.canEdit && row.status === 'pending';
  return `<article class="schedule-change-row"><div class="section-head"><div><h3>${x.esc(x.name('therapists', row.therapistId))} · ${x.esc(row.date)}</h3><p class="meta">${x.esc(x.name('stores', row.storeId))} · 申请人 ${x.esc(x.actorName(row.requestedBy, row.requestedRole))}</p></div><span class="tag ${row.status === 'approved' ? 'tag-green' : row.status === 'pending' ? 'tag-warn' : ''}">${x.esc(REQUEST_STATUS[row.status] || '待核对')}</span></div>${changeComparison(x, row.before, row.after)}<p class="schedule-reason">调整原因：${x.esc(row.reason)}</p>${row.decidedAt ? `<p class="meta">${x.esc(x.actorName(row.decidedBy, row.decidedRole))} · ${x.esc(localStamp(row.decidedAt))}<br>处理说明：${x.esc(row.decisionReason)}</p>` : '<p class="meta">老板批准后生效；申请期间原排班保持不变。</p>'}${canDecide ? x.button('处理申请', 'schedule-decision', row.id, 'btn-primary') : ''}</article>`;
}
function notificationCard(x, row) {
  return `<article class="schedule-change-row"><div class="section-head"><div><h3>${x.esc(x.name('therapists', row.therapistId))} · ${x.esc(row.date)}</h3><p class="meta">${x.esc(x.name('stores', row.storeId))} · ${x.esc(x.actorName(row.approvedBy || row.changedBy, row.approvedRole || row.changedRole))} 已修改</p></div><span class="tag ${row.readAt ? '' : 'tag-green'}">${row.readAt ? '已读' : '未读'}</span></div>${changeComparison(x, row.before, row.after)}<p class="schedule-reason">${x.esc(row.reason)}</p>${x.button('查看变更通知', 'schedule-notification', row.id)}</article>`;
}
function requestsFor(x) { return scheduleRequestRows(x.model, x.role).filter(row => !x.storeId || row.storeId === x.storeId).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt))); }
function notificationsFor(x) { return bossScheduleNotifications(x.model, x.role).filter(row => !x.storeId || row.storeId === x.storeId).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }

export function renderSchedulePage(ctx) {
  const x = helpers(ctx), requests = x.role.type === 'therapist' ? [] : requestsFor(x), pending = requests.filter(row => row.status === 'pending');
  const notifications = x.role.type === 'boss' ? notificationsFor(x) : [], unread = notifications.filter(row => !row.readAt);
  return `<div class="dashboard schedule-page"><div class="page-head"><div><span class="eyebrow">涛博士 · 人员安排</span><h1>${x.role.type === 'therapist' ? '我的排班' : '康复师排班'}</h1><p class="muted">${x.canEdit ? '先选日期，看清上班与休息，再安排客户。排班由老板修改。' : x.role.type === 'frontdesk' ? '先看谁上班、几点上下班，再为客户预约。调整需交老板批准。' : x.role.type === 'manager' ? '查看本店每天的上班时间及调整记录；店长只读，修改由老板处理。' : '查看本人每天的上班时间；需要调整请联系老板。'}</p></div></div><form class="filters schedule-filters" data-form="schedule-filters"><label class="field"><span>查看哪一天</span><input type="date" name="date" value="${x.esc(x.date)}" required></label>${x.role.type !== 'therapist' ? `<label class="field"><span>门店</span><select name="storeId">${x.role.type === 'boss' ? `<option value=""${x.storeId ? '' : ' selected'}>全部门店</option>` : ''}${x.stores.map(store => `<option value="${x.esc(store.id)}"${store.id === x.storeId ? ' selected' : ''}>${x.esc(store.name)}</option>`).join('')}</select></label>` : ''}<button type="submit" class="btn btn-primary">查看排班</button></form><p class="schedule-date-label">${x.date === x.model.today ? '今天' : '排班日期'} · ${x.esc(x.date)}<span>上班 ${x.therapists.filter(t => rowFor(x, t.id).status === 'work').length} 人 · 休息 ${x.therapists.filter(t => rowFor(x, t.id).status === 'rest').length} 人 · 未排班 ${x.therapists.filter(t => rowFor(x, t.id).status === 'unassigned').length} 人</span></p><div class="schedule-person-grid">${x.therapists.map(therapist => shiftCard(x, therapist)).join('') || '<p class="empty">当前门店暂无在职康复师。</p>'}</div>${x.role.type === 'therapist' ? '' : `<section class="schedule-request-panel"><div class="section-head"><div><h2>${x.role.type === 'boss' ? '待处理的排班申请' : '排班调整申请'}</h2><p class="meta">${pending.length} 条待审批 · 下方保留处理记录，含其他日期的申请。</p></div></div>${pending.length ? pending.map(row => requestCard(x, row)).join('') : '<p class="muted">当前没有待处理申请。</p>'}${requests.some(row => row.status !== 'pending') ? `<details class="schedule-history"><summary>已处理申请（${requests.length - pending.length} 条）</summary>${requests.filter(row => row.status !== 'pending').map(row => requestCard(x, row)).join('')}</details>` : ''}</section>`}${x.role.type === 'boss' ? `<section class="schedule-notification-panel"><div class="section-head"><div><h2>排班变更通知</h2><p class="meta">未读 ${unread.length} 条 · 每次生效变更都留底，可随时回看。</p></div></div><p class="notice">排班生效后会生成系统内通知；微信消息待正式接入，当前未发送。</p>${notifications.map(row => notificationCard(x, row)).join('') || '<p class="muted">暂无排班变更通知。老板修改或批准后，通知会出现在这里。</p>'}</section>` : ''}</div>`;
}

export function renderScheduleSummary(ctx) {
  if (ctx.role?.type === 'customer') return '';
  const x = helpers(ctx, true);
  return `<section class="schedule-summary" aria-label="今日排班"><div class="section-head"><div><h2>${x.role.type === 'therapist' ? '本人今日排班' : '今日康复师排班'}</h2><p class="meta">${x.esc(x.date)} · 上班时间一眼可见</p></div>${x.nav(x.role.type === 'therapist' ? '查看我的排班' : '康复师排班')}</div><ul class="schedule-summary-list">${x.therapists.map(therapist => `<li><span>${x.esc(therapist.name)}${x.role.type === 'boss' ? ` · ${x.esc(x.name('stores', therapist.storeId))}` : ''}</span><strong>${x.esc(shiftText(rowFor(x, therapist.id)))}</strong></li>`).join('') || '<li>当前暂无在职康复师。</li>'}</ul></section>`;
}

export function renderScheduleInbox(ctx) {
  if (!['boss', 'manager'].includes(ctx.role?.type)) return '';
  const x = helpers(ctx, true), pending = requestsFor(x).filter(row => row.status === 'pending');
  if (x.role.type === 'manager') return `<section class="schedule-inbox" aria-label="本店排班申请查看"><div class="section-head"><div><h2>待老板审批的排班申请 <span class="schedule-count">${pending.length}</span></h2><p class="meta">店长仅查看本店申请；由老板审批，每次生效变更都留底并通知老板。</p></div>${x.nav('查看排班与申请')}</div>${pending.slice(0, 2).map(row => requestCard(x, row)).join('') || '<p class="muted">当前没有待审批排班申请。</p>'}</section>`;
  const notifications = notificationsFor(x), unread = notifications.filter(row => !row.readAt);
  return `<section class="schedule-inbox" aria-label="老板排班变更通知"><div class="section-head"><div><h2>排班变更通知 <span class="schedule-count">未读 ${unread.length}</span></h2><p class="meta">待审批 ${pending.length} 条 · 生效记录均留底，可回看。</p></div>${x.nav('查看通知与排班')}</div>${unread.slice(0, 2).map(row => notificationCard(x, row)).join('') || '<p class="muted">当前没有未读变更通知。</p>'}${pending.slice(0, 2).map(row => requestCard(x, row)).join('')}<p class="meta">微信消息待正式接入，当前未发送；系统内通知可在上方查看。</p></section>`;
}

function validTherapist(x, id) {
  const therapist = x.therapists.find(row => row.id === id);
  if (!therapist) throw new Error('您没有该康复师所在门店的排班权限');
  return therapist;
}
function timeSelect(x, label, name, current) { return `<label class="field"><span>${label}</span><select name="${name}" required>${TIMES.map(time => `<option value="${time}"${time === current ? ' selected' : ''}>${time}</option>`).join('')}</select></label>`; }
function reasonField(label = '调整原因') { return `<label class="field"><span>${label}（必填）</span><textarea name="reason" rows="3" required maxlength="500" placeholder="例如：临时休息、调整下班时间"></textarea></label>`; }
function footer(label) { return `<p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button><button type="submit" class="btn btn-primary">${label}</button></div>`; }

export function scheduleDialog(type, id, ctx) {
  if (!['schedule-edit', 'schedule-request', 'schedule-decision', 'schedule-notification'].includes(type)) return null;
  const x = helpers(ctx);
  if (type === 'schedule-notification') {
    if (x.role.type !== 'boss') throw new Error('仅老板有排班变更通知查看权限');
    const row = notificationsFor({ ...x, storeId: '' }).find(item => item.id === id);
    if (!row) throw new Error('排班变更通知不存在或没有查看权限');
    return { title: '排班变更通知', html: `<div class="note"><strong>${x.esc(x.name('therapists', row.therapistId))} · ${x.esc(row.date)}</strong><p>${x.esc(x.name('stores', row.storeId))} · ${row.readAt ? '已读' : '未读'}</p></div>${changeComparison(x, row.before, row.after)}<dl class="schedule-notification-detail"><div><dt>申请／修改人</dt><dd>${x.esc(x.actorName(row.changedBy, row.changedRole))}</dd></div><div><dt>批准／执行人</dt><dd>${x.esc(x.actorName(row.approvedBy || row.changedBy, row.approvedRole || row.changedRole))}</dd></div><div><dt>变更原因</dt><dd>${x.esc(row.reason)}</dd></div><div><dt>批准说明</dt><dd>${x.esc(row.approvalReason || '直接修改排班')}</dd></div><div><dt>生效时间</dt><dd>${x.esc(localStamp(row.approvedAt || row.createdAt))}</dd></div></dl><p class="notice">系统内通知已记录；微信消息待正式接入，当前未发送。</p><div class="dialog-footer">${x.button('关闭', 'close-dialog', '', 'btn-quiet')}${row.readAt ? '<span class="meta">已读通知可随时回看。</span>' : x.button('标为已读', 'schedule-notification-read', row.id, 'btn-primary')}</div>` };
  }
  if (type === 'schedule-decision') {
    if (!x.canEdit) throw new Error('仅老板有排班审批权限');
    const row = scheduleRequestRows(x.model, x.role).find(item => item.id === id);
    if (!row) throw new Error('排班申请不存在或没有本店查看权限');
    if (row.status !== 'pending') return { title: '已处理的排班申请', html: requestCard(x, row) };
    return { title: '处理排班调整申请', html: `<form data-form="schedule-decision"><input type="hidden" name="id" value="${x.esc(row.id)}"><div class="note"><strong>${x.esc(x.name('therapists', row.therapistId))} · ${x.esc(row.date)}</strong><p>${x.esc(x.name('stores', row.storeId))} · ${x.esc(x.actorName(row.requestedBy, row.requestedRole))} 提交</p></div>${changeComparison(x, row.before, row.after)}<p class="schedule-reason">申请原因：${x.esc(row.reason)}</p><p class="notice">老板批准后生效。批准后保留原始记录，并产生老板的系统内通知；微信消息待正式接入。</p><label class="field"><span>处理结果（必选）</span><select name="decision" required><option value="">请选择处理结果</option><option value="approved">批准，按申请生效</option><option value="rejected">拒绝，保留原排班</option></select></label>${reasonField('处理说明')}${footer('确认处理')}</form>` };
  }
  if (type === 'schedule-edit' && !x.canEdit) throw new Error('仅老板有排班修改权限');
  if (type === 'schedule-request' && x.role.type !== 'frontdesk') throw new Error('此入口仅供前台提交排班调整申请');
  const parts = String(id || '').split('|');
  if (parts.length !== 2) throw new Error('请选择康复师和排班日期');
  const [therapistId, date] = parts;
  const targetStore = x.model.state.therapists.find(therapist => therapist.id === therapistId)?.storeId;
  if (!x.storeIds.includes(targetStore)) throw new Error('您没有该康复师所在门店的排班权限');
  const dayContext = helpers({ ...ctx, filters: { ...ctx.filters, scheduleDate: date, storeId: targetStore } });
  const therapist = validTherapist(dayContext, therapistId), row = scheduleStatus(x.model, therapistId, date);
  if (date < x.model.today) throw new Error('历史排班只读，不能修改过去的安排');
  const status = row.status === 'rest' ? 'rest' : 'work', request = type === 'schedule-request';
  return { title: request ? '申请调整排班' : '修改康复师排班', html: `<form data-form="${request ? 'schedule-request' : 'schedule-save'}"><input type="hidden" name="therapistId" value="${x.esc(therapistId)}"><input type="hidden" name="storeId" value="${x.esc(therapist.storeId)}"><input type="hidden" name="date" value="${x.esc(date)}"><input type="hidden" name="expectedVersion" value="${x.esc(row.version)}"><div class="note"><strong>${x.esc(therapist.name)} · ${x.esc(date)}</strong><p>${x.esc(x.name('stores', therapist.storeId))} · 原排班：${x.esc(shiftText(row))}</p></div><p class="notice">${request ? '前台只能提交申请，不能直接改变排班。老板批准后才生效。' : '老板保存后生效。'}每次生效变更都会产生老板的系统内通知；微信消息待正式接入。</p><label class="field"><span>当天安排</span><select name="status" required aria-describedby="schedule-status-help"><option value="work"${status === 'work' ? ' selected' : ''}>上班</option><option value="rest"${status === 'rest' ? ' selected' : ''}>休息</option></select></label><p id="schedule-status-help" class="meta" data-schedule-status-help>${status === 'rest' ? '当天休息，不填写上班和下班时间。' : '选择开始与结束时间，支持整点和半点。'}</p><div class="form-grid schedule-time-fields" data-schedule-hours${status === 'rest' ? ' hidden' : ''}>${timeSelect(x, '几点上班', 'startTime', row.startTime || '09:00')}${timeSelect(x, '几点下班', 'endTime', row.endTime || '19:00')}</div>${reasonField()}${footer(request ? '提交给老板审批' : '保存排班并通知老板')}</form>` };
}

export function updateScheduleForm(form) {
  if (!['schedule-save', 'schedule-request'].includes(form?.dataset?.form)) return;
  const rest = form.elements.status?.value === 'rest';
  const hours = form.querySelector('[data-schedule-hours]');
  if (hours) hours.hidden = rest;
  for (const key of ['startTime', 'endTime']) {
    const field = form.elements[key];
    if (field) { field.disabled = rest; field.required = !rest; }
  }
  const help = form.querySelector('[data-schedule-status-help]');
  if (help) help.textContent = rest ? '当天休息，不填写上班和下班时间。' : '选择开始与结束时间，支持整点和半点。';
}
