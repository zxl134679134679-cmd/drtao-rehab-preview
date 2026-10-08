import { DemoModel, TODAY } from './core.js';
import { renderStaff, staffDialog } from './staff.js';

let model = new DemoModel();
let role = {type: 'customer', id: 'c1'};
let view = 'home';
let filters = {storeId: '', therapistId: '', from: '', to: '', query: ''};
const drafts = new Map();
const preferences = new Map();
let dialogContext = null;
let focusBeforeDialog = null;
let toastTimer;
let nextRequest = 0;
const $ = selector => document.querySelector(selector);
const main = $('#app-main');
const sheet = $('#sheet');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const find = (kind, id) => model.state[kind].find(row => row.id === id);
const name = (kind, id) => id === 'boss' ? '老板' : find(kind, id)?.name || '待安排';
const icon = (name, size = 20, extra = '') => `<img class="icon ${extra}" src="assets/icons/${name}.svg" width="${size}" height="${size}" alt="" aria-hidden="true">`;
const money = amount => `¥${Number(amount || 0).toLocaleString('zh-CN', {maximumFractionDigits: 2})}`;
const date = value => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : '待安排';
const weekday = value => ['周日','周一','周二','周三','周四','周五','周六'][new Date(`${value}T00:00:00+08:00`).getDay()];
const button = (label, action, id = '', style = 'btn-outline', ico = '') => `<button type="button" class="btn ${style}" data-action="${action}" data-id="${esc(id)}">${esc(label)}${ico ? icon(ico, 18) : ''}</button>`;
const link = (label, action, id = '') => button(label, action, id, 'text-link', 'chevron-right');
const hidden = (key, value) => `<input type="hidden" name="${key}" value="${esc(value)}">`;
const field = (label, key, value = '', type = 'text', attrs = '') => `<label class="field"><span>${label}</span><input type="${type}" name="${key}" value="${esc(value)}" ${attrs}></label>`;
const textarea = (label, key, value = '', attrs = '') => `<label class="field span-all"><span>${label}</span><textarea name="${key}" rows="3" ${attrs}>${esc(value)}</textarea></label>`;
const form = (type, html, submit) => `<form data-form="${type}">${html}<p class="form-error" role="alert" hidden></p><div class="dialog-footer">${button('稍后再填写', 'close-dialog', '', 'btn-quiet')}<button type="submit" class="btn btn-primary">${submit}</button></div></form>`;
const pair = (label, value) => `<div class="detail-pair"><span class="muted">${label}</span><strong class="detail-value">${esc(value)}</strong></div>`;
const ctx = () => ({model, role, view, filters, esc, icon, fmt: {money, date}, ui: {}});
const clientServices = id => model.serviceRows({clientId: id});
const appointments = id => model.state.appointments.filter(a => a.clientId === id && a.date >= TODAY && ['confirmed','reschedule_requested'].includes(a.status)).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
const reviewFor = id => model.state.reviews.find(r => r.serviceId === id);
const currentClient = () => find('clients', role.id);
const canEditPlan = client => role.type === 'boss' || (role.type === 'therapist' && client.ownerId === role.id);
function assertClient(id) {
  if (!model.canSeeClient(role, id)) throw new Error('您没有查看该客户档案的权限');
  return find('clients', id);
}
function assertBoss() { if (role.type !== 'boss') throw new Error('此操作仅老板可使用'); }
function assertStaff() { if (!['boss','therapist'].includes(role.type)) throw new Error('此操作仅工作人员可使用'); }
function assertService(id) {
  const s = find('services', id);
  if (!s) throw new Error('服务记录不存在');
  // Staff can audit their own historical service without regaining client access.
  const ownHistory = role.type === 'therapist' && (s.principalId === role.id || s.participantIds.includes(role.id));
  if (!model.canSeeClient(role, s.clientId) && !ownHistory) throw new Error('您没有查看本次服务的权限');
  return s;
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500);
}

