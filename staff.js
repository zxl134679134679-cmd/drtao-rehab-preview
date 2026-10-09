/* Employee and owner views for the in-memory review prototype. */
import { renderPaperIntakeInbox } from './paper-intake.js?v=20261009-personnel';
import { cashOverview } from './cash.js?v=20261009-personnel';
import { hourTimeField } from './hour-picker.js?v=20261009-personnel';
import { renderReception, receptionStores, clientIntakeButton } from './reception.js?v=20261009-personnel';
const TODAY = '2026-10-08';

function h(ctx) {
  const state = ctx.model.state;
  const esc = ctx.esc || (value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  const find = (kind, id) => (state[kind] || []).find(item => item.id === id);
  const name = (kind, id) => id === 'boss' ? '老板' : find(kind, id)?.name || '待安排';
  const ico = (name, size = 20) => ctx.icon ? ctx.icon(name, size) : '';
  const money = amount => `¥${Number(amount || 0).toLocaleString('zh-CN', {maximumFractionDigits: 2})}`;
  const date = value => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : '待安排';
  const action = (label, type, id = '', style = 'btn-outline', icon = '') => `<button type="button" class="btn ${style}" data-action="${esc(type)}" data-id="${esc(id)}">${icon ? ico(icon, 18) : ''}${esc(label)}</button>`;
  const link = (label, type, id = '') => `<button type="button" class="text-link" data-action="${esc(type)}" data-id="${esc(id)}">${esc(label)}${ico('chevron-right', 17)}</button>`;
  const tag = (text, color = '') => `<span class="tag ${color ? `tag-${color}` : ''}">${esc(text)}</span>`;
  const role = ctx.role;
  const client = id => find('clients', id);
  const clients = ctx.model.visibleClients(role);
  const rows = filters => ctx.model.serviceRows(filters || {});
  const inScope = service => role.type === 'boss' || clients.some(c => c.id === service.clientId);
  const pendingTasks = (state.tasks || []).filter(t => t.status !== 'completed' && t.status !== 'done' && (role.type === 'boss' || (t.type !== 'review_followup' && t.assigneeId === role.id && clients.some(c => c.id === t.clientId)))).sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || a.title.localeCompare(b.title));
  const appointments = (state.appointments || []).filter(a => ['confirmed', 'reschedule_requested', 'pending_reassignment'].includes(a.status) && (role.type === 'boss' || (clients.some(c => c.id === a.clientId) && (a.principalId === role.id || (a.status === 'pending_reassignment' && client(a.clientId)?.ownerId === role.id)))));
  return { state, esc, find, name, ico, money, date, action, link, tag, role, client, clients, rows, inScope, pendingTasks, appointments };
}

function packagesAtStore(model, clientId, storeId, exhausted = false) {
  const client = model.state.clients.find(row => row.id === clientId);
  if (!client || !model.state.stores.some(row => row.id === storeId)) return [];
  const source = !exhausted && typeof model.availablePackages === 'function'
    ? model.availablePackages(clientId, storeId) : model.state.packages;
  return source.filter(pack => pack.clientId === clientId &&
    (pack.storeId === storeId || (!pack.storeId && pack.id === client.packageId)) &&
    (exhausted ? model.packageRemaining(pack.id) === 0 : model.packageRemaining(pack.id) > 0));
}

function hasStorePackage(model,clientId,storeId) {
  const client=model.state.clients.find(c=>c.id===clientId);
  return model.state.packages.some(p=>p.clientId===clientId&&['current','historical'].includes(p.status)&&(p.storeId===storeId||(!p.storeId&&p.id===client?.packageId)));
}

function remainingAtStore(model, clientId, storeId) {
  if (typeof model.remainingInStore === 'function') return model.remainingInStore(clientId, storeId);
  return packagesAtStore(model, clientId, storeId).reduce((sum, pack) => sum + model.packageRemaining(pack.id), 0);
}

function packageChoice(ctx, clientId, storeId, preferred = '', exhausted = false) {
  const x = h(ctx), rows = packagesAtStore(ctx.model, clientId, storeId, exhausted);
  const selected = rows.some(pack => pack.id === preferred) ? preferred : rows.length === 1 ? rows[0].id : '';
  const placeholder = exhausted ? '请选择要续接的已耗尽套餐' : '请选择本次扣除的套餐';
  const options = `<option value=""${selected ? '' : ' selected'}>${placeholder}</option>` + rows.map(pack => {
    const scope = pack.storeId ? x.name('stores', pack.storeId) : '旧套餐·使用范围待核对';
    return `<option value="${x.esc(pack.id)}"${selected === pack.id ? ' selected' : ''}>${x.esc(pack.name)} · ${x.esc(scope)} · 剩余 ${ctx.model.packageRemaining(pack.id)} 次</option>`;
  }).join('');
  const pack = rows.find(row => row.id === selected);
  const hint = !rows.length ? `<p class="notice">${exhausted ? '本店没有已耗尽的套餐可续接，请先核对套餐记录。' : '本店没有可用套餐，暂不能直接消课。请核对服务门店，或由老板办理本店套餐。'}</p>`
    : !pack ? `<p class="notice">${exhausted ? '请选择要续接的已耗尽套餐，新套餐沿用所选旧套餐的所属门店。' : '请选择本次扣哪个套餐，再确认服务登记。'}</p>`
    : `<strong>${x.esc(pack.name)}</strong><p class="meta">${pack.storeId ? `所属门店 ${x.esc(x.name('stores', pack.storeId))}` : '旧套餐·使用范围待核对'} · 当前剩余 ${ctx.model.packageRemaining(pack.id)} 次</p><p>${exhausted ? '新套餐仅在所选门店使用，不修改其他店的套餐。' : `本次扣 1 次 · 单次消费业绩 ${x.money(ctx.model.nextServiceValue(pack.id).amount)}`}</p>`;
  return { rows, selected, options, hint };
}

function packageField(ctx, clientId, storeId, preferred = '', exhausted = false) {
  const choice = packageChoice(ctx, clientId, storeId, preferred, exhausted);
  const key = exhausted ? 'previousPackageId' : 'packageId';
  return { ...choice, html: `<label class="field span-all"><span>${exhausted ? '要续接的已耗尽套餐' : '本次扣哪个套餐'}</span><select name="${key}" required${choice.rows.length ? '' : ' disabled'}>${choice.options}</select></label><div class="note span-all" ${exhausted ? 'data-renew-package-hint' : 'data-service-package-hint'} aria-live="polite">${choice.hint}</div>` };
}

// Refresh after client/store/package changes and after draft restoration. Never
// keep another store's stale package selection or unlock an in-flight submit.
export function updateServicePackageChoices(form, ctx) {
  const type = form?.dataset.form;
  if (!['register', 'register-appointment', 'renew-package'].includes(type) ||
      form.dataset.busy === 'true' || form.dataset.succeeded === 'true') return;
  if (!['boss', 'therapist'].includes(ctx.role.type)) throw new Error('仅康复师或老板可以登记套餐消课');
  const exhausted = type === 'renew-package';
  if (exhausted && (ctx.role.type !== 'boss' || ctx.role.id !== 'boss')) throw new Error('续接套餐仅老板可操作');
  const clientId = form.elements.clientId?.value, storeId = form.elements.storeId?.value;
  if (!ctx.model.canSeeClient(ctx.role, clientId)) throw new Error('您没有查看该客户套餐的权限');
  const select = form.elements[exhausted ? 'previousPackageId' : 'packageId'];
  if (!select) return;
  const choice = packageChoice(ctx, clientId, storeId, select.value, exhausted);
  select.innerHTML = choice.options; select.disabled = !choice.rows.length; select.value = choice.selected;
  const hint = form.querySelector(exhausted ? '[data-renew-package-hint]' : '[data-service-package-hint]');
  if (hint) hint.innerHTML = choice.hint;
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = !choice.selected;
}

function ledger(ctx, services, title = '消费业绩明细', showOwner = true) {
  const x = h(ctx);
  return `<section class="section card"><div class="section-head"><h2>${x.esc(title)}</h2><span class="muted">${services.length} 条记录</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>客户 / 项目</th><th>日期 / 门店</th>${showOwner ? '<th>主康复师 / 协作</th>' : ''}<th>消费业绩</th><th>记录状态</th><th></th></tr></thead><tbody>${services.map(s => `<tr><td data-label="客户 / 项目">${x.inScope(s) ? `<button class="text-link" data-action="client-detail" data-id="${x.esc(s.clientId)}">${x.esc(x.client(s.clientId)?.name || '客户')}</button>` : `<span>${x.esc(x.client(s.clientId)?.name || '客户')}</span>`}<div class="meta">${x.esc(s.project)}</div></td><td data-label="日期 / 门店">${x.date(s.date)} ${x.esc(s.time)}<div class="meta">${x.esc(x.name('stores', s.storeId))}</div></td>${showOwner ? `<td data-label="主康复师 / 协作">${x.esc(x.name('therapists', s.principalId))}<div class="meta">${(s.participantIds || []).length ? `协作：${x.esc(s.participantIds.map(id => x.name('therapists', id)).join('、'))}` : '独立服务'}</div></td>` : ''}<td data-label="消费业绩"><span class="${s.status === 'revoked' ? 'revoked-amount' : 'amount'}">${x.money(s.amount)}</span></td><td data-label="记录状态">${x.tag(s.status === 'revoked' ? '已撤销' : '已完成', s.status === 'revoked' ? 'warn' : 'green')}<div class="meta">${s.evidencePhotos?.length ? `留底 ${s.evidencePhotos.length} 张` : '历史未留照片'}</div></td><td data-label="操作">${x.link('查看明细', 'service-detail', s.id)}</td></tr>`).join('')}</tbody></table>${!services.length ? '<div class="empty">当前筛选下没有服务记录。</div>' : ''}</div></section>`;
}

function filters(ctx, includeTherapists = true) {
  const x = h(ctx);
  const f = ctx.filters || {};
  return `<form class="filters" data-form="filters"><label class="field"><span>门店</span><select name="storeId"><option value="">全部门店</option>${x.state.stores.map(s => `<option value="${x.esc(s.id)}" ${f.storeId === s.id ? 'selected' : ''}>${x.esc(s.name)}</option>`).join('')}</select></label>${includeTherapists ? `<label class="field"><span>康复师</span><select name="therapistId"><option value="">全部康复师</option>${x.state.therapists.map(t => `<option value="${x.esc(t.id)}" ${f.therapistId === t.id ? 'selected' : ''}>${x.esc(t.name)}</option>`).join('')}</select></label>` : ''}<label class="field"><span>开始日期</span><input type="date" name="from" value="${x.esc(f.from || '')}"></label><label class="field"><span>结束日期</span><input type="date" name="to" value="${x.esc(f.to || '')}"></label><button class="btn btn-primary" type="submit">查看</button>${x.action('清除筛选', 'reset-filters', '', 'btn-quiet')}</form>`;
}

// Every pending appointment belongs to exactly one work group. Amounts only
// include primary service; collaborative completion is counted separately.
export function workSummary(model, role, today = model.today || TODAY) {
  const state = model.state;
  const clients = model.visibleClients(role);
  const visible = new Set(clients.map(c => c.id));
  const isPending = item => !['completed', 'done'].includes(item.status);
  const pendingTasks = (state.tasks || []).filter(t => isPending(t) && visible.has(t.clientId) &&
    (role.type === 'boss' || (t.type !== 'review_followup' && t.assigneeId === role.id)));
  const assignedRequests = new Set(pendingTasks.filter(t => t.type === 'reschedule').map(t => t.appointmentId));
  const ordered = rows => rows.slice().sort((a, b) => `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`));
  const appointments = ordered((state.appointments || []).filter(a => ['confirmed', 'reschedule_requested', 'pending_reassignment'].includes(a.status) && visible.has(a.clientId) &&
    (role.type === 'boss' || (a.status === 'pending_reassignment' ? state.clients.find(c => c.id === a.clientId)?.ownerId === role.id : a.principalId === role.id) || (a.status === 'reschedule_requested' && assignedRequests.has(a.id)))));
  const attention = appointments.filter(a => a.date < today || ['reschedule_requested','pending_reassignment'].includes(a.status));
  const todayAppointments = appointments.filter(a => a.date === today && a.status === 'confirmed');
  const future = appointments.filter(a => a.date > today && a.status === 'confirmed');
  const displayedAppointments = new Set(appointments.map(a => a.id));
  const tasks = pendingTasks.filter(t => !(['reschedule', 'service_note'].includes(t.type) && displayedAppointments.has(t.appointmentId)))
    .sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || a.title.localeCompare(b.title));
  const services = model.serviceRows({from: today, to: today}).filter(s => s.status === 'valid');
  const main = services.filter(s => role.type === 'boss' || s.principalId === role.id);
  const collaborations = services.filter(s => s.principalId !== role.id && (s.participantIds || []).includes(role.id));
  const completed = services.filter(s => role.type === 'boss' || s.principalId === role.id || (s.participantIds || []).includes(role.id));
  const followups = clients.filter(c => role.type === 'boss' || c.ownerId === role.id).map(client => {
    const remaining = remainingAtStore(model, client.id, client.storeId);
    const unplanned = !(state.appointments || []).some(a => a.clientId === client.id &&
      ['confirmed', 'reschedule_requested'].includes(a.status) && a.date >= today);
    return {client, remaining, hasPackage:hasStorePackage(model,client.id,client.storeId), low:hasStorePackage(model,client.id,client.storeId) && remaining <= 2, unplanned};
  }).filter(item => item.low || item.unplanned).sort((a, b) => a.remaining - b.remaining || a.client.name.localeCompare(b.client.name, 'zh-CN'));
  return {today: todayAppointments, attention, future, tasks, main, collaborations, completed, followups,
    amount: Math.round((main.reduce((sum, s) => sum + s.amount, 0) + Number.EPSILON) * 100) / 100};
}