function roleOptions() {
  $('#role-select').innerHTML = `<optgroup label="客户端">${model.state.clients.map(c => `<option value="customer:${c.id}">${esc(c.name)} · 客户</option>`).join('')}</optgroup><optgroup label="康复师端">${model.state.therapists.filter(t => t.active).map(t => `<option value="therapist:${t.id}">${esc(t.name)} · ${esc(name('stores', t.storeId))}</option>`).join('')}</optgroup><optgroup label="管理端"><option value="boss:boss">老板 · 所有门店</option></optgroup>`;
  $('#role-select').value = `${role.type}:${role.id}`;
}
function switchRole(value, targetView) {
  closeDialog();
  const [type, id] = value.split(':');
  if (type === 'customer' && !find('clients', id)) return;
  if (type === 'therapist' && !find('therapists', id)?.active) return;
  if (type === 'boss' && id !== 'boss') return;
  role = {type, id};
  if (window.matchMedia('(max-width: 760px)').matches) $('.preview-controls').open = false;
  view = targetView || (type === 'customer' ? 'home' : type === 'boss' ? 'overview' : 'work');
  filters = {storeId: '', therapistId: '', from: '', to: '', query: ''};
  if (type === 'boss') { filters.from = TODAY; filters.to = TODAY; }
  render(true);
}
function navigation() {
  const items = role.type === 'customer' ? [['home','我的康复','home'],['records','服务记录','clipboard-text'],['profile','我的','user']] : role.type === 'therapist' ? [['work','工作台','home'],['clients','客户','users'],['performance','业绩','chart-bar']] : [['overview','概览','chart-bar'],['clients','客户','users'],['performance','业绩','clipboard-text'],['team','门店与人员','building-store']];
  return items.map(([key,label,ico]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-action="nav" data-id="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon(ico === 'home' && view === key ? 'home-filled' : ico,25)}<span class="nav-label">${label}</span></button>`).join('');
}
function render(resetScroll = false) {
  roleOptions();
  const customer = role.type === 'customer';
  $('#app-window').className = `app-window ${customer ? 'customer-mode' : 'staff-mode'}`;
  const label = customer ? name('clients', role.id) : role.type === 'boss' ? '老板管理' : `${name('therapists', role.id)} · 康复师`;
  $('#app-header').innerHTML = `<div class="app-brand"><img class="brand-logo" src="assets/brand-logo.png" alt="涛博士 Dr.Tao 运动康复" width="146" height="56"></div><div class="customer-head"><span class="header-name">${esc(label)}</span>${customer ? `<button class="capsule" data-action="mini-info" aria-label="小程序预览说明">${icon('dots',20)}<span></span>${icon('circle-dot',20)}</button>` : '<span class="tag tag-green">工作端</span>'}</div>`;
  main.innerHTML = customer ? view === 'records' ? customerRecords() : view === 'profile' ? customerProfile() : customerHome() : renderStaff(ctx());
  $('#bottom-nav').innerHTML = navigation();
  if (resetScroll) main.scrollTop = 0;
}

function customerHome() {
  const c = currentClient(), p = find('packages', c.packageId);
  const remaining = model.remaining(c.id), next = appointments(c.id)[0];
  const recent = clientServices(c.id).find(s => s.status === 'valid');
  return `<div class="ease-customer-home"><section class="hero"><p class="hero-label">我的康复计划</p><h1 class="hero-title">${esc(c.goal)}</h1><div class="hero-facts"><div class="fact-line">${icon('clipboard-text',20)}<span>当前阶段</span><strong>${esc(c.phase)}</strong></div><div class="fact-line">${icon('user',20)}<span>负责康复师</span><strong>${esc(name('therapists',c.ownerId))}</strong></div></div><div class="next-step">${icon('arrow-right',20)}<p>下一步：${esc(c.nextStep)}</p></div>${button('查看完整计划','plan',c.id,'hero-button btn-lime','chevron-right')}</section>
  <div class="customer-surface"><section class="detail-section ease-usage-section"><button class="ease-usage" data-action="package" data-id="${c.id}"><span><span class="ease-usage-label">套餐剩余 <span class="tag">各店通用</span></span><span class="ease-usage-total">已用 ${p.total - remaining} / 共 ${p.total} 次</span></span><span class="ease-usage-value"><strong>${remaining}</strong> 次${icon('chevron-right',18)}</span></button>${remaining <= 2 ? `<div class="ease-balance-note"><p>${remaining === 0 ? '当前套餐已用完，请与负责康复师确认阶段评估和后续安排。' : '剩余次数不多，建议与负责康复师确认阶段复评和后续安排。'}</p>${next ? link('查看服务团队','nav','profile') : ''}</div>` : ''}</section>
  <section class="detail-section ease-next"><div class="ease-section-head"><h2>${icon('calendar',21)}下一次服务</h2>${next ? link('查看安排','appointment',next.id) : ''}</div>${next ? `<div class="service-date">${date(next.date)} ${weekday(next.date)} · ${esc(next.time)}</div><h3 class="service-project">${esc(next.project)}</h3><p class="service-meta">服务康复师 <strong>${esc(name('therapists',next.principalId))}</strong><span>门店 <strong>${esc(name('stores',next.storeId))}</strong></span></p>${next.status === 'reschedule_requested' ? `<p class="ease-request-note">申请改至 ${date(next.request?.date)} ${esc(next.request?.time || '')}，待工作人员确认。原预约仍保留。</p>` : ''}<div class="ease-inline-actions">${button(next.status === 'reschedule_requested' ? '修改改约申请' : '申请改约','reschedule',next.id,'btn-outline','calendar')}${button('查看门店','stores',c.id,'btn-quiet','map-pin')}</div>` : `<div class="ease-empty"><p>下一次服务尚未安排</p><span>请与负责康复师确认，安排后会显示在这里。</span><div class="ease-inline-actions">${button('查看服务团队','nav','profile','btn-outline')}${button('反馈与帮助','help',c.id,'btn-quiet')}</div></div>`}</section>
  <section class="detail-section"><button class="section-trigger progress-row" data-action="progress" data-id="${c.id}"><span class="section-label">${icon('chart-bar',22)}<strong>康复进展</strong></span><span class="muted">${c.progress.status === 'updated' ? '查看阶段评估' : '待评估更新'}</span>${icon('chevron-right',20)}</button></section>
  <section class="detail-section ease-recent"><div class="ease-section-head"><h2>${icon('clock',21)}最近完成</h2>${link('全部记录','nav','records')}</div>${recent ? `<h3>${date(recent.date)} · ${esc(recent.project)}</h3><p class="meta">${esc(name('therapists',recent.principalId))} · ${esc(name('stores',recent.storeId))} · 使用 ${recent.sessions} 次</p><div class="ease-inline-actions">${button(reviewFor(recent.id) ? `${reviewFor(recent.id).score} 分 · 查看评价` : '评价本次服务','review',recent.id,reviewFor(recent.id) ? 'btn-outline' : 'btn-primary','star')}${button('服务明细','service-detail',recent.id,'btn-quiet')}</div>` : '<p class="ease-empty">完成服务后，您可以在这里查看记录并评价。</p>'}</section></div></div>`;
}
function customerRecords() {
  const services = clientServices(role.id), valid = services.filter(s => s.status === 'valid');
  const unrated = valid.filter(s => !reviewFor(s.id));
  return `<div class="customer-page ease-customer-page"><div class="page-head"><div><span class="eyebrow">每一次服务，都有记录</span><h1>服务记录</h1><p class="muted">已完成 ${valid.length} 次${unrated.length ? ` · ${unrated.length} 次待评价` : ''}</p></div></div>${unrated.length ? `<div class="ease-review-prompt"><span>分享您的真实体验，帮助我们改进服务。</span>${button('去评价','review',unrated[0].id,'btn-primary')}</div>` : ''}<div class="ease-record-list">${services.length ? services.map(s => `<article class="ease-record-card"><div class="ease-section-head"><span class="ease-record-date">${date(s.date)} · ${esc(s.time)}</span><span class="tag ${s.status === 'valid' ? 'tag-green' : 'tag-warn'}">${s.status === 'valid' ? '已完成' : '已撤销'}</span></div><h2>${esc(s.project)}</h2><p class="meta">${esc(name('therapists',s.principalId))} · ${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? `使用 ${s.sessions} 次` : '次数已恢复'}</p><details class="ease-record-note"><summary>本次服务小结</summary><p>${esc(s.notes)}</p></details><div class="ease-inline-actions">${button('服务明细','service-detail',s.id,'btn-outline')}${s.status === 'valid' ? button(reviewFor(s.id) ? '查看我的评价' : '评价本次服务','review',s.id,reviewFor(s.id) ? 'btn-quiet' : 'btn-primary','star') : ''}</div></article>`).join('') : '<div class="empty card">还没有服务记录，完成服务后会显示在这里。</div>'}</div><div class="ease-page-links">${link('套餐使用明细','package',role.id)}${link('预约记录','appointment-history',role.id)}</div></div>`;
}
function customerProfile() {
  const c = currentClient(), pref = preferences.get(c.id) || false;
  const menu = (label,action,ico) => `<button class="ease-menu-item" data-action="${action}" data-id="${c.id}">${icon(ico,21)}<span>${label}</span>${icon('chevron-right',18)}</button>`;
  return `<div class="customer-page ease-customer-page"><div class="profile-card"><div class="profile-avatar">${icon('user',30)}</div><div><h1>${esc(c.name)}</h1><p class="muted">${esc(c.phone.slice(0,3))}****${esc(c.phone.slice(-4))}</p></div></div><section class="ease-team"><h2>我的服务团队</h2><div class="ease-team-info"><span>负责康复师 <strong>${esc(name('therapists',c.ownerId))}</strong></span><span>所属门店 <strong>${esc(name('stores',c.storeId))}</strong></span></div>${link('查看门店信息','stores',c.id)}</section><div class="ease-profile-menu">${menu('我的套餐与剩余次数','package','stack')}${menu('我的预约记录','appointment-history','calendar')}<details class="ease-home-advice"><summary>${icon('clipboard-text',21)}<span>居家指导</span>${icon('chevron-right',18)}</summary><div><p>${esc(c.homeAdvice)}</p>${link('查看完整计划','plan',c.id)}</div></details>${menu('反馈与帮助','help','bell')}${menu('我的档案与隐私','privacy','shield-check')}</div><details class="ease-reminder"><summary>服务提醒设置</summary><label class="check"><input type="checkbox" data-preference="reminder" ${pref ? 'checked' : ''}><span>希望收到服务提醒</span></label><p class="meta">预览中只保存此页面的偏好。正式提醒需您授权后启用。</p></details><p class="ease-brand-caption">涛博士 · 让每一次康复都有清晰的安排</p></div>`;
}

function planDialog(id) {
  const c = assertClient(id);
  const tasks = model.state.tasks.filter(t => t.clientId === id && ['plan','assessment','review','reschedule'].includes(t.type));
  return {title: '我的完整康复计划', html: `<span class="eyebrow">计划第 ${c.planVersion} 版</span><h3>${esc(c.goal)}</h3><p>${esc(c.planNotes)}</p><div class="detail-grid">${pair('当前阶段',c.phase)}${pair('负责康复师',name('therapists',c.ownerId))}</div><div class="note"><strong>下一步</strong><p>${esc(c.nextStep)}</p></div><h3>具体安排</h3><div class="plan-timeline">${tasks.length ? tasks.map(t => `<div class="timeline-item"><span class="timeline-dot ${t.status === 'completed' ? 'completed' : ''}"></span><div><strong>${esc(t.title)}</strong><p class="meta">${esc(name('therapists',t.assigneeId))} · 计划 ${date(t.dueDate)} · ${t.status === 'completed' ? '已完成' : '待完成'}</p></div></div>`).join('') : '<p class="muted">具体安排将由您的负责康复师补充。</p>'}</div><h3>居家指导</h3><p>${esc(c.homeAdvice)}</p><p class="meta">计划会根据阶段评估调整；套餐使用次数与康复进展分别记录。</p><div class="action-row">${link('查看康复进展','progress',id)}${link('计划更新记录','plan-history',id)}${canEditPlan(c) ? button('更新计划','edit-plan',id,'btn-primary') : ''}</div>`};
}
function progressDialog(id) {
  const c = assertClient(id);
  return {title: '康复进展', html: `<div class="note"><strong>${c.progress.status === 'updated' ? '本阶段评估' : '等待首次阶段记录'}</strong><p>${esc(c.progress.summary)}</p></div>${c.progressUpdatedAt ? `<p class="meta">更新日期 ${date(c.progressUpdatedAt)} · 负责康复师 ${esc(name('therapists',c.ownerId))}</p>` : '<p class="muted">完成评估后，您的康复师会记录实际变化和下一步建议。</p>'}${c.progress.metrics.length ? `<div class="detail-grid">${c.progress.metrics.map(m => pair(m.label || m.name, m.value ?? `${m.before ?? "—"} → ${m.after ?? "—"} ${m.unit || ""}`)).join('')}</div>` : ''}<h3>当前安排</h3><p>${esc(c.phase)}</p><p>${esc(c.nextStep)}</p><p class="notice">套餐次数反映服务使用情况，康复进展以康复师评估记录为依据。</p>${canEditPlan(c) ? button('补充评估与计划','edit-plan',id,'btn-primary') : ''}`};
}
function packageRecord(pack) {
  const balance = model.packageRemaining(pack.id);
  const rows = clientServices(pack.clientId).filter(s => s.packageId === pack.id);
  return `<h3>${esc(pack.name)}</h3><div class="detail-grid">${pair('套餐金额',money(pack.amount))}${pair('套餐总次数',`${pack.total} 次`)}${pair('剩余次数',`${balance} 次`)}${pair('已使用',`${pack.total - balance} 次`)}</div><h3>次数变动记录</h3>${pack.openingUsed ? `<div class="row"><div><strong>期初纸质档案余额</strong><p class="meta">已核对迁入 ${pack.openingUsed} 次历史使用</p></div><span>−${pack.openingUsed} 次</span></div>` : ''}${rows.length ? rows.map(s => `<div class="row"><div><strong>${date(s.date)} · ${esc(s.project)}</strong><p class="meta">${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? '已完成' : '已撤销，恢复原套餐 1 次'}</p></div>${link(s.status === 'valid' ? '−1 次' : '已冲回','service-detail',s.id)}</div>`).join('') : '<p class="muted">此套餐暂无新增服务记录。</p>'}`;
}
function packageDialog(id) {
  const c = assertClient(id);
  const p = find('packages',c.packageId);
  const remaining = model.remaining(id);
  const histories = model.state.packages.filter(pack => pack.clientId === id && pack.id !== p.id);
  return {title:'套餐使用明细',html:`<span class="tag tag-green">当前使用 · 各店通用</span>${packageRecord(p)}${remaining === 0 ? `<div class="notice"><strong>当前套餐次数已用完</strong><p>请与负责康复师确认阶段复评和接下来的安排。</p>${role.type === 'boss' ? button('续接新套餐','renew-package',id,'btn-primary') : ''}</div>` : remaining <= 2 ? '<p class="notice">剩余次数较少，可结合阶段复评确认接下来的服务。</p>' : ''}<h3>历史套餐</h3>${histories.map(pack => `<div class="row"><div class="row-main"><strong>${esc(pack.name)}</strong><p class="meta">共 ${pack.total} 次 · 剩余 ${model.packageRemaining(pack.id)} 次</p></div>${link('查看历史明细','package-history',pack.id)}</div>`).join('') || '<p class="muted">暂无历史套餐。</p>'}<p class="meta">每笔服务使用的套餐单独留存，撤销会恢复原套餐的次数。</p>`};
}
function packageHistoryDialog(id) {
  const p = find('packages',id);
  if (!p) throw new Error('套餐不存在');
  const c = assertClient(p.clientId);
  const historical = c.packageId !== id;
  const balance = model.packageRemaining(id);
  return {title:historical ? '历史套餐明细' : '套餐记录',html:`<span class="tag ${historical ? '' : 'tag-green'}">${historical ? '历史套餐' : '当前套餐'}</span>${packageRecord(p)}${historical && balance > 0 ? `<div class="notice"><strong>本套餐仍有 ${balance} 次</strong><p>恢复的次数保留在本套餐，由老板核对后选择继续使用。</p>${role.type === 'boss' ? button('切换使用本套餐','activate-package',p.id,'btn-primary') : ''}</div>` : ''}${button('查看客户当前套餐','package',c.id,'btn-outline')}`};
}
function appointmentHistoryDialog(id) {
  assertClient(id);
  const rows = model.state.appointments.filter(a => a.clientId === id).sort((a,b)=>`${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const labels = {confirmed:'已确认',reschedule_requested:'改约待确认',completed:'已服务',cancelled:'已取消',no_show:'未到店'};
  return {title:'预约记录',html:`<p class="muted">预约与实际服务分别记录；完成服务并登记后，才更新套餐次数和消费业绩。</p>${rows.map(a=>{
    const pending = ['confirmed','reschedule_requested'].includes(a.status);
    const status = pending && a.date < TODAY ? '到店情况待确认' : labels[a.status] || '待确认';
    const staff = role.type !== 'customer';
    return `<article class="record-item"><div class="section-head"><h3>${date(a.date)} · ${esc(a.time)}</h3><span class="tag ${a.status === 'completed' ? 'tag-green' : a.status === 'no_show' || (pending && a.date < TODAY) ? 'tag-warn' : ''}">${status}</span></div><p>${esc(a.project)}</p><p class="meta">${esc(name('therapists',a.principalId))} · ${esc(name('stores',a.storeId))}</p>${a.status === 'reschedule_requested' ? `<div class="note"><strong>客户申请改至 ${date(a.request?.date)} ${esc(a.request?.time || '')}</strong><p>改约说明：${esc(a.requestNote || '未填写说明')}</p></div>` : ''}${a.status === 'no_show' ? `<p>未到店说明：${esc(a.noShowReason)}</p><p class="meta">本次未扣次数，未产生消费业绩。</p>` : a.status === 'cancelled' ? `<p>取消说明：${esc(a.cancelReason)}</p><p class="meta">本次未扣次数。</p>` : ''}<div class="action-row">${a.status === 'completed' && a.serviceId ? link('查看对应服务','service-detail',a.serviceId) : ''}${pending && staff && a.date <= TODAY ? button('按预约登记服务','register-appointment',a.id,'btn-primary') : ''}${pending && staff && a.date <= TODAY && (role.type === 'boss' || role.id === a.principalId) ? button('记录未到店','appointment-no-show',a.id,'btn-outline') : ''}${pending && staff ? `${link('调整安排','appointment-edit',a.id)}${link('取消预约','appointment-cancel',a.id)}` : pending && role.type === 'customer' && a.date >= TODAY ? button(a.status === 'reschedule_requested' ? '修改改约申请' : '申请改约','reschedule',a.id,'btn-outline') : ''}</div></article>`;
  }).join('') || '<div class="empty">还没有预约记录。</div>'}`};
}

function serviceDialog(id) {
  const s = assertService(id);
  const r = reviewFor(id);
  const canOpenClient = model.canSeeClient(role, s.clientId);
  return {title: '服务明细', html: `<span class="tag ${s.status === 'valid' ? 'tag-green' : 'tag-warn'}">${s.status === 'valid' ? '已完成' : '已撤销'}</span><h3>${esc(s.project)}</h3><div class="detail-grid">${pair('客户',name('clients',s.clientId))}${pair('服务日期',`${date(s.date)} ${s.time}`)}${pair('服务门店',name('stores',s.storeId))}${pair('本次主康复师',name('therapists',s.principalId))}${pair('参与康复师',s.participantIds.map(t => name('therapists',t)).join('、') || '独立服务')}${pair('登记时客户负责人',name('therapists',s.ownerId))}${pair('登记人',name('therapists',s.recordedBy))}${pair('使用套餐',find('packages',s.packageId)?.name || '原套餐')}${pair('套餐次数',s.status === 'valid' ? `使用 ${s.sessions} 次` : '已恢复原套餐 1 次')}${role.type !== 'customer' ? pair('消费业绩',s.status === 'valid' ? `${money(s.amount)}，归${name('therapists',s.principalId)}` : `${money(s.amount)} 已冲回`) : ''}</div><h3>这次为您做了什么</h3><p>${esc(s.notes)}</p>${s.status === 'revoked' ? `<div class="note"><strong>撤销说明</strong><p>${esc(s.revokeReason)}</p><p class="meta">处理人 ${esc(name('therapists',s.revokedBy))} · 原记录保留</p></div>` : ''}${r ? `<div class="note"><strong>客户评价 ${r.score} 分</strong><p>${esc(r.feedback || '未填写文字反馈')}</p><p class="meta">${r.followupStatus === 'closed' ? '已完成回访' : r.followupStatus === 'pending' ? '工作人员待跟进' : '已记录'}</p></div>` : ''}<div class="action-row">${role.type === 'customer' && s.status === 'valid' ? button(r ? '查看我的评价' : '评价本次服务','review',id,'btn-primary','star') : ''}${role.type !== 'customer' && canOpenClient ? button('打开客户档案','client-detail',s.clientId,'btn-outline') : ''}${role.type === 'boss' && s.status === 'valid' ? button('撤销错误登记','revoke-service',id,'btn-quiet') : ''}${role.type === 'boss' && r?.followupStatus === 'pending' ? button('记录回访','followup',r.id,'btn-primary') : ''}</div>`};
}
function clientDialog(id) {
  const c = assertClient(id);
  const next = appointments(id)[0];
  return {title: `${c.name}的客户档案`, html: `<div class="detail-grid">${pair('负责康复师',name('therapists',c.ownerId))}${pair('所属门店',name('stores',c.storeId))}${pair('手机号',c.phone)}${pair('剩余次数',`${model.remaining(id)} 次`)}</div>${c.openingNotes ? `<div class="note"><strong>期初核对依据</strong><p>${esc(c.openingNotes)}</p></div>` : ""}<h3>${esc(c.goal)}</h3><p>${esc(c.phase)} · ${esc(c.nextStep)}</p><div class="action-row">${button('完整计划','plan',id,'btn-outline')}${button('套餐次数','package',id,'btn-outline')}${button('预约记录','appointment-history',id,'btn-outline')}${role.type === 'boss' && model.remaining(id) === 0 ? button('续接新套餐','renew-package',id,'btn-primary') : ''}${canEditPlan(c) ? button('更新计划','edit-plan',id,'btn-outline') : ''}</div><h3>下一次服务</h3>${next ? `<p>${date(next.date)} ${next.time} · ${esc(next.project)}</p><p class="meta">${esc(name('therapists',next.principalId))} · ${esc(name('stores',next.storeId))}</p><div class="action-row">${button('改约','appointment-edit',next.id)}${button('取消预约','appointment-cancel',next.id,'btn-quiet')}</div>` : '<p class="muted">暂无待服务安排</p>'}<div class="action-row">${button('登记已完成服务','register',id,'btn-primary','plus')}${button('安排下次服务','appointment-create',id,'btn-outline','calendar')}</div><h3>服务历史</h3>${clientServices(id).map(s => `<div class="row"><div><strong>${date(s.date)} · ${esc(s.project)}</strong><p class="meta">${esc(name('therapists',s.principalId))} · ${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? '已完成' : '已撤销'}</p></div>${link('明细','service-detail',s.id)}</div>`).join('') || '<p class="muted">暂无新增服务记录</p>'}${role.type === 'boss' ? `<div class="action-row">${link('转交负责人','transfer-client',id)}${link('操作留痕','client-audit',id)}</div>` : ''}`};
}
function appointmentDialog(id) {
  const c = currentClient();
  const a = id ? find('appointments',id) : appointments(c.id)[0];
  if (!a) return {title: '下一次服务', html: `<p>暂无预约安排。</p><p class="muted">下次服务的时间、康复师与门店确认后会显示在首页。</p>${button('查看门店信息','stores',c.id)}`};
  assertClient(a.clientId);
  const store = find('stores',a.storeId);
  return {title: '下一次服务安排', html: `<h3>${date(a.date)} ${weekday(a.date)} · ${esc(a.time)}</h3><p>${esc(a.project)}</p><div class="detail-grid">${pair('服务康复师',name('therapists',a.principalId))}${pair('服务门店',store.name)}</div><p class="muted">${esc(store.address)}</p><p class="notice">按当前服务安排到店，完成服务后才扣套餐次数。</p>${a.status === 'reschedule_requested' ? `<div class="note"><strong>改约申请待确认</strong><p>希望调整到 ${date(a.request.date)} ${a.request.time}</p><p>${esc(a.request.reason)}</p><p class="meta">工作人员确认前，原预约时间仍保留。</p></div>` : ''}<div class="action-row">${button(a.status === 'reschedule_requested' ? '修改改约申请' : '申请调整时间','reschedule',a.id,'btn-primary','calendar')}${button('查看门店信息','stores',a.clientId)}</div>`};
}
function reviewDialog(id) {
  const s = assertService(id);
  if (role.type !== 'customer' || role.id !== s.clientId) throw new Error('只有客户本人可以填写评价');
  const r = reviewFor(id);
  if (r) return {title: '我的服务评价', html: `<div class="review-score"><strong>${r.score}</strong><span> / 5 分</span></div><p>${esc(r.feedback || '您没有填写文字反馈。')}</p><p class="meta">${date(s.date)} · ${esc(s.project)} · ${esc(name('therapists',s.principalId))}</p>${r.followupStatus === 'pending' ? '<div class="notice">您的反馈已进入待跟进列表，工作人员将在后续服务中与您沟通。</div>' : r.followupStatus === 'closed' ? `<div class="note"><strong>已完成回访</strong><p>${esc(r.resolution)}</p></div>` : '<p class="notice">感谢您的反馈，我们会持续完善每次服务。</p>'}`};
  if (s.status !== 'valid') throw new Error('已撤销的服务不能评价');
  return {title: '这次服务体验怎么样？', html: form('review', `${hidden('serviceId',id)}<p class="muted">${date(s.date)} · ${esc(s.project)} · ${esc(name('therapists',s.principalId))}</p><fieldset class="field"><legend>请为本次服务评分</legend><div class="star-picker">${[1,2,3,4,5].map(n => `<label class="star-option"><input type="radio" name="score" value="${n}" required aria-label="${n} 分">${icon('star',30)}<span>${n} 分</span></label>`).join('')}</div></fieldset>${textarea('您的反馈（可选）','feedback','','maxlength="1000" placeholder="哪里帮助到了您？还有什么需要改进？"')}<label class="check"><input type="checkbox" name="wantContact"><span>希望工作人员联系我，进一步了解情况</span></label><p class="meta">您的真实反馈会帮助我们改进后续服务。</p>`,'提交评价')};
}
function requestDialog(id) {
  const a = find('appointments',id);
  if (!a || role.type !== 'customer' || a.clientId !== role.id) throw new Error('您没有调整该预约的权限');
  return {title: '申请调整服务时间', html: form('reschedule', `${hidden('appointmentId',id)}<div class="note">当前预约：${date(a.date)} ${a.time} · ${esc(name('stores',a.storeId))}</div><div class="form-grid">${field('希望调整到的日期','date',a.request?.date || a.date,'date',`required min="${TODAY}"`)}${field('开始时间','time',a.request?.time || a.time,'time','required')}${textarea('改约说明','reason',a.request?.reason || '','required maxlength="500" placeholder="请说明您的时间安排"')}</div><p class="meta">工作人员确认前，原预约仍保留。申请本身不会扣除次数。</p>`,'提交改约申请')};
}
function auditDialog(id, plansOnly = false) {
  assertClient(id);
  if (!plansOnly) assertBoss();
  const rows = model.state.audit.filter(a => a.clientId === id && (!plansOnly || a.type === 'plan_published'));
  const titles = {service_registered:'服务登记',service_revoked:'服务撤销',plan_published:'计划更新',appointment_saved:'预约安排',appointment_cancelled:'取消预约',reschedule_requested:'客户改约申请',task_completed:'待办完成',review_submitted:'服务评价',review_followup_closed:'回访完成',client_transferred:'负责人转交',opening_import:'纸质期初档案录入',package_renewed:'套餐续接',package_activated:'切换使用套餐',appointment_no_show:'未到店记录'};
  return {title: plansOnly ? '计划更新记录' : '客户操作留痕', html: rows.length ? rows.map(a => `<div class="record-item"><strong>${titles[a.type] || '档案更新'}</strong><p class="meta">${esc(name('therapists',a.actorId) === '待安排' ? name('clients',a.actorId) : name('therapists',a.actorId))} · ${esc(new Date(a.createdAt).toLocaleString('zh-CN'))}</p>${a.type === 'plan_published' ? `<p>第 ${a.after.planVersion} 版 · ${esc(a.after.phase)}</p><p>${esc(a.after.nextStep)}</p>` : `<p>${esc(a.reason || a.resolution || a.sourceNotes || a.notes || a.note || '变更已保存')}</p>`}</div>`).join('') : '<p class="empty">当前示例还没有更新记录。</p>'};
}
function storesDialog(id) {
  assertClient(id);
  return {title: '门店与服务安排', html: `<p class="muted">套餐各店通用，请按预约中的实际服务门店到店。</p>${model.state.stores.map(store => `<div class="record-item"><h3>${esc(store.name)}</h3><p>${esc(store.address)}</p><p class="meta">${model.state.therapists.filter(t => t.active && t.storeId === store.id).map(t => esc(t.name)).join('、') || '人员待安排'}</p></div>`).join('')}<p class="notice">以上地址为虚构示例，正式版会接入真实门店地址与导航。</p>`};
}
function tourDialog() {
  return {title: '试一遍完整服务流程', html: `<p>建议先用许安然的 3,000 元 / 10 次套餐体验，初始剩余 10 次。</p><div class="plan-timeline"><div class="timeline-item"><span class="timeline-dot"></span><div><h3>1. 看客户首页</h3><p class="muted">查看计划、负责康复师和剩余次数。</p>${button('以许安然身份查看','tour-customer','','btn-outline')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>2. 登记一次跨店服务</h3><p class="muted">以周亦宁登记，在 A店服务，选择两位协作人员，填写服务小结。剩余次数变为 9。</p>${button('打开服务登记','tour-register','','btn-primary')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>3. 核对业绩与明细</h3><p class="muted">主康复师增加 300 元，协作人员保留参与记录；全店业绩只增加 300 元。</p>${button('查看老板概览','tour-boss','','btn-outline')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>4. 体验评价和撤销</h3><p class="muted">切回客户填写评价；老板可在服务明细填写原因后撤销，次数和业绩同步恢复。</p>${button('查看客户服务记录','tour-records','','btn-outline')}</div></div></div>`};
}

const staffTypes = new Set(['register','edit-plan','appointment-create','appointment-edit','followup','add-store','add-therapist','transfer-client','import-opening','revoke-service','register-appointment','renew-package']);
function buildDialog(type, id) {
  if (staffTypes.has(type)) {
    assertStaff();
    if (['followup','add-store','add-therapist','transfer-client','import-opening','revoke-service','renew-package'].includes(type)) assertBoss();
    if (['edit-plan','transfer-client','renew-package'].includes(type) || (type === 'register' && id)) assertClient(id);
    if (type === 'appointment-create' && id) assertClient(id);
    if (['appointment-edit','register-appointment'].includes(type)) assertClient(find('appointments',id)?.clientId);
    if (type === 'revoke-service') assertService(id);
    if (type === 'edit-plan' && !canEditPlan(assertClient(id))) throw new Error('请由负责康复师或老板更新计划');
    const content = staffDialog(type,id,ctx());
    if (type === 'edit-plan' && content && find('clients',id).progress.status === 'pending') content.html = content.html.replace(/(<textarea name="progressSummary"[^>]*>)[\s\S]*?(<\/textarea>)/, '$1$2');
    return content;
  }
  if (type === 'plan') return planDialog(id);
  if (type === 'progress') return progressDialog(id);
  if (type === 'package') return packageDialog(id);
  if (type === 'package-history') return packageHistoryDialog(id);
  if (type === 'appointment-history') return appointmentHistoryDialog(id);
  if (type === 'activate-package') {
    assertBoss(); const p = find('packages',id); if (!p) throw new Error('套餐不存在'); assertClient(p.clientId);
    return {title:'切换当前使用套餐',html:form('activate-package',`${hidden('packageId',id)}<div class="note"><strong>${esc(p.name)} · 剩余 ${model.packageRemaining(id)} 次</strong><p>此套餐将作为当前使用套餐。其他套餐的余额和历史消费记录各自保留。</p></div>${textarea('切换原因','reason','','required maxlength="500" placeholder="例如：旧服务撤销后，确认先使用原套餐恢复的次数"')}`,'确认切换使用套餐')};
  }
  if (type === 'appointment-no-show') {
    assertStaff(); const a = find('appointments',id); if (!a) throw new Error('预约不存在'); assertClient(a.clientId);
    return {title:'记录未到店',html:form('appointment-no-show',`${hidden('id',id)}<div class="note"><strong>${esc(name('clients',a.clientId))} · ${date(a.date)} ${a.time}</strong><p>${esc(a.project)} · ${esc(name('stores',a.storeId))}</p><p>请确认客户确实未到店。此操作不扣套餐次数、不产生消费业绩。</p></div>${textarea('未到店说明','reason','','required maxlength="500" placeholder="记录已核实的情况及后续联系安排"')}`,'确认未到店')};
  }
  if (type === 'service-detail') return serviceDialog(id);
  if (type === 'client-detail') { assertStaff(); return clientDialog(id); }
  if (type === 'appointment') return appointmentDialog(id);
  if (type === 'review') return reviewDialog(id);
  if (type === 'reschedule') return requestDialog(id);
  if (type === 'plan-history') return auditDialog(id,true);
  if (type === 'client-audit') return auditDialog(id);
  if (type === 'stores') return storesDialog(id);
  if (type === 'tour') return tourDialog();
  if (type === 'appointment-cancel') {
    assertStaff();
    const a = find('appointments',id); assertClient(a?.clientId);
    return {title:'取消预约',html:form('appointment-cancel',`${hidden('id',id)}<p>${esc(name('clients',a.clientId))} · ${date(a.date)} ${a.time}</p>${textarea('取消说明','reason','','required maxlength="500"')}`,'确认取消预约')};
  }
  if (type === 'privacy') {
    assertClient(id);
    return {title:'我的档案与隐私',html:'<p>客户端查看本人的计划、套餐与服务记录。康复师查看自己负责或实际参与服务的客户，老板统一管理各店记录。</p><p class="muted">本次预览使用虚构数据，角色切换仅用于体验。正式版本需要真实身份验证和服务器权限校验。</p>'};
  }
  if (type === 'help') {
    assertClient(id);
    const last = clientServices(id).find(s => s.status === 'valid');
    return {title:'反馈与帮助',html:`<h3>您的负责康复师：${esc(name('therapists',find('clients',id).ownerId))}</h3><p>调整到店时间，可在下一次服务中申请改约。对已完成服务有建议，可填写评价并勾选“希望工作人员联系我”。</p><div class="action-row">${role.type === 'customer' ? button('查看预约','appointment',appointments(id)[0]?.id || '','btn-outline') : ''}${last && role.type === 'customer' ? button('反馈最近一次服务','review',last.id,'btn-primary') : ''}</div><p class="muted">正式版本会补充真实客服电话和微信联系入口。</p>`};
  }
  if (type === 'mini-info') return {title:'小程序页面预览',html:'<p>这是可点击的微信页面原型，您可以先体验流程。微信登录、门店导航、订阅消息将在确认原型后接入。</p>'};
  if (type === 'reset') return {title:'重置示例数据',html:form('reset','<p>将恢复初始的两家门店、五名康复师和虚构客户。本次预览中新增的记录与草稿会清除。</p>','恢复初始示例')};
  if (type === 'deactivate-therapist') {
    assertBoss();
    return {title:'停用康复师',html:form('deactivate-therapist',`${hidden('id',id)}<p>停用 ${esc(name('therapists',id))} 前，需要先转交负责客户、处理预约和待办。历史服务归属保留。</p>`,'检查并停用')};
  }
  return null;
}
function draftKey(type,id) { return `${role.type}:${role.id}:${type}:${id}`; }
function saveDraft() {
  if (!dialogContext || !sheet.open) return;
  const el = $('#sheet-body form');
  if (!el || el.dataset.succeeded) return;
  const entries = [...new FormData(el).entries()];
  drafts.set(dialogContext.key,{entries,requestId:dialogContext.requestId});
}
function restoreDraft(saved) {
  if (!saved) return;
  const f = $('#sheet-body form');
  if (!f) return;
  for (const el of f.elements) {
    if (!el.name) continue;
    // Appointment details come from the latest confirmed arrangement, never an old draft.
    if (dialogContext?.type === 'register-appointment' &&
        ['appointmentId','clientId','storeId','principalId','date','time','project'].includes(el.name)) continue;
    const vals = saved.entries.filter(([key]) => key === el.name).map(([,val]) => val);
    if (['checkbox','radio'].includes(el.type)) el.checked = vals.includes(el.value);
    else if (vals.length) el.value = vals[0];
  }
}
function openDialog(type,id = '') {
  const content = buildDialog(type,id);
  if (!content) throw new Error('当前没有可操作的内容');
  saveDraft();
  const key = draftKey(type,id);
  const saved = drafts.get(key);
  dialogContext = {type,id,key,requestId:saved?.requestId || `preview-${++nextRequest}`};
  $('#sheet-title').textContent = content.title;
  $('#sheet-body').innerHTML = content.html;
  $('.sheet-head .icon-button').innerHTML = icon('x',22);
  restoreDraft(saved);
  constrainStaffChoices(type,id);
  if (['register','register-appointment'].includes(type)) {
    updateParticipants();
    const collaborators = $('#sheet-body .ease-register-collabs');
    if (collaborators && collaborators.querySelector('input:checked')) collaborators.open = true;
  }
  if (!sheet.open) { focusBeforeDialog = document.activeElement; sheet.showModal(); }
  $('#sheet-body').scrollTop = 0;
  // Focus the dialog heading to avoid opening a mobile keyboard on read-only views.
  $('#sheet-title').tabIndex = -1;
  $('#sheet-title').focus();
}
function closeDialog(keepDraft = true) {
  if (keepDraft) saveDraft();
  if (sheet.open) sheet.close();
  dialogContext = null;
  if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus();
}
function showSuccess(title,html) {
  $('#sheet-title').textContent = title;
  $('#sheet-body').innerHTML = `<div class="success-icon">${icon('circle-check',40)}</div>${html}<div class="dialog-footer">${button('完成','close-dialog','','btn-primary')}</div>`;
  dialogContext = null;
  $('#sheet-title').focus();
}
function formError(f,message) {
  let error = f.querySelector('.form-error');
  if (!error) { error = document.createElement('p'); error.className = 'form-error'; error.setAttribute('role','alert'); f.querySelector('.dialog-footer')?.before(error); if (!error.isConnected) f.append(error); }
  error.hidden = false;
  error.textContent = message;
  error.scrollIntoView({block:'nearest'});
}

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id || '';
  try {
    if (action === 'close-dialog') return closeDialog();
    if (action === 'nav') {
      const allowed = role.type === 'customer' ? ['home','records','profile'] : role.type === 'boss' ? ['overview','clients','performance','team'] : ['work','clients','performance'];
      if (!allowed.includes(id)) throw new Error('该页面不可访问');
      closeDialog(); view = id; render(true); return;
    }
    if (action === 'reset-filters') { filters = {storeId:'',therapistId:'',from:'',to:'',query:''}; render(); return; }
    if (action === 'boss-period' || action === 'boss-reset') {
      assertBoss();
      if (action === 'boss-reset') filters = {storeId:'',therapistId:'',from:TODAY,to:TODAY,query:''};
      else if (id === 'today') filters = {...filters,from:TODAY,to:TODAY};
      else if (id === 'month') filters = {...filters,from:`${TODAY.slice(0,7)}-01`,to:TODAY};
      else if (id === 'all') filters = {...filters,from:'',to:''};
      else throw new Error('请选择有效的日期范围');
      render(); return;
    }
    if (action === 'therapist-performance') { assertBoss(); filters.therapistId = id; view = 'performance'; render(true); return; }
    if (action === 'task-complete') {
      assertStaff();
      const task = find('tasks',id);
      if (task?.type === 'service_note') {
        const appointment = find('appointments',task.appointmentId);
        if (!appointment) return openDialog('client-detail',task.clientId);
        return openDialog(['confirmed','reschedule_requested'].includes(appointment.status) && appointment.date <= TODAY ? 'register-appointment' : 'appointment-history',
          ['confirmed','reschedule_requested'].includes(appointment.status) && appointment.date <= TODAY ? appointment.id : task.clientId);
      }
      if (task?.type === 'reschedule') return openDialog('appointment-edit',task.appointmentId);
      if (task?.type === 'review_followup') return openDialog('followup',task.reviewId);
      model.completeTask(id,role); render(); toast('待办已完成，记录已保留'); return;
    }
    if (action === 'tour-customer') return switchRole('customer:c2');
    if (action === 'tour-register') { switchRole('therapist:t2'); openDialog('register','c2'); $('#sheet-body [name="storeId"]').value = 'a'; return; }
    if (action === 'tour-boss') return switchRole('boss:boss');
    if (action === 'tour-records') return switchRole('customer:c2','records');
    if (action === 'export-preview') return exportPreview();
    openDialog(action,id);
  } catch (error) { toast(error.message); }
});
document.addEventListener('change', event => {
  if (event.target.id === 'role-select') switchRole(event.target.value);
  if (event.target.hasAttribute('data-boss-store')) { assertBoss(); filters.storeId = event.target.value; render(); }
  if (event.target.dataset.preference === 'reminder' && role.type === 'customer') { preferences.set(role.id,event.target.checked); toast('已保存本次预览的提醒偏好'); }
  if (event.target.name === 'clientId' && ['appointment-create','appointment-edit'].includes($('#sheet-body form')?.dataset.form)) constrainStaffChoices($('#sheet-body form').dataset.form,event.target.value);
  if (event.target.name === 'principalId' && $('#sheet-body form')?.dataset.form === 'register') updateParticipants();
});
function updateParticipants() {
  const principal = $('#sheet-body [name="principalId"]')?.value;
  $('#sheet-body')?.querySelectorAll('[name="participantIds"]').forEach(el => {
    el.disabled = el.value === principal;
    if (el.disabled) el.checked = false;
  });
}
function constrainStaffChoices(type,id) {
  const f = $('#sheet-body form');
  if (!f || !['appointment-create','appointment-edit','edit-plan'].includes(type)) return;
  const clientId = f.querySelector('[name="clientId"]')?.value || id;
  const key = type === 'edit-plan' ? 'assigneeId' : 'principalId';
  const select = f.querySelector(`[name="${key}"]`);
  if (!select) return;
  const previous = select.value;
  const allowed = model.state.therapists.filter(t => t.active && model.canSeeClient({type:'therapist',id:t.id},clientId));
  select.innerHTML = allowed.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  select.value = allowed.some(t => t.id === previous) ? previous : find('clients',clientId)?.ownerId || allowed[0]?.id;
  if (!f.querySelector('.assignment-note')) {
    const note = document.createElement('p'); note.className='meta assignment-note';
    note.textContent='安排给负责或已实际参与服务的康复师；新人员接手时，请先由老板转交负责人。';
    f.querySelector('.dialog-footer').before(note);
  }
}
sheet.addEventListener('cancel', event => { event.preventDefault(); closeDialog(); });
sheet.addEventListener('click', event => { if (event.target === sheet) { const rect = sheet.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(); } });

document.addEventListener('submit', async event => {
  const f = event.target;
  if (!f.dataset.form) return;
  event.preventDefault();
  if (f.dataset.busy === 'true' || f.dataset.succeeded === 'true') return;
  if (!f.reportValidity()) return;
  const type = f.dataset.form;
  const fd = new FormData(f);
  const data = Object.fromEntries(fd);
  if (type === 'filters') {
    if (data.from && data.to && data.from > data.to) { toast('开始日期不能晚于结束日期'); return; }
    filters = {...filters,...data}; render(); return;
  }
  if (type === 'client-search') { filters.query = data.query; render(); return; }
  saveDraft();
  f.dataset.busy = 'true';
  const submittingRole = {...role};
  const context = dialogContext;
  const submits = [...f.querySelectorAll('button[type="submit"]')];
  submits.forEach(el => { el.disabled = true; el.dataset.original = el.textContent; el.textContent = '正在保存…'; });
  f.querySelector('.form-error')?.setAttribute('hidden','');
  try {
    // Brief feedback delay represents local prototype processing; no network call.
    await new Promise(resolve => setTimeout(resolve,160));
    if (role.type !== submittingRole.type || role.id !== submittingRole.id || context !== dialogContext) throw new Error('操作已取消，请重新打开页面后提交');
    if ($('#network-toggle').checked && type !== 'reset') {
      $('#network-toggle').checked = false;
      throw new Error('模拟提交失败：内容已保留，未扣次数，请重试。');
    }
    let result;
    if (type === 'register' || type === 'register-appointment') {
      result = model.registerService({...data,participantIds:fd.getAll('participantIds'),requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('本次服务已登记',`<h3>${esc(name('clients',result.clientId))} · ${esc(result.project)}</h3><div class="success-summary detail-grid">${pair('套餐剩余',`${model.remaining(result.clientId)} 次`)}${pair('消费业绩',`${money(result.amount)}，归${name('therapists',result.principalId)}`)}</div><p class="muted">协作人员只保留参与记录，本次仅扣 1 次。</p><div class="action-row">${button('查看服务明细','service-detail',result.id,'btn-outline')}${button('安排下一次服务','appointment-create',result.clientId,'btn-outline')}</div>`); return;
    }
    if (type === 'edit-plan') {
      const summary = String(data.progressSummary || '').trim();
      model.publishPlan(data.clientId,{...data,progress:summary ? {status:'updated',summary,metrics:find('clients',data.clientId).progress.metrics} : {status:'pending',summary:'待康复师完成评估后更新',metrics:[]}},role);
    } else if (['appointment-create','appointment-edit'].includes(type)) model.saveAppointment(data,role);
    else if (type === 'appointment-cancel') model.cancelAppointment(data.id,data.reason,role);
    else if (type === 'appointment-no-show') model.markNoShow(data.id,data.reason,role);
    else if (type === 'renew-package') {
      result = model.renewPackage({...data,requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('新套餐已续接',`<h3>${esc(name('clients',result.clientId))} · ${esc(result.name)}</h3><div class="detail-grid">${pair('可用次数',`${model.remaining(result.clientId)} 次`)}${pair('新套餐单次消费折算',money(model.unitValue(result.id)))}</div><p class="muted">旧套餐已保存到历史。消费业绩在后续实际服务登记时产生。</p>${button('查看套餐记录','package',result.clientId,'btn-outline')}`); return;
    } else if (type === 'activate-package') model.activatePackage(data.packageId,data.reason,role);
    else if (type === 'reschedule') model.requestReschedule(data.appointmentId,data,role);
    else if (type === 'review') {
      result = model.submitReview(data.serviceId,{...data,wantContact:fd.has('wantContact')},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('评价已提交',`<h3>感谢您的真实反馈</h3><p>${result.followupStatus === 'pending' ? '您的反馈已进入工作人员的待跟进列表。' : '您的反馈会帮助我们完善后续服务。'}</p>`); return;
    } else if (type === 'followup') model.closeFollowup(data.reviewId,data.result,role);
    else if (type === 'add-store') model.addStore(data,role);
    else if (type === 'add-therapist') model.addTherapist(data,role);
    else if (type === 'transfer-client') model.transferClient(data.clientId,data.ownerId,data.reason,role);
    else if (type === 'import-opening') model.importOpening(data,role);
    else if (type === 'deactivate-therapist') model.deactivateTherapist(data.id,role);
    else if (type === 'revoke-service') {
      result = model.revokeService(data.id,data.reason,role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('次数已恢复，业绩已冲回',`<div class="detail-grid">${pair('客户',name('clients',result.clientId))}${pair('恢复至原套餐',name('packages',result.packageId))}${pair('原套餐剩余',`${model.packageRemaining(result.packageId)} 次`)}${pair('当前套餐剩余',`${model.remaining(result.clientId)} 次`)}${pair('冲回消费业绩',money(result.amount))}${pair('主康复师',name('therapists',result.principalId))}</div><p class="muted">原服务记录与撤销原因已保留。</p>${button('查看原记录','service-detail',result.id,'btn-outline')}`); return;
    } else if (type === 'reset') {
      model = new DemoModel(); drafts.clear(); preferences.clear(); $('#network-toggle').checked = false;
      closeDialog(false); role = {type:'customer',id:'c1'}; view='home'; filters={storeId:'',therapistId:'',from:'',to:'',query:''}; render(true); toast('示例已重置'); return;
    } else throw new Error('此表单暂不可提交');
    drafts.delete(context.key); f.dataset.succeeded = 'true'; closeDialog(false); render();
    toast(({ 'edit-plan':'计划已保存，客户页面同步更新','appointment-create':'服务安排已确认','appointment-edit':'新的服务安排已确认','appointment-cancel':'预约已取消，未扣次数','appointment-no-show':'未到店已记录，未扣次数','activate-package':'当前使用套餐已切换，历史余额和业绩各自保留',reschedule:'改约申请已提交，等待工作人员确认',followup:'回访结果已保存','add-store':'新门店已加入，共用客户档案','add-therapist':'康复师已加入，可分配客户','transfer-client':'负责人已转交，历史业绩保留原归属','import-opening':'期初档案已录入，不产生新消费业绩','deactivate-therapist':'康复师已停用，历史记录保留' })[type] || '已保存');
  } catch (error) { if (f.isConnected) formError(f,error.message); else toast(error.message); }
  finally {
    f.dataset.busy = 'false';
    submits.forEach(el => { el.disabled = false; el.textContent = el.dataset.original; });
  }
});

function exportPreview() {
  const ids = new Set(model.visibleClients(role).map(c => c.id));
  const state = model.state;
  const data = role.type === 'boss' ? state : {
    clients:state.clients.filter(c => ids.has(c.id)),
    packages:state.packages.filter(p => ids.has(p.clientId)),
    services:state.services.filter(s => ids.has(s.clientId)).map(s => role.type === 'customer' ? {id:s.id,clientId:s.clientId,storeId:s.storeId,date:s.date,time:s.time,project:s.project,principalId:s.principalId,participantIds:s.participantIds,sessions:s.sessions,status:s.status,notes:s.notes,revokeReason:s.revokeReason} : s),
    appointments:state.appointments.filter(a => ids.has(a.clientId)),
    tasks:state.tasks.filter(t => ids.has(t.clientId) && (role.type === 'customer' ? ['plan','assessment','review','reschedule'].includes(t.type) : t.assigneeId === role.id)),
    reviews:state.reviews.filter(r => ids.has(r.clientId))
  };
  const blob = new Blob([JSON.stringify({说明:'虚构示例，非真实业务档案',身份:role,数据:data},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='涛博士-演示记录.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('已导出当前身份可见的演示记录');
}

// Collapse the controls on phones while retaining easy access to role switching.
if (window.matchMedia('(max-width: 700px)').matches) $('.preview-controls').open = false;
render();