function work(ctx) {
  const TODAY = ctx.model.today || "2026-10-08";
  const x = h(ctx);
  const w = workSummary(ctx.model, x.role);
  const fold = (label, count, unit, body, urgent = false) => `<details class="ease-work-notice${urgent && count ? ' ease-work-urgent' : ''}"><summary><strong>${x.esc(label)}</strong><span class="ease-fold-count">${count} ${unit}</span>${x.ico('chevron-right', 18)}</summary><div class="ease-fold-body">${body}</div></details>`;
  const appointmentCard = (a, kind) => {
    const remaining = remainingAtStore(ctx.model, a.clientId, a.storeId);
    const hasPackage=hasStorePackage(ctx.model,a.clientId,a.storeId);
    const overdue = a.date < TODAY;
    const requested = a.status === 'reschedule_requested';
    const reassign = a.status === 'pending_reassignment';
    const canConfirmArrival = !reassign && (x.role.type === 'boss' || a.principalId === x.role.id);
    const register = x.action(overdue ? '补登记服务' : '登记本次服务', 'register-appointment', a.id, 'btn-primary', 'clipboard-text');
    const primary = reassign ? x.action('重新安排', 'appointment-edit', a.id, 'btn-primary', 'calendar') : requested ? x.action('确认改约', 'appointment-edit', a.id, 'btn-primary', 'calendar') : kind === 'future' ? x.action('调整安排', 'appointment-edit', a.id, 'btn-outline', 'calendar') : remaining > 0 ? register : x.action('查看套餐次数', 'package', a.clientId, 'btn-outline');
    return `<article class="ease-service-card"><div class="ease-service-head"><div><span class="ease-service-time">${kind === 'today' ? x.esc(a.time) : `${x.date(a.date)} · ${x.esc(a.time)}`}</span><h3>${x.esc(x.client(a.clientId)?.name || '客户')}</h3></div>${x.tag(`${x.name('stores', a.storeId)}剩余 ${remaining} 次`, remaining <= 2 ? 'warn' : 'green')}</div><p class="ease-service-project">${x.esc(a.project)}</p>${a.arrivalAt?'<p class="ease-arrival-note">客户已到店 · 服务完成后请及时登记。</p>':''}<p class="meta">${x.esc(x.name('stores', a.storeId))} · 主康复师 ${x.esc(x.name('therapists', a.principalId))}${(a.participantIds || []).length ? ` · 协作 ${x.esc(a.participantIds.map(id => x.name('therapists', id)).join('、'))}` : ''}</p>${reassign ? '<p class="ease-service-warning">服务人员需要重新确认，请先选择在职且有权限的康复师。</p>' : requested ? `<div class="note"><strong>希望改至 ${x.date(a.request?.date)} ${x.esc(a.request?.time || '')}</strong><p>${x.esc(a.requestNote || a.request?.reason || '未填写说明')}</p><span class="meta">确认前仍保留上方原预约。</span></div>` : overdue ? '<p class="ease-service-warning">预约日期已过，请核实到店情况。</p>' : ''}${remaining === 0 ? '<p class="ease-service-warning">'+(hasPackage?'套餐次数已用完，请由老板核对后续套餐。':'尚未办理本店套餐，服务费用请先与门店核对。')+'</p>' : ''}<div class="ease-service-actions">${primary}${x.link('客户档案', 'client-detail', a.clientId)}</div><details class="ease-service-options"><summary>更多操作${x.ico('chevron-right', 15)}</summary><div class="action-row">${requested && a.date <= TODAY && remaining > 0 ? x.action('按原预约登记', 'register-appointment', a.id, 'btn-small btn-outline') : ''}${a.date <= TODAY && canConfirmArrival ? x.action('记录未到店', 'appointment-no-show', a.id, 'btn-small btn-outline') : ''}${!requested && !reassign && kind !== 'future' ? x.action('调整安排', 'appointment-edit', a.id, 'btn-small btn-outline') : ''}${x.action('取消预约', 'appointment-cancel', a.id, 'btn-small btn-quiet')}</div></details></article>`;
  };
  const tasks = w.tasks.map(t => {
    const ap = x.find('appointments', t.appointmentId);
    const review = x.find('reviews', t.reviewId);
    const canRegister = t.type === 'service_note' && ap && ['confirmed', 'reschedule_requested'].includes(ap.status) && ap.date <= TODAY;
    const endedWithoutService = ap && ['cancelled', 'no_show'].includes(ap.status);
    const serviceNote = t.type === 'service_note' ? !ap ? '尚未关联预约，请先核对客户的服务安排。' : endedWithoutService ? '对应预约已取消或未到店，无需登记服务。' : ap.status === 'completed' ? '对应预约已完成，请核对服务记录。' : ap.date > TODAY ? '预约日期尚未到，服务完成后再登记。' : '' : '';
    const taskAction = t.type === 'service_note'
      ? x.action(canRegister ? '登记对应服务' : !ap ? '核对客户档案' : ap.serviceId ? '核对服务记录' : '核对预约记录', canRegister ? 'register-appointment' : !ap ? 'client-detail' : ap.serviceId ? 'service-detail' : 'appointment-history', canRegister ? ap.id : ap?.serviceId || t.clientId, 'btn-small btn-outline')
      : t.type === 'review_followup' ? x.link('查看反馈来源', review?.serviceId ? 'service-detail' : 'client-detail', review?.serviceId || t.clientId) : t.type === 'reschedule' && !ap ? x.link('核对客户安排', 'client-detail', t.clientId) : x.action(t.type === 'reschedule' ? '处理改约' : '完成', 'task-complete', t.id, 'btn-small btn-outline', 'check');
    const opensClient = (['service_note', 'reschedule'].includes(t.type) && !ap) || (t.type === 'review_followup' && !review?.serviceId);
    return `<div class="row"><div class="row-main"><strong>${x.esc(t.title)}</strong><div class="meta">${x.esc(x.client(t.clientId)?.name || '客户')} · ${x.date(t.dueDate)}${t.dueDate && t.dueDate < TODAY ? ` ${x.tag('逾期待跟进', 'warn')}` : ''}</div>${serviceNote ? `<div class="meta">${x.esc(serviceNote)}</div>` : ''}${t.type === 'review_followup' ? '<div class="meta">反馈回访由老板记录处理结果。</div>' : ''}</div><div class="action-row">${opensClient ? '' : x.link('查看客户', 'client-detail', t.clientId)}${taskAction}</div></div>`;
  }).join('');
  const followups = w.followups.map(r => `<div class="row"><div class="row-main"><strong>${x.esc(r.client.name)}</strong><div class="meta">${x.esc(x.name('stores', r.client.storeId))} · 我负责</div><div class="ease-reminder-tags">${!r.hasPackage?x.tag('尚未办理本店套餐'):''}${r.low ? x.tag(r.remaining === 0 ? `${x.name('stores',r.client.storeId)}套餐已用完` : `${x.name('stores',r.client.storeId)}剩余 ${r.remaining} 次`, 'warn') : ''}${r.unplanned ? x.tag('未安排下次服务', 'warn') : ''}</div></div><div class="action-row">${x.link('查看档案', 'client-detail', r.client.id)}${r.unplanned ? x.action('安排服务', 'appointment-create', r.client.id, 'btn-small btn-outline') : x.link('套餐次数', 'package', r.client.id)}</div></div>`).join('');
  const completed = w.completed.map(s => `<div class="row"><div class="row-main"><strong>${x.esc(x.client(s.clientId)?.name || '客户')} · ${x.esc(s.project)}</strong><div class="meta">${x.esc(s.time)} · ${x.esc(x.name('stores', s.storeId))} · ${s.principalId === x.role.id ? `主服务 · ${x.money(s.amount)}` : `协作参与 · 主康复师 ${x.esc(x.name('therapists', s.principalId))}`}</div></div>${x.link('查看明细', 'service-detail', s.id)}</div>`).join('');
  return `<div class="ease-work"><div class="page-head"><div><span class="eyebrow">${x.date(TODAY)} · 今天</span><h1>${x.esc(x.name('therapists', x.role.id))}，今天好</h1><p class="muted">先看今天的安排，服务结束后登记。</p></div><div class="ease-work-head-actions">${x.action('登记服务', 'register', '', 'btn-primary', 'plus')}${x.action('安排服务', 'appointment-create', '', 'btn-outline', 'calendar')}${clientIntakeButton(ctx)}${x.action('一起预约','appointment-batch','','btn-outline')}</div></div>
    ${renderPaperIntakeInbox(ctx)}<div class="ease-work-stats"><div class="ease-work-stat"><span>今日待服务</span><strong>${w.today.length}<small> 次</small></strong><small>按预约时间排列</small></div><div class="ease-work-stat"><span>今日已完成</span><strong>${w.completed.length}<small> 次</small></strong><small>主服务 ${w.main.length} · 协作 ${w.collaborations.length}</small></div><div class="ease-work-stat ease-work-stat-amount"><span>今日消费业绩</span><strong>${x.money(w.amount)}</strong><small>仅计算本人主服务</small></div></div>
    ${w.attention.length ? `<section class="ease-work-alert">${fold('需要确认的服务安排', w.attention.length, '条', `<div class="ease-service-list">${w.attention.map(a => appointmentCard(a, 'attention')).join('')}</div>`, true)}</section>` : ''}
    <section class="ease-work-main"><div class="section-head"><h2>今天的服务</h2>${x.tag(`${w.today.length} 次`)}</div><div class="ease-service-list">${w.today.length ? w.today.map(a => appointmentCard(a, 'today')).join('') : `<div class="empty">今天暂无待服务预约${w.attention.some(a => a.date === TODAY) ? '，请先在上方确认改约申请。' : '。可以安排服务，或登记已实际完成的服务。'}</div>`}</div></section>
    <section class="ease-work-more"><div class="section-head"><h2>其他安排与跟进</h2>${x.link('服务记录与业绩', 'nav', 'performance')}</div>${fold('工作待办', w.tasks.length, '项', tasks ? `<div class="line-list">${tasks}</div>` : '<div class="empty">当前工作待办已完成。</div>')}${fold('之后的预约', w.future.length, '次', w.future.length ? `<div class="ease-service-list">${w.future.map(a => appointmentCard(a, 'future')).join('')}</div>` : '<div class="empty">今天之后暂无已确认预约。</div>')}${fold('我负责客户的跟进', w.followups.length, '位', followups ? `<div class="line-list">${followups}</div>` : '<div class="empty">负责客户暂时没有套餐不足或未安排预约的提醒。</div>')}${fold('今日完成记录', w.completed.length, '次', completed ? `<div class="line-list">${completed}</div>` : '<div class="empty">登记完成的服务和协作记录会显示在这里。</div>')}</section></div>`;
}

function clientList(ctx) {
  const TODAY = ctx.model.today || "2026-10-08";
  const x = h(ctx);
  const f = ctx.filters || {};
  const q = (f.query || '').trim().toLowerCase();
  const visible = x.clients.filter(c => (x.role.type === 'therapist' || ((!f.storeId || c.storeId === f.storeId) && (!f.therapistId || c.ownerId === f.therapistId))) && (!q || `${c.name} ${c.phone || ''}`.toLowerCase().includes(q)));
  if (x.role.type === 'therapist') {
    const cards = visible.map(c => {
      const next = x.state.appointments.filter(a => a.clientId === c.id && ['confirmed', 'reschedule_requested'].includes(a.status) && a.date >= TODAY).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))[0];
      const recent = x.rows({clientId: c.id}).find(s => s.status === 'valid');
      const balanceStore = f.storeId || c.storeId;
      const remaining = remainingAtStore(ctx.model, c.id, balanceStore);
      return `<article class="card ease-client-card"><div class="section-head"><div><h2>${x.esc(c.name)}</h2><p class="meta">${x.esc(x.name('stores', c.storeId))} · ${c.ownerId === x.role.id ? '我负责' : `参与服务 · 负责人 ${x.esc(x.name('therapists', c.ownerId))}`}</p></div>${x.tag(`${x.name('stores', balanceStore)}剩余 ${remaining} 次`, remaining <= 2 ? 'warn' : 'green')}</div><div class="ease-client-schedule"><span>下次服务</span><strong>${next ? `${x.date(next.date)} ${x.esc(next.time)}` : '待安排'}</strong>${next ? `<small>${x.esc(x.name('stores', next.storeId))} · ${x.esc(x.name('therapists', next.principalId))}${next.status === 'reschedule_requested' ? ' · 改约待确认' : ''}</small>` : ''}</div>${recent ? `<p class="meta">最近服务：${x.date(recent.date)} · ${x.esc(recent.project)}</p>` : '<p class="meta">暂无新增服务记录</p>'}<div class="ease-client-actions">${x.action('查看档案', 'client-detail', c.id, 'btn-outline')}${c.ownerId===x.role.id||x.role.type==='boss'?x.action('初访接待表','paper-intake-create',c.id,'btn-outline'):''}${x.action('评估记录','assessment-history',c.id,'btn-outline')}${x.action('登记服务', 'register', c.id, 'btn-primary')}</div></article>`;
    }).join('');
    return `<div class="ease-client-list"><div class="page-head"><div><span class="eyebrow">客户档案</span><h1>我的客户</h1><p class="muted">本人负责或实际参与过服务的客户。</p></div><div class="action-row">${clientIntakeButton(ctx)}${x.action('选择客户登记', 'register', '', 'btn-outline', 'plus')}</div></div><form class="toolbar" data-form="client-search"><label class="field search-field"><span class="sr-only">搜索客户姓名或手机号</span><input name="query" type="search" placeholder="搜索姓名或手机号" value="${x.esc(q)}"></label><button class="btn btn-outline" type="submit">${x.ico('search', 18)}搜索</button></form><p class="ease-list-count">共 ${visible.length} 位客户</p><div class="client-grid">${cards || '<div class="empty card">未找到客户，请调整搜索内容。</div>'}</div></div>`;
  }
  return `<div class="page-head"><div><span class="eyebrow">客户档案</span><h1>${x.role.type === 'boss' ? '所有客户' : '我的客户'}</h1><p class="muted">${x.role.type === 'boss' ? '多店共用一份档案，跨店服务清晰可追溯。' : '查看您负责或实际参与过服务的客户。'}</p></div>${x.role.type === 'boss' ? `<div class="action-row">${clientIntakeButton(ctx)}${x.action('录入一位客户','import-opening','','btn-outline','plus')}${x.action('表格批量录入','import-opening-batch','','btn-primary')}</div>` : ''}</div><form class="toolbar" data-form="client-search"><label class="field search-field"><span class="sr-only">搜索客户姓名或手机号</span><input name="query" type="search" placeholder="搜索客户姓名或手机号" value="${x.esc(q)}"></label><button class="btn btn-outline" type="submit">${x.ico('search', 18)}搜索</button></form><div class="client-grid">${visible.length ? visible.map(c => `<article class="card person-card"><div class="section-head"><div><h2>${x.esc(c.name)}</h2><span class="meta">${x.esc(x.name('stores', c.storeId))}</span></div><div class="metric"><strong>${remainingAtStore(ctx.model,c.id,f.storeId || c.storeId)}</strong><span>${x.esc(x.name('stores',f.storeId || c.storeId))}剩余次数</span></div></div><div class="meta">负责人 ${x.esc(x.name('therapists', c.ownerId))} ${c.ownerId === x.role.id ? x.tag('我负责', 'green') : x.role.type === 'therapist' ? x.tag('参与服务') : ''}</div><p class="client-goal">${x.esc(c.goal || '康复目标待评估后完善')}</p><div class="note"><span class="muted">下一步</span><p>${x.esc(c.nextStep || '由负责康复师制定下一步安排')}</p></div><div class="action-row">${x.action('查看档案', 'client-detail', c.id, 'btn-outline')}${x.action('评估记录','assessment-history',c.id,'btn-outline')}${x.action('登记服务', 'register', c.id, 'btn-primary')}${x.role.type === 'boss' ? x.link('转交负责人', 'transfer-client', c.id) : ''}</div></article>`).join('') : '<div class="empty card">未找到符合条件的客户。</div>'}</div>`;
}

function performance(ctx) {
  const x = h(ctx);
  const tid = x.role.type === 'therapist' ? x.role.id : ctx.filters?.therapistId;
  const base = ctx.filters || {};
  const services = x.rows(base).filter(s => (x.inScope(s) || (x.role.type === "therapist" && s.principalId === x.role.id)) && (!tid || s.principalId === tid));
  const valid = services.filter(s => s.status === 'valid');
  const {therapistId: ignored, ...collabFilters} = base;
  const collabs = tid ? x.rows(collabFilters).filter(s => s.participantIds.includes(tid) && (x.inScope(s) || (x.role.type === "therapist" && tid === x.role.id))) : [];
  const total = tid ? ctx.model.performance(tid, base) : valid.reduce((sum, s) => sum + s.amount, 0);
  if (x.role.type === 'therapist') {
    const period = base.from || base.to ? `${base.from ? x.date(base.from) : '不限开始'} — ${base.to ? x.date(base.to) : '不限结束'}` : '全部日期';
    const collaborationRows = collabs.map(s => `<div class="row"><div class="row-main"><strong>${x.esc(x.client(s.clientId)?.name || '客户')} · ${x.esc(s.project)}</strong><div class="meta">${x.date(s.date)} ${x.esc(s.time)} · ${x.esc(x.name('stores', s.storeId))} · 主康复师 ${x.esc(x.name('therapists', s.principalId))}</div></div><div class="row-side">${x.tag(s.status === 'revoked' ? '已撤销' : '协作参与', s.status === 'revoked' ? 'warn' : '')}${x.link('查看明细', 'service-detail', s.id)}</div></div>`).join('');
    return `<div class="ease-performance"><div class="page-head"><div><span class="eyebrow">每笔业绩都能查看对应服务</span><h1>我的业绩</h1><p class="muted">${x.esc(base.storeId ? x.name('stores', base.storeId) : '全部门店')} · ${x.esc(period)}</p></div></div><details class="ease-performance-filters"><summary><strong>筛选门店与日期</strong>${x.ico('chevron-right', 18)}</summary>${filters(ctx, false)}</details><div class="ease-work-stats"><div class="ease-work-stat ease-work-stat-amount"><span>消费业绩</span><strong>${x.money(total)}</strong><small>本人主服务产生</small></div><div class="ease-work-stat"><span>主服务</span><strong>${valid.length}<small> 次</small></strong><small>已完成的服务</small></div><div class="ease-work-stat"><span>协作参与</span><strong>${collabs.filter(s => s.status === 'valid').length}<small> 次</small></strong><small>不重复计算金额</small></div></div>${services.some(s => s.status === 'revoked') ? `<p class="ease-performance-note">${services.filter(s => s.status === 'revoked').length} 条已撤销记录保留供核对，不计入消费业绩。</p>` : ''}${ledger(ctx, services, '主服务记录')}<details class="ease-work-notice ease-collaboration-records"><summary><strong>协作服务记录</strong><span class="ease-fold-count">${collabs.length} 条</span>${x.ico('chevron-right', 18)}</summary><div class="ease-fold-body"><p class="ease-performance-note">协作记录保留参与情况，消费业绩归本次主康复师。</p><div class="line-list">${collaborationRows || '<div class="empty">当前范围内暂无协作服务记录。</div>'}</div></div></details></div>`;
  }
  return `<div class="page-head"><div><span class="eyebrow">实际服务产生的业绩</span><h1>${tid ? `${x.esc(x.name('therapists', tid))}的业绩` : '康复师业绩'}</h1><p class="muted">以每次已完成服务为依据，点击明细核对客户、门店和服务人员。</p></div></div>${filters(ctx, x.role.type === 'boss')}<div class="stat-grid"><div class="stat"><span>消费业绩</span><strong>${x.money(total)}</strong></div><div class="stat"><span>主康复师服务</span><strong>${valid.length}<small> 次</small></strong></div><div class="stat"><span>协作参与</span><strong>${tid ? collabs.filter(s => s.status === 'valid').length : valid.reduce((sum, s) => sum + (s.participantIds || []).length, 0)}<small> 次</small></strong></div><div class="stat"><span>已撤销记录</span><strong>${services.filter(s => s.status === 'revoked').length}<small> 条</small></strong></div></div><div class="note">一次服务扣 1 次；消费业绩全部归本次主康复师。协作记录单独保留。</div>${ledger(ctx, services)}${tid ? `<section class="section card"><div class="section-head"><h2>协作服务记录</h2>${x.tag('参与记录')}</div><p class="muted">您参与了以下服务，消费业绩归相应主康复师。</p><div class="line-list">${collabs.length ? collabs.map(s => `<div class="row"><div class="row-main"><strong>${x.esc(x.client(s.clientId)?.name)} · ${x.esc(s.project)}</strong><div class="meta">${x.date(s.date)} · ${x.esc(x.name('stores', s.storeId))} · 主康复师 ${x.esc(x.name('therapists', s.principalId))}</div></div><div class="row-side">${x.tag(s.status === 'revoked' ? '已撤销' : '协作参与', s.status === 'revoked' ? 'warn' : '')}${x.link('查看明细', 'service-detail', s.id)}</div></div>`).join('') : '<div class="empty">当前日期范围内暂无协作服务。</div>'}</div></section>` : ''}`;
}

// Financial dates apply to service totals; current follow-ups keep their own dates.
export function bossSummary(model, f = {}) {
  const TODAY = model.today || "2026-10-08";
  const state = model.state;
  const valid = model.serviceRows(f).filter(s => s.status === 'valid');
  const {therapistId: ignoredTherapist, ...collaborationFilters} = f;
  const collaborationRows = model.serviceRows(collaborationFilters).filter(s => s.status === 'valid');
  const scope = item => (!f.storeId || item.storeId === f.storeId) && (!f.therapistId || item.principalId === f.therapistId);
  const appointments = state.appointments.filter(a => ['confirmed','reschedule_requested','pending_reassignment'].includes(a.status) &&
    (a.date < TODAY || ['reschedule_requested','pending_reassignment'].includes(a.status)) && scope(a.status === 'pending_reassignment' ? {...a,principalId:state.clients.find(c=>c.id===a.clientId)?.ownerId} : a)).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const unrecordedArrivals=state.appointments.filter(a=>a.arrivalAt&&a.date<=TODAY&&['confirmed','reschedule_requested'].includes(a.status)&&scope(a));
  const reviews = state.reviews.filter(r => r.followupStatus === 'pending' && scope(state.services.find(s => s.id === r.serviceId) || {}));
  const clients = state.clients.filter(c => (!f.storeId || c.storeId === f.storeId) && (!f.therapistId || c.ownerId === f.therapistId));
  const low = clients.filter(c => hasStorePackage(model,c.id,f.storeId || c.storeId) && remainingAtStore(model,c.id,f.storeId || c.storeId) <= 2).sort((a,b) => remainingAtStore(model,a.id,f.storeId || a.storeId) - remainingAtStore(model,b.id,f.storeId || b.storeId));
  const unplanned = clients.filter(c => !state.appointments.some(a => a.clientId === c.id && ['confirmed','reschedule_requested'].includes(a.status) && a.date >= TODAY));
  const tasks = state.tasks.filter(t => !['completed','done'].includes(t.status) &&
    (!f.storeId || state.clients.find(c => c.id === t.clientId)?.storeId === f.storeId) && (!f.therapistId || t.assigneeId === f.therapistId) &&
    !(t.type === 'reschedule' && appointments.some(a => a.id === t.appointmentId)) &&
    !(t.type === 'review_followup' && reviews.some(r => r.id === t.reviewId)))
    .sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const followupClients = new Set([...appointments.map(a => a.clientId), ...reviews.map(r => state.services.find(s => s.id === r.serviceId)?.clientId || r.clientId),
    ...low.map(c => c.id), ...unplanned.map(c => c.id), ...unrecordedArrivals.map(a=>a.clientId), ...tasks.map(t => t.clientId)].filter(Boolean));
  const therapists = state.therapists.filter(t => !f.therapistId || t.id === f.therapistId).map(t => {
    const own = valid.filter(s => s.principalId === t.id);
    return {...t, amount: own.reduce((sum,s) => sum + s.amount,0), count: own.length,
      collaborations: collaborationRows.filter(s => s.participantIds.includes(t.id)).length};
  }).sort((a,b) => b.amount - a.amount || b.count - a.count || a.name.localeCompare(b.name));
  const stores = state.stores.filter(s => !f.storeId || s.id === f.storeId).map(store => {
    const rows = valid.filter(s => s.storeId === store.id);
    return {...store, amount: rows.reduce((sum,s) => sum + s.amount,0), count: rows.length};
  });
  return {valid, amount: valid.reduce((sum,s) => sum + s.amount,0), appointments, unrecordedArrivals, reviews, low, unplanned, tasks,
    followupCount: followupClients.size, therapists, stores};
}

function overview(ctx) {
  const TODAY = ctx.model.today || "2026-10-08";
  const x = h(ctx), f = ctx.filters || {}, b = bossSummary(ctx.model,f);
  const period = f.from === TODAY && f.to === TODAY ? '今天' : f.from === `${TODAY.slice(0,7)}-01` && f.to === TODAY ? '本月' : !f.from && !f.to ? '全部时间' : '所选日期';
  const scopeLabel = `${f.storeId ? x.name('stores',f.storeId) : '全部门店'}${f.therapistId ? ` · ${x.name('therapists',f.therapistId)}` : ''}`;
  const notice = (title, count, unit, html) => `<details class="boss-notice"><summary><span>${title}</span><span class="boss-notice-count ${count ? 'has-items' : ''}">${count} ${unit}</span>${x.ico('chevron-right',18)}</summary><div class="boss-notice-body">${html}</div></details>`;
  const appointmentRows = b.appointments.map(a => `<div class="boss-detail-row"><strong>${x.esc(x.client(a.clientId)?.name)} · ${a.status === 'pending_reassignment' ? '服务人员待重新安排' : a.date < TODAY ? '到店情况待确认' : '申请改约'}</strong><p class="meta">${x.date(a.date)} ${x.esc(a.time)} · ${x.esc(x.name('stores',a.storeId))} · ${x.esc(x.name('therapists',a.principalId))}</p><div class="action-row">${x.action('核实与处理','appointment-history',a.clientId,'btn-small btn-primary')}</div></div>`).join('');
  const reviewRows = b.reviews.map(r => { const s = x.find('services',r.serviceId); return `<div class="boss-detail-row"><strong>${x.esc(x.client(s?.clientId || r.clientId)?.name)} · ${r.score} 分评价</strong><p>${x.esc(r.feedback || '客户希望老板联系')}</p>${x.action('记录回访','followup',r.id,'btn-small btn-primary')}</div>`; }).join('');
  const clientRows = (clients,kind) => clients.map(c => `<div class="boss-detail-row"><strong>${x.esc(c.name)}${kind === 'low' ? ` · ${x.esc(x.name('stores',f.storeId || c.storeId))}剩余 ${remainingAtStore(ctx.model,c.id,f.storeId || c.storeId)} 次` : ''}</strong><p class="meta">${x.esc(x.name('stores',c.storeId))} · 负责人 ${x.esc(x.name('therapists',c.ownerId))}</p><div class="action-row">${kind === 'unplanned' ? x.action('安排下次服务','appointment-create',c.id,'btn-small btn-primary') : !hasStorePackage(ctx.model,c.id,f.storeId || c.storeId) ? x.action('办理本店套餐','create-store-package',c.id,'btn-small btn-primary') : remainingAtStore(ctx.model,c.id,f.storeId || c.storeId) === 0 ? x.action('续接套餐','renew-package',c.id,'btn-small btn-primary') : x.action('查看套餐','package',c.id,'btn-small btn-outline')}${x.link('客户档案','client-detail',c.id)}</div></div>`).join('');
  const taskRows = b.tasks.map(t => `<div class="boss-detail-row"><strong>${x.esc(x.client(t.clientId)?.name)} · ${x.esc(t.title)}</strong><p class="meta">${x.esc(x.name('therapists',t.assigneeId))} · ${x.date(t.dueDate)}${t.dueDate && t.dueDate < TODAY ? ' · 已逾期' : ''}</p><div class="action-row">${x.link('客户档案','client-detail',t.clientId)}${x.action(['reschedule','review_followup'].includes(t.type) ? '处理' : '完成待办','task-complete',t.id,'btn-small btn-outline')}</div></div>`).join('');
  return `<div class="boss-dashboard">
    <header class="boss-heading"><div><span class="eyebrow">${x.date(TODAY)} · 示例数据</span><h1>老板看板</h1></div><div class="action-row">${clientIntakeButton(ctx)}${x.action('一起预约','appointment-batch','','btn-outline')}${x.action('客户管理','nav','clients','btn-outline','users')}</div></header>
    <div class="boss-toolbar"><div class="boss-period" aria-label="业绩时间范围">${[['today','今天'],['month','本月'],['all','全部']].map(([id,label]) => `<button type="button" data-action="boss-period" data-id="${id}" aria-pressed="${period === (id === 'all' ? '全部时间' : label)}">${label}</button>`).join('')}</div><label class="boss-store"><span class="sr-only">看板门店</span><select data-boss-store aria-label="看板门店"><option value="">全部门店</option>${x.state.stores.map(s => `<option value="${x.esc(s.id)}" ${f.storeId === s.id ? 'selected' : ''}>${x.esc(s.name)}</option>`).join('')}</select></label><details class="boss-more"><summary>更多筛选</summary><form data-form="filters" class="boss-advanced"><input type="hidden" name="storeId" value="${x.esc(f.storeId || '')}"><label class="field"><span>康复师</span><select name="therapistId"><option value="">全部康复师</option>${x.state.therapists.map(t => `<option value="${x.esc(t.id)}" ${f.therapistId === t.id ? 'selected' : ''}>${x.esc(t.name)}</option>`).join('')}</select></label><label class="field"><span>开始日期</span><input type="date" name="from" value="${x.esc(f.from || '')}"></label><label class="field"><span>结束日期</span><input type="date" name="to" value="${x.esc(f.to || '')}"></label><div class="action-row"><button type="submit" class="btn btn-primary">应用筛选</button>${x.action('恢复今天','boss-reset','','btn-quiet')}</div><p class="boss-filter-note">业绩、预约与反馈按服务门店及主康复师查看；客户提醒按所属门店及负责人；工作待办按客户所属门店及执行人。</p></form></details></div>
    <p class="boss-scope">${x.esc(scopeLabel)} · ${period}${period === '所选日期' ? ` ${f.from ? x.date(f.from) : '不限开始'}—${f.to ? x.date(f.to) : '不限结束'}` : ''}</p>
    ${cashOverview(ctx,period)}
    <div class="boss-stats"><div class="boss-stat"><span>消费业绩</span><strong>${x.money(b.amount)}</strong><small>来自实际消课 · 收款另计</small></div><div class="boss-stat"><span>完成服务</span><strong>${b.valid.length}<small> 次</small></strong><small>${period}已登记</small></div><div class="boss-stat"><span>待跟进客户</span><strong>${b.followupCount}<small> 位</small></strong><small>当前提醒 · 按客户去重</small></div></div>
    <div class="boss-columns"><section class="boss-panel"><div class="section-head"><h2>需要处理</h2><span class="muted">点开即可处理</span></div>${renderPaperIntakeInbox(ctx)}<p class="boss-panel-note">${b.followupCount ? '查看当前提醒，不受业绩日期影响。' : '当前没有待跟进客户。'}</p>
      ${notice('需要确认的服务安排',b.appointments.length,'条',appointmentRows || '<p class="empty">当前没有待处理预约。</p>')}
      ${notice('已到店待登记',b.unrecordedArrivals.length,'位',b.unrecordedArrivals.map(a=>`<div class="boss-detail-row"><strong>${x.esc(x.client(a.clientId)?.name)}</strong><p class="meta">${x.date(a.date)} ${x.esc(a.time)} · ${x.esc(x.name('stores',a.storeId))} · ${x.esc(x.name('therapists',a.principalId))}</p><p class="meta">客户已到店，请核实服务完成情况，再由康复师登记。</p>${x.link('查看预约','appointment-history',a.clientId)}</div>`).join('')||'<p class="empty">当前没有已到店待登记的客户。</p>')}
      ${notice('客户反馈待回访',b.reviews.length,'条',reviewRows || '<p class="empty">当前没有待回访反馈。</p>')}
      ${notice('套餐剩余不足',b.low.length,'位',clientRows(b.low,'low') || '<p class="empty">当前没有剩余 2 次及以下的客户。</p>')}
      ${notice('未安排下次服务',b.unplanned.length,'位',clientRows(b.unplanned,'unplanned') || '<p class="empty">当前客户已有今天或之后的服务安排。</p>')}
      ${notice('工作待办',b.tasks.length,'项',taskRows || '<p class="empty">当前待办已完成。</p>')}
    </section><section class="boss-panel"><div class="section-head"><h2>康复师业绩</h2>${x.link('全部明细','nav','performance')}</div><p class="boss-panel-note">${period} · 点击人员查看实际服务</p><div class="boss-people">${b.therapists.map(t => `<button type="button" class="boss-person" data-action="therapist-performance" data-id="${x.esc(t.id)}"><span class="boss-person-info"><strong>${x.esc(t.name)}</strong><span>${x.esc(x.name('stores',t.storeId))} · 主服务 ${t.count} 次${t.collaborations ? ` · 协作 ${t.collaborations} 次` : ''}${t.active === false ? ' · 已停用' : ''}</span></span><span class="boss-person-amount">${x.money(t.amount)}</span>${x.ico('chevron-right',17)}</button>`).join('') || '<p class="empty">当前范围没有康复师。</p>'}</div><p class="boss-panel-note">消费业绩归主康复师，协作不重复计算。</p></section></div>
    <section class="boss-panel boss-store-panel"><div class="section-head"><h2>门店服务</h2><span class="muted">${period} · 按实际服务门店</span></div><div class="boss-store-list">${b.stores.map(s => `<div class="boss-store-row"><strong>${x.esc(s.name)}</strong><span>登记 ${s.count} 次</span><strong class="amount">${x.money(s.amount)}</strong></div>`).join('')}</div></section>
    <div class="boss-footer">${x.action('查看服务明细','nav','performance','btn-outline','clipboard-text')}${x.action('门店与人员管理','nav','team','btn-quiet')}</div>
  </div>`;
}

function team(ctx) {
  assertPersonnelBoss(ctx);
  const x = h(ctx);
  const status = person => x.tag(person.active === false ? '已停用' : '使用中', person.active === false ? '' : 'green');
  const contact = person => `<p class="meta personnel-contact">手机号：${x.esc(person.phone || '未填写手机号')}</p>`;
  const staffRow = (person, kind) => `<div class="row"><div class="row-main"><strong>${x.esc(person.name)}</strong>${contact(person)}<p class="meta">${x.esc(kind === 'frontdesk' ? (person.storeIds || []).map(id => x.name('stores', id)).join('、') : x.name('stores', person.storeId))} · ${kind === 'frontdesk' ? '前台' : '店长'} ${status(person)}</p></div><div class="action-row">${x.action('编辑资料', `edit-${kind}`, person.id, 'btn-small btn-outline')}${kind === 'frontdesk' ? x.action('工作记录', 'frontdesk-work', person.id, 'btn-small btn-quiet') : ''}${person.active !== false ? x.action('停用', `deactivate-${kind}`, person.id, 'btn-small btn-quiet') : ''}</div></div>`;
  return `<div class="personnel-page"><div class="page-head"><div><span class="eyebrow">老板工作台</span><h1>人员管理</h1><p class="muted">资料和权限由老板维护。新增时选好岗位和门店；已有人员点击“编辑资料”。</p></div><div class="action-row">${x.action('新增康复师', 'add-therapist', '', 'btn-primary', 'plus')}${x.action('新增前台', 'add-frontdesk', '', 'btn-outline', 'plus')}${x.action('新增店长', 'add-manager', '', 'btn-outline', 'plus')}</div></div>
    <section class="section card"><div class="section-head"><div><h2>康复师</h2><p class="muted">负责客户、评估、服务与消课。停用后保留历史服务。</p></div><span class="muted">${x.state.therapists.filter(t => t.active !== false).length} 位在职</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>姓名 / 手机号</th><th>所属门店</th><th>负责客户</th><th>状态</th><th>操作</th></tr></thead><tbody>${x.state.therapists.map(t => `<tr><td data-label="康复师"><strong>${x.esc(t.name)}</strong>${contact(t)}</td><td data-label="所属门店">${x.esc(x.name('stores', t.storeId))}</td><td data-label="负责客户">${x.state.clients.filter(c => c.ownerId === t.id).length} 位</td><td data-label="状态">${status(t)}</td><td data-label="操作"><div class="action-row">${x.action('编辑资料', 'edit-therapist', t.id, 'btn-small btn-outline')}${x.link('业绩明细', 'therapist-performance', t.id)}${t.active !== false ? x.action('停用', 'deactivate-therapist', t.id, 'btn-small btn-quiet') : ''}</div></td></tr>`).join('')}</tbody></table>${!x.state.therapists.length ? '<p class="empty">还没有康复师，请点击“新增康复师”。</p>' : ''}</div></section>
    <section class="section card"><div class="section-head"><div><h2>前台</h2><p class="muted">在授权门店建档、接待、预约和录入收款；排班只能申请调整。</p></div>${x.action('新增前台', 'add-frontdesk', '', 'btn-outline', 'plus')}</div><div class="line-list">${(x.state.frontDesks || []).map(person => staffRow(person, 'frontdesk')).join('') || '<p class="empty">还没有前台，请点击“新增前台”。</p>'}</div></section>
    <section class="section card"><div class="section-head"><div><h2>店长</h2><p class="muted">查看本店工作、建档和管理本店排班。人员管理、退款更正及私人评价由老板处理。</p></div>${x.action('新增店长', 'add-manager', '', 'btn-outline', 'plus')}</div><div class="line-list">${(x.state.storeManagers || []).map(person => staffRow(person, 'manager')).join('') || '<p class="empty">还没有店长，请点击“新增店长”。</p>'}</div></section>
    <section class="section"><div class="section-head"><div><h2>门店</h2><p class="muted">${x.state.stores.length} 家门店 · 新店也在这里统一管理</p></div>${x.action('新增门店', 'add-store', '', 'btn-outline', 'plus')}</div><div class="client-grid">${x.state.stores.map(s => `<article class="card person-card"><span class="eyebrow">${x.ico('map-pin', 18)} 服务门店</span><h2>${x.esc(s.name)}</h2><p class="muted">${x.esc(s.address || '地址待完善')}</p><div class="meta">${x.state.therapists.filter(t => t.storeId === s.id && t.active !== false).length} 位康复师 · ${s.active === false ? '已停用' : '营业中'}</div></article>`).join('')}</div></section>
    <section class="section card"><div class="section-head"><div><h2>旧档案迁入</h2><p class="muted">录入客户、负责人和期初剩余次数。历史已使用次数不自动计入新系统消费业绩。</p></div>${x.action('录入一位客户', 'import-opening', '', 'btn-outline', 'plus')}</div></section></div>`;
}

function assertPersonnelBoss(ctx) {
  if (ctx.role?.type !== 'boss' || ctx.role.id !== 'boss') throw new Error('人员资料和权限仅老板可以维护');
}

const personnelTypes = new Set(['add-therapist', 'add-frontdesk', 'add-manager', 'edit-therapist', 'edit-frontdesk', 'edit-manager']);

// Profile fields retain the same employee id; editing a name never reallocates
// historical services, receipts or appointments to a new person.
export function personnelDialog(type, id, ctx) {
  if (!personnelTypes.has(type)) return null;
  assertPersonnelBoss(ctx);
  const x = h(ctx), editing = type.startsWith('edit-'), kind = type.replace(/^(?:add|edit)-/, '');
  const collection = { therapist: 'therapists', frontdesk: 'frontDesks', manager: 'storeManagers' }[kind];
  const label = { therapist: '康复师', frontdesk: '前台', manager: '店长' }[kind];
  const person = editing ? x.find(collection, id) : null;
  if (editing && !person) throw new Error('该人员不存在，请返回人员管理查看最新资料');
  const bound = kind === 'frontdesk' ? person?.storeIds || [] : person?.storeId ? [person.storeId] : [];
  const stores = x.state.stores.filter(store => store.active !== false || bound.includes(store.id));
  const storeLabel = store => `${store.name}${store.active === false ? '（已停用·当前绑定）' : ''}`;
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${x.esc(value)}">`;
  const field = (label, name, value, extra = '', inputType = 'text') => `<label class="field"><span>${x.esc(label)}</span><input name="${name}" type="${inputType}" value="${x.esc(value || '')}" ${extra}></label>`;
  const text = (label, name, value, extra = '') => `<label class="field span-all"><span>${x.esc(label)}</span><textarea name="${name}" rows="3" ${extra}>${x.esc(value || '')}</textarea></label>`;
  const storeField = kind === 'frontdesk'
    ? `<fieldset class="field span-all"><legend>授权门店（至少选一家）</legend><div class="checkbox-grid">${stores.map(store => `<label class="check"><input type="checkbox" name="storeIds" value="${x.esc(store.id)}"${bound.includes(store.id) ? ' checked' : ''}><span>${x.esc(storeLabel(store))}</span></label>`).join('')}</div><span class="meta">前台只能接待和处理已授权门店的工作。</span></fieldset>`
    : `<label class="field"><span>${kind === 'manager' ? '负责门店' : '所属门店'}</span><select name="storeId" required><option value=""${person?.storeId ? '' : ' selected'}>请选择门店</option>${stores.map(store => `<option value="${x.esc(store.id)}"${person?.storeId === store.id ? ' selected' : ''}>${x.esc(storeLabel(store))}</option>`).join('')}</select></label>`;
  const permissions = {
    therapist: '查看本人负责或参与的客户，填写评估、登记实际服务和查看本人业绩。',
    frontdesk: '在授权门店建档、接待、安排预约及录入收款；可以查看排班、申请调整。退款和更正由老板处理。',
    manager: '负责一家门店，查看本店工作、建档、修改和审批本店排班。人员管理、退款更正和客户私人评价由老板处理。',
  }[kind];
  const statusField = editing
    ? `<label class="field"><span>人员状态</span><select name="active" required><option value="true"${person.active !== false ? ' selected' : ''}>使用中</option><option value="false"${person.active === false ? ' selected' : ''}>已停用</option></select><span class="meta">停用后不能再使用该身份；重新选择“使用中”可恢复。</span></label>`
    : hidden('active', 'true');
  const identityFields = editing ? `${hidden('id', person.id)}${hidden('expectedVersion', person.profileVersion ?? 0)}` : '';
  const historyHint = editing ? `<div class="note span-all"><strong>历史记录保留</strong><p>姓名和资料修改后仍是同一位人员，历史服务、业绩及收款归属保留。</p>${kind === 'therapist' ? '<p>换店或停用前需先处理负责客户、未完成预约与待办；换店还需先核对今日及以后的工作排班。</p>' : ''}</div>` : '';
  const title = `${editing ? '编辑' : '新增'}${label}${editing ? '资料' : ''}`;
  return { title, html: `<form data-form="${type}">${identityFields}<p class="muted">${editing ? '修改资料、门店或状态，填写原因后保存。' : '填写姓名、手机号和门店，确认岗位权限后添加。'}</p><p class="meta">公开预览请只填写虚构资料；正式登录与信息保存将在正式系统接入。</p><div class="form-grid">${field('姓名', 'name', person?.name, 'required maxlength="80" autocomplete="off"')}${field('手机号（可选）', 'phone', person?.phone, 'maxlength="11" pattern="1[3-9][0-9]{9}" inputmode="numeric" autocomplete="off" placeholder="11位手机号，可稍后补充"', 'tel')}${storeField}${statusField}${text('人员备注（可选）', 'notes', person?.notes, 'maxlength="500" placeholder="例如：专长、交接说明或其他人员资料"')}<div class="note span-all"><strong>${label}权限</strong><p>${x.esc(permissions)}</p><span class="meta">岗位权限由系统固定配置，无需逐项勾选。</span></div>${historyHint}${editing ? text('修改原因', 'reason', '', 'required maxlength="500" placeholder="说明这次资料、门店或状态的修改原因"') : ''}${!stores.length ? '<p class="notice span-all">暂无可分配的门店，请先新增门店。</p>' : ''}</div><div class="dialog-footer"><button class="btn btn-primary" type="submit"${!stores.length ? ' disabled' : ''}>${editing ? '保存人员资料' : `确认添加${label}`}</button>${x.action('返回', 'close-dialog', '', 'btn-quiet')}</div></form>` };
}

export function renderStaff(ctx) {
  if(ctx.role.type==='frontdesk')return renderReception(ctx);
  const x = h(ctx);
  if (x.role.type === 'boss') {
    if (ctx.view === 'clients') return clientList(ctx);
    if (ctx.view === 'performance') return performance(ctx);
    if (ctx.view === 'team') return team(ctx);
    return overview(ctx);
  }
  if (ctx.view === 'clients') return clientList(ctx);
  if (ctx.view === 'performance') return performance(ctx);
  return work(ctx);
}

export function staffDialog(type, id, ctx) {
  if (personnelTypes.has(type)) return personnelDialog(type, id, ctx);
  const TODAY = ctx.model.today || "2026-10-08";
  const x = h(ctx);
  const targetPackage = type === 'renew-package' ? x.find('packages', id) : null;
  const c = x.client(targetPackage?.clientId || id);
  const clients = x.clients;
  const active = x.state.therapists.filter(t => t.active !== false);
  const opts = (items, selected, empty = '') => `${empty ? `<option value="">${x.esc(empty)}</option>` : ''}${items.map(item => `<option value="${x.esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${x.esc(item.name)}</option>`).join('')}`;
  const select = (label, name, items, selected, extra = '') => `<label class="field"><span>${x.esc(label)}</span><select name="${name}" required ${extra}>${opts(items, selected)}</select></label>`;
  const input = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${x.esc(label)}</span><input name="${name}" type="${type}" value="${x.esc(value)}" ${extra}></label>`;
  const textarea = (label, name, value = '', extra = '') => `<label class="field span-all"><span>${x.esc(label)}</span><textarea name="${name}" rows="3" ${extra}>${x.esc(value)}</textarea></label>`;
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${x.esc(value)}">`;
  const submit = (label, blocked = false) => `<div class="dialog-footer"><button class="btn btn-primary" type="submit"${blocked ? ' disabled' : ''}>${x.esc(label)}</button>${x.action('返回', 'close-dialog', '', 'btn-quiet')}</div>`;
  const form = (name, body, label, blocked = false) => `<form data-form="${name}">${body}${submit(label, blocked)}</form>`;

  if (type === 'register' || type === 'register-appointment') {
    if (type === 'register' && !id) return {title: '选择登记客户', html: `<p class="muted">选择本次实际完成服务的客户，再填写服务记录。</p><div class="ease-register-clients">${clients.length ? clients.map(client => `<button type="button" class="ease-register-client" data-action="register" data-id="${x.esc(client.id)}"><span><strong>${x.esc(client.name)}</strong><span class="meta">负责人 ${x.esc(x.name('therapists', client.ownerId))} · ${x.esc(x.name('stores', client.storeId))}</span></span><span class="ease-register-balance">${x.esc(x.name('stores',client.storeId))}剩余 <strong>${remainingAtStore(ctx.model,client.id,client.storeId)}</strong> 次</span>${x.ico('chevron-right', 18)}</button>`).join('') : '<div class="empty">暂无可登记服务的客户。客户分配或实际参与服务后，会显示在这里。</div>'}</div>`};
    const ap = type === 'register-appointment' ? x.state.appointments.find(a => a.id === id && ['confirmed', 'reschedule_requested'].includes(a.status) && clients.some(c => c.id === a.clientId)) : null;
    if (type === 'register-appointment' && !ap) return {title: '按预约登记服务', html: '<div class="empty">该预约已处理或不在您的服务范围内，请返回后查看最新安排。</div>'};
    if (ap && ap.date > TODAY) return {title: '按预约登记服务', html: '<div class="empty">此预约日期尚未到，实际服务完成后再登记。</div>'};
    const selected = ap ? x.client(ap.clientId) : c || clients[0];
    if (!selected) return {title: '登记服务', html: '<div class="empty">暂无可登记服务的客户。</div>'};
    const todayAp = ap || x.appointments.find(a => a.clientId === selected.id && a.date === TODAY && ['confirmed','reschedule_requested'].includes(a.status));
    const serviceStoreId = ap?.storeId || todayAp?.storeId || selected.storeId;
    const choice = packageField(ctx, selected.id, serviceStoreId);
    const principal = (active.some(t=>t.id===ap?.principalId) && ap?.status !== 'pending_reassignment' ? ap.principalId : '') || (x.role.type === 'therapist' ? x.role.id : todayAp?.principalId || selected.ownerId);
    const fields = ap
      ? `${hidden('appointmentId', ap.id)}${hidden('storeId', ap.storeId)}${hidden('principalId', ap.principalId)}<div class="field"><span>服务门店 · 按预约</span><strong>${x.esc(x.name('stores', ap.storeId))}</strong></div><div class="field"><span>本次主康复师 · 按预约</span><strong>${x.esc(x.name('therapists', ap.principalId))}</strong></div>${input('服务日期 · 按预约', 'date', ap.date, 'date', 'readonly required')}${input('服务时间 · 按预约', 'time', ap.time, 'time', 'readonly required')}${input('服务项目 · 按预约', 'project', ap.project, 'text', 'readonly required')}`
      : `${select('服务门店', 'storeId', x.state.stores, todayAp?.storeId || selected.storeId)}${select('本次主康复师', 'principalId', active, principal)}${input('服务日期', 'date', TODAY, 'date', `required max="${TODAY}"`)}${input('服务时间', 'time', todayAp?.time || '11:30', 'time', 'required')}${input('服务项目', 'project', todayAp?.project || '基础训练与阶段复评', 'text', 'required maxlength="60"')}`;
    return {title: ap && ap.date < TODAY ? '补登记已完成的预约服务' : '登记已完成服务', html: form(type, `<div class="note ease-register-summary"><strong>${x.esc(selected.name)} · 核对本次服务</strong><p class="meta">负责人 ${x.esc(x.name('therapists', selected.ownerId))} · 先核对服务门店，再选择本次扣除的套餐。</p></div><p class="meta">${ap ? '已按预约填写，服务完成后再登记。' : '请填写实际已完成的服务；预约补登记请从服务安排进入。'} <span data-registration-photo-hint>还需添加至少 1 张留底照片，再确认登记。</span></p><div class="form-grid">${hidden('clientId', selected.id)}${fields}${choice.html}<details class="field span-all ease-register-collabs" ${(ap?.participantIds || []).length ? 'open' : ''}><summary><strong>协作人员（可选）</strong>${x.ico('chevron-right', 18)}</summary><fieldset class="field"><legend>其他参与康复师（可多选）</legend><div class="checkbox-grid">${active.map(t => `<label class="check"><input type="checkbox" name="participantIds" value="${x.esc(t.id)}" ${(ap?.participantIds || []).includes(t.id) ? 'checked' : ''}><span>${x.esc(t.name)} <small>${x.esc(x.name('stores', t.storeId))}</small></span></label>`).join('')}</div><span class="meta">协作保留参与记录，业绩归主康复师。</span></fieldset></details>${textarea('本次服务小结', 'notes', '', 'required placeholder="用客户看得懂的话，记录本次评估、训练内容与下一步；客户也能查看"')}<fieldset class="field span-all evidence-field" data-evidence-section><legend>消课留底照片 <small>必填 · 1–3 张</small></legend><p class="meta" id="evidence-help">先征得客户同意，拍摄本次服务场景或训练记录，不要求拍摄正脸。</p><p class="evidence-demo-note">预览请用测试照片；刷新或重置后清除。</p><p class="evidence-error" id="evidence-error" data-evidence-error role="alert" hidden></p><div class="evidence-pick-actions">${x.action('拍照', 'evidence-pick', 'camera', 'btn-outline')}${x.action('从相册选择', 'evidence-pick', 'album', 'btn-outline')}</div><input type="file" data-evidence-picker="camera" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><input type="file" data-evidence-picker="album" accept="image/jpeg,image/png,image/webp" multiple hidden><p class="evidence-status meta" data-evidence-status role="status" aria-live="polite"></p><div class="evidence-grid" data-evidence-list></div></fieldset></div><p class="meta">登记人：${x.esc(x.role.type === 'boss' ? '老板' : x.name('therapists', x.role.id))}</p>`, '确认登记 · 使用 1 次', !choice.selected)};
  }

  if (type === 'renew-package') {
    if (x.role.type !== 'boss' || x.role.id !== 'boss' || !c) return null;
    const storeId = targetPackage?.storeId || c.storeId;
    const choice = packageField(ctx, c.id, storeId, targetPackage?.id || c.packageId, true);
    const pkg = choice.rows.find(pack => pack.id === choice.selected);
    return {title: `为${c.name}续接套餐`, html: form('renew-package', `${hidden('clientId', c.id)}<div class="note"><strong>${x.esc(c.name)} · 按门店续接已耗尽的套餐</strong><p>新套餐沿用所选旧套餐的所属门店，其他店的次数和历史服务各自保留。</p></div><p class="muted">只登记套餐，不收款，不生成消费业绩。每次实际服务登记时，才扣次数并产生消费业绩。</p><div class="form-grid">${select('续费门店', 'storeId', x.state.stores, storeId)}${choice.html}${input('新套餐名称', 'name', pkg?.name || '运动功能恢复套餐', 'text', 'required maxlength="60"')}${input('套餐金额（元）', 'amount', pkg?.amount || 3000, 'number', 'required min="0.01" step="0.01"')}${input('套餐总次数', 'total', pkg?.total || 10, 'number', 'required min="1" max="999" step="1"')}${textarea('核对依据与续接说明', 'reason', '', 'required maxlength="500" placeholder="说明已确认的套餐安排、核对依据和接续原因"')}</div>`, '确认登记后续套餐', !choice.selected)};
  }

  if (type === 'edit-plan') {
    if (!c) return null;
    return {title: `更新${c.name}的康复计划`, html: form('edit-plan', `${hidden('clientId', c.id)}<p class="muted">用客户能理解的语言说明目标、当前进展和下一步。套餐次数不能代替康复进展。</p><div class="form-grid">${input('康复目标', 'goal', c.goal, 'text', 'required maxlength="80"')}${input('当前阶段', 'phase', c.phase, 'text', 'required maxlength="60"')}${textarea('计划安排', 'planNotes', c.planNotes, 'required')}${textarea('下一步', 'nextStep', c.nextStep, 'required')}${textarea('本次评估后的进展说明', 'progressSummary', c.progress?.summary || '', 'placeholder="没有完成评估时可留空，客户会看到待更新状态"')}${textarea('居家建议', 'homeAdvice', c.homeAdvice || '', 'required placeholder="只填写本次评估后适用于该客户的建议"')}<div class="span-all"><h3>安排一个下一步任务（可选）</h3></div>${input('待办事项', 'taskTitle', '', 'text', 'maxlength="80"')}${select('负责人', 'assigneeId', active, c.ownerId)}${input('计划日期', 'dueDate', '2026-10-10', 'date')}</div>`, '保存计划并更新客户页面')};
  }

  if (type === 'appointment-create' || type === 'appointment-edit') {
    const ap = type === 'appointment-edit' ? x.find('appointments', id) : null;
    const selected = ap?.clientId || c?.id || clients[0]?.id;
    if (!clients.length) return {title: '安排服务', html: '<div class="empty">暂无可安排服务的客户。</div>'};
    const stores=x.role.type==='frontdesk'?receptionStores(ctx):x.state.stores;
    const firstVisit=c?.createdRole && !x.state.services.some(row=>row.clientId===c.id&&row.status==='valid') && !(x.state.assessments||[]).some(row=>row.clientId===c.id&&row.status==='confirmed');
    return {title: ap ? '调整服务安排' : '安排下一次服务', html: form(type, `${ap ? hidden('id', ap.id) : ''}<p class="muted">预约仅安排时间，不扣套餐次数。实际服务完成后再登记。</p><div class="form-grid">${ap ? `${hidden('clientId', selected)}<div class="field"><span>客户</span><strong>${x.esc(x.client(selected)?.name)}</strong></div>` : select('客户', 'clientId', clients, selected)}${select('服务门店', 'storeId', stores, ap?.storeId || (stores.some(s=>s.id===c?.storeId)?c.storeId:stores[0]?.id))}${select('主康复师', 'principalId', active, (active.some(t=>t.id===ap?.principalId) && ap?.status !== 'pending_reassignment' ? ap.principalId : '') || (x.role.type === 'therapist' ? x.role.id : c?.ownerId || active[0]?.id))}${input('服务项目', 'project', ap?.project || (firstVisit?'首次评估':'阶段复评与训练'), 'text', 'required maxlength="60"')}${input('日期', 'date', ap?.request?.date || (ap?.date >= TODAY ? ap.date : TODAY), 'date', `required min="${TODAY}"`)}${hourTimeField(ap?.request?.time || ap?.time || '10:00', x.esc)}</div><div class="note">系统会检查康复师同一时间的服务冲突。</div>`, ap ? '保存新的安排' : '确认安排')};
  }

  if (type === 'followup') {
    if (x.role.type !== 'boss' || x.role.id !== 'boss') throw new Error('仅老板有权限查看和处理客户反馈');
    const r = ctx.model.reviewRows(x.role).find(row => row.id === id);
    if (!r) return null;
    const s = x.find('services', r.serviceId);
    return {title: '记录客户回访', html: form('followup', `${hidden('reviewId', id)}<div class="note"><strong>${x.esc(x.client(s?.clientId || r.clientId)?.name || '客户')} · ${x.esc(r.score || r.rating)} 分</strong><p>${x.esc(r.feedback || r.comment || r.text || '客户希望老板联系。')}</p></div><div class="form-grid"><div class="field"><span>处理人</span><strong>老板</strong></div>${textarea('沟通情况与后续安排', 'result', r.resolution || '', 'required maxlength="1000" placeholder="记录已了解的问题、和客户确认的安排及跟进时间"')}</div>`, '保存回访结果')};
  }

  if (type === 'add-store') {
    return {title: '新增门店', html: form('add-store', `<p class="muted">新店使用同一套客户档案，服务记录会标记实际服务门店。</p><div class="form-grid">${input('门店名称', 'name', '', 'text', 'required maxlength="30" placeholder="例如：C店 · 市北"')}${textarea('门店地址', 'address', '', 'required maxlength="120"')}</div>`, '新增门店')};
  }

  if (type === 'transfer-client') {
    if (!c) return null;
    return {title: `转交${c.name}的负责人`, html: form('transfer-client', `${hidden('clientId', c.id)}<div class="note">当前负责人：${x.esc(x.name('therapists', c.ownerId))}。转交后历史服务和业绩仍保留原归属。</div><div class="form-grid">${select('新的负责康复师', 'ownerId', active, c.ownerId)}${textarea('转交说明', 'reason', '', 'required placeholder="说明转交原因和需要接续的事项"')}</div>`, '确认转交')};
  }

  if (type === 'import-opening') {
    return {title: '录入一位旧客户', html: form('import-opening', `<div class="legacy-warning"><strong>公开演示：禁止填写真实客户资料。</strong><p>只用虚构资料体验。金额、总次数或余额不清楚时先核对，不填猜测值。</p></div><p class="muted">只录期初余额，不追记历史服务、消费业绩或实收；刷新恢复示例。</p><div class="form-grid">${input('客户姓名', 'name', '', 'text', 'required maxlength="80"')}${input('手机号', 'phone', '', 'tel', 'required maxlength="20"')}${select('所属门店', 'storeId', [{id:'',name:'请选择门店'},...x.state.stores], '')}${select('负责康复师', 'ownerId', [{id:'',name:'请选择负责康复师'},...active], '')}${input('套餐名称', 'packageName', '', 'text', 'required maxlength="80"')}${input('套餐金额（元）', 'amount', '', 'number', 'required min="0.01" max="1000000" step="0.01"')}${input('套餐总次数', 'total', '', 'number', 'required min="1" max="999" step="1"')}${input('期初剩余次数', 'openingRemaining', '', 'number', 'required min="0" max="999" step="1"')}${textarea('已核对的原档案说明', 'notes', '', 'required maxlength="4000" placeholder="虚构说明：例如原档编号、核对日期与余次"')}</div><div class="note">手机号重复或家庭共用电话请先人工核对，不自动合并。</div>`, '确认核对并录入虚构客户')};
  }

  if (type === 'revoke-service') {
    const s = x.find('services', id);
    if (!s) return null;
    return {title: '撤销错误的服务登记', html: form('revoke-service', `${hidden('id', id)}<div class="note"><strong>${x.esc(x.client(s.clientId)?.name)} · ${x.esc(s.project)}</strong><p>${x.date(s.date)} · ${x.esc(x.name('stores', s.storeId))} · ${x.esc(x.name('therapists', s.principalId))}</p><p>撤销后恢复本笔服务所用套餐的 1 次，并冲回 ${x.money(s.amount)} 消费业绩。原记录保留，协作记录同时标记撤销。</p></div>${textarea('撤销原因', 'reason', '', 'required maxlength="500" placeholder="请说明登记错误的具体原因"')}`, '确认撤销并恢复次数')};
  }
  return null;
}
