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
const appointments = id => model.state.appointments.filter(a => a.clientId === id && ['confirmed','reschedule_requested'].includes(a.status)).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
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
  const c = currentClient();
  const p = find('packages', c.packageId);
  const remaining = model.remaining(c.id);
  const next = appointments(c.id)[0];
  const recent = clientServices(c.id).find(s => s.status === 'valid');
  return `<section class="hero"><p class="hero-label">我的康复计划</p><h1 class="hero-title">${esc(c.goal)}</h1><div class="hero-facts"><div class="fact-line">${icon('clipboard-text',20)}<span>当前阶段</span><strong>${esc(c.phase)}</strong></div><div class="fact-line">${icon('user',20)}<span>负责康复师</span><strong>${esc(name('therapists',c.ownerId))}</strong></div></div><div class="next-step">${icon('arrow-right',20)}<p>下一步：${esc(c.nextStep)}</p></div>${button('查看完整计划','plan',c.id,'hero-button btn-lime','chevron-right')}</section>
  <div class="customer-surface"><section class="detail-section"><button class="section-trigger progress-row" data-action="progress" data-id="${c.id}"><span class="section-label">${icon('chart-bar',22)}<strong>康复进展</strong></span><span class="muted">${c.progress.status === 'updated' ? '查看阶段评估' : '待康复师更新'}</span>${icon('chevron-right',20)}</button></section>
  <section class="detail-section usage-row"><button class="usage-label" data-action="package" data-id="${c.id}"><span class="section-label">${icon('stack',22)}<strong>套餐次数</strong></span><span class="tag">各店通用</span></button><div class="usage-numbers"><div><span class="muted">剩余</span><div><strong class="remaining-number">${remaining}</strong><span> 次</span></div></div><div class="usage-small"><p>已用 <strong>${p.total - remaining}</strong> 次</p><p>共 ${p.total} 次</p></div></div></section>
  <section class="detail-section"><button class="section-trigger" data-action="appointment" data-id="${next?.id || ''}"><span class="section-label">${icon('calendar',22)}<strong>下一次服务</strong></span>${icon('chevron-right',20)}</button>${next ? `<div class="service-date">${date(next.date)} ${weekday(next.date)} · ${esc(next.time)}</div><h3 class="service-project">${esc(next.project)}</h3><p class="service-meta">服务康复师 <strong>${esc(name('therapists',next.principalId))}</strong><span>门店 <strong>${esc(name('stores',next.storeId))}</strong></span></p>${next.status === 'reschedule_requested' ? '<p class="notice">改约申请待确认，原预约仍保留。</p>' : ''}` : `<div class="empty">暂无预约，下一次安排确认后会显示在这里。</div>`}</section>
  <section class="detail-section"><button class="section-trigger" data-action="nav" data-id="records"><span class="section-label">${icon('clock',22)}<strong>最近完成</strong></span>${icon('chevron-right',20)}</button>${recent ? `<div class="recent-row"><div><button class="text-link record-top" data-action="service-detail" data-id="${recent.id}">${date(recent.date)} ${weekday(recent.date)} · ${esc(recent.project)}</button><p class="meta">${esc(name('therapists',recent.principalId))} · ${esc(name('stores',recent.storeId))} · 使用 ${recent.sessions} 次</p></div><button class="rating-link" data-action="review" data-id="${recent.id}">${icon('star',25)}<span>${reviewFor(recent.id) ? `${reviewFor(recent.id).score} 分 · 已评价` : '评价本次服务'}</span></button></div>` : '<div class="empty">服务完成后，您可以查看记录并评价体验。</div>'}</section></div>`;
}
function customerRecords() {
  const services = clientServices(role.id);
  return `<div class="customer-page"><div class="page-head"><div><span class="eyebrow">每一次服务，都有记录</span><h1>服务记录</h1><p class="muted">看清做了什么、谁为您服务，以及次数的变化。</p></div></div>${services.length ? services.map(s => `<article class="record-item"><div class="section-head"><h2>${date(s.date)} · ${esc(s.project)}</h2><span class="tag ${s.status === 'valid' ? 'tag-green' : 'tag-warn'}">${s.status === 'valid' ? '已完成' : '已撤销'}</span></div><p class="meta">${esc(name('therapists',s.principalId))} · ${esc(name('stores',s.storeId))} · ${s.time}</p><p>${esc(s.notes)}</p><div class="action-row">${link('查看服务明细','service-detail',s.id)}${s.status === 'valid' ? link(reviewFor(s.id) ? '查看我的评价' : '评价本次服务','review',s.id) : '<span class="muted">已恢复套餐次数</span>'}</div></article>`).join('') : '<div class="empty card">还没有服务记录。完成服务后会显示在这里。</div>'}${button('查看套餐使用明细','package',role.id,'btn-outline','stack')}</div>`;
}
function customerProfile() {
  const c = currentClient();
  const pref = preferences.get(c.id) || false;
  return `<div class="customer-page"><div class="profile-card"><div class="profile-avatar">${icon('user',34)}</div><h1>${esc(c.name)}</h1><p class="muted">${esc(c.phone.slice(0,3))}****${esc(c.phone.slice(-4))}</p></div><section class="card section"><h2>您的服务团队</h2><div class="detail-grid">${pair('负责康复师',name('therapists',c.ownerId))}${pair('所属门店',name('stores',c.storeId))}</div>${link('查看门店与服务安排','stores',c.id)}</section><section class="card section"><h2>居家指导</h2><p>${esc(c.homeAdvice)}</p>${link('查看完整计划','plan',c.id)}</section><section class="card section"><h2>提醒与帮助</h2><label class="check"><input type="checkbox" data-preference="reminder" ${pref ? 'checked' : ''}><span>希望收到服务提醒</span></label><p class="meta">预览中只保存此页面的偏好。正式提醒需您授权后启用。</p><div class="line-list">${link('反馈与帮助','help',c.id)}${link('我的档案与隐私','privacy',c.id)}</div></section><p class="brand-caption">涛博士 · 让每一次康复都有清晰的安排</p></div>`;
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
function packageDialog(id) {
  const c = assertClient(id);
  const p = find('packages',c.packageId);
  const remaining = model.remaining(id);
  const services = clientServices(id).filter(s => s.packageId === p.id);
  return {title: '套餐使用明细', html: `<h3>${esc(p.name)}</h3><div class="detail-grid">${pair('剩余次数',`${remaining} 次`)}${pair('套餐总次数',`${p.total} 次`)}${pair('已使用',`${p.total - remaining} 次`)}${pair('使用范围','各门店通用')}</div>${remaining <= 2 ? '<p class="notice">剩余次数较少，负责康复师可以结合阶段复评，为您安排接下来的服务。</p>' : ''}<h3>次数变动记录</h3>${p.openingUsed ? `<div class="row"><div><strong>期初纸质档案余额</strong><p class="meta">已核对迁入 ${p.openingUsed} 次历史使用</p></div><span>−${p.openingUsed} 次</span></div>` : ''}${services.length ? services.map(s => `<div class="row"><div><strong>${date(s.date)} · ${esc(s.project)}</strong><p class="meta">${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? '已完成' : '已撤销，恢复 1 次'}</p></div>${link(s.status === 'valid' ? '−1 次' : '已冲回','service-detail',s.id)}</div>`).join('') : '<p class="muted">此套餐暂无新增服务记录。</p>'}<h3>历史套餐</h3>${model.state.packages.filter(pack => pack.clientId === id && pack.status === 'historical').map(pack => `<div class="row"><div><strong>${esc(pack.name)}</strong><p class="meta">共 ${pack.total} 次 · 已结束</p></div></div>`).join('') || '<p class="muted">暂无历史套餐。</p>'}`};
}
function serviceDialog(id) {
  const s = assertService(id);
  const r = reviewFor(id);
  const canOpenClient = model.canSeeClient(role, s.clientId);
  return {title: '服务明细', html: `<span class="tag ${s.status === 'valid' ? 'tag-green' : 'tag-warn'}">${s.status === 'valid' ? '已完成' : '已撤销'}</span><h3>${esc(s.project)}</h3><div class="detail-grid">${pair('客户',name('clients',s.clientId))}${pair('服务日期',`${date(s.date)} ${s.time}`)}${pair('服务门店',name('stores',s.storeId))}${pair('本次主康复师',name('therapists',s.principalId))}${pair('参与康复师',s.participantIds.map(t => name('therapists',t)).join('、') || '独立服务')}${pair('登记时客户负责人',name('therapists',s.ownerId))}${pair('登记人',name('therapists',s.recordedBy))}${pair('套餐次数',s.status === 'valid' ? `使用 ${s.sessions} 次` : '已恢复 1 次')}${role.type !== 'customer' ? pair('消费业绩',s.status === 'valid' ? `${money(s.amount)}，归${name('therapists',s.principalId)}` : `${money(s.amount)} 已冲回`) : ''}</div><h3>这次为您做了什么</h3><p>${esc(s.notes)}</p>${s.status === 'revoked' ? `<div class="note"><strong>撤销说明</strong><p>${esc(s.revokeReason)}</p><p class="meta">处理人 ${esc(name('therapists',s.revokedBy))} · 原记录保留</p></div>` : ''}${r ? `<div class="note"><strong>客户评价 ${r.score} 分</strong><p>${esc(r.feedback || '未填写文字反馈')}</p><p class="meta">${r.followupStatus === 'closed' ? '已完成回访' : r.followupStatus === 'pending' ? '工作人员待跟进' : '已记录'}</p></div>` : ''}<div class="action-row">${role.type === 'customer' && s.status === 'valid' ? button(r ? '查看我的评价' : '评价本次服务','review',id,'btn-primary','star') : ''}${role.type !== 'customer' && canOpenClient ? button('打开客户档案','client-detail',s.clientId,'btn-outline') : ''}${role.type === 'boss' && s.status === 'valid' ? button('撤销错误登记','revoke-service',id,'btn-quiet') : ''}${role.type === 'boss' && r?.followupStatus === 'pending' ? button('记录回访','followup',r.id,'btn-primary') : ''}</div>`};
}
function clientDialog(id) {
  const c = assertClient(id);
  const next = appointments(id)[0];
  return {title: `${c.name}的客户档案`, html: `<div class="detail-grid">${pair('负责康复师',name('therapists',c.ownerId))}${pair('所属门店',name('stores',c.storeId))}${pair('手机号',c.phone)}${pair('剩余次数',`${model.remaining(id)} 次`)}</div>${c.openingNotes ? `<div class="note"><strong>期初核对依据</strong><p>${esc(c.openingNotes)}</p></div>` : ""}<h3>${esc(c.goal)}</h3><p>${esc(c.phase)} · ${esc(c.nextStep)}</p><div class="action-row">${button('完整计划','plan',id,'btn-outline')}${button('套餐次数','package',id,'btn-outline')}${canEditPlan(c) ? button('更新计划','edit-plan',id,'btn-outline') : ''}</div><h3>下一次服务</h3>${next ? `<p>${date(next.date)} ${next.time} · ${esc(next.project)}</p><p class="meta">${esc(name('therapists',next.principalId))} · ${esc(name('stores',next.storeId))}</p><div class="action-row">${button('改约','appointment-edit',next.id)}${button('取消预约','appointment-cancel',next.id,'btn-quiet')}</div>` : '<p class="muted">暂无待服务安排</p>'}<div class="action-row">${button('登记已完成服务','register',id,'btn-primary','plus')}${button('安排下次服务','appointment-create',id,'btn-outline','calendar')}</div><h3>服务历史</h3>${clientServices(id).map(s => `<div class="row"><div><strong>${date(s.date)} · ${esc(s.project)}</strong><p class="meta">${esc(name('therapists',s.principalId))} · ${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? '已完成' : '已撤销'}</p></div>${link('明细','service-detail',s.id)}</div>`).join('') || '<p class="muted">暂无新增服务记录</p>'}${role.type === 'boss' ? `<div class="action-row">${link('转交负责人','transfer-client',id)}${link('操作留痕','client-audit',id)}</div>` : ''}`};
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
  const titles = {service_registered:'服务登记',service_revoked:'服务撤销',plan_published:'计划更新',appointment_saved:'预约安排',appointment_cancelled:'取消预约',reschedule_requested:'客户改约申请',task_completed:'待办完成',review_submitted:'服务评价',review_followup_closed:'回访完成',client_transferred:'负责人转交',opening_import:'纸质期初档案录入'};
  return {title: plansOnly ? '计划更新记录' : '客户操作留痕', html: rows.length ? rows.map(a => `<div class="record-item"><strong>${titles[a.type] || '档案更新'}</strong><p class="meta">${esc(name('therapists',a.actorId) === '待安排' ? name('clients',a.actorId) : name('therapists',a.actorId))} · ${esc(new Date(a.createdAt).toLocaleString('zh-CN'))}</p>${a.type === 'plan_published' ? `<p>第 ${a.after.planVersion} 版 · ${esc(a.after.phase)}</p><p>${esc(a.after.nextStep)}</p>` : `<p>${esc(a.reason || a.resolution || a.sourceNotes || a.notes || a.note || '变更已保存')}</p>`}</div>`).join('') : '<p class="empty">当前示例还没有更新记录。</p>'};
}
function storesDialog(id) {
  assertClient(id);
  return {title: '门店与服务安排', html: `<p class="muted">套餐各店通用，请按预约中的实际服务门店到店。</p>${model.state.stores.map(store => `<div class="record-item"><h3>${esc(store.name)}</h3><p>${esc(store.address)}</p><p class="meta">${model.state.therapists.filter(t => t.active && t.storeId === store.id).map(t => esc(t.name)).join('、') || '人员待安排'}</p></div>`).join('')}<p class="notice">以上地址为虚构示例，正式版会接入真实门店地址与导航。</p>`};
}
function tourDialog() {
  return {title: '试一遍完整服务流程', html: `<p>建议先用许安然的 3,000 元 / 10 次套餐体验，初始剩余 10 次。</p><div class="plan-timeline"><div class="timeline-item"><span class="timeline-dot"></span><div><h3>1. 看客户首页</h3><p class="muted">查看计划、负责康复师和剩余次数。</p>${button('以许安然身份查看','tour-customer','','btn-outline')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>2. 登记一次跨店服务</h3><p class="muted">以周亦宁登记，在 A店服务，选择两位协作人员，填写服务小结。剩余次数变为 9。</p>${button('打开服务登记','tour-register','','btn-primary')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>3. 核对业绩与明细</h3><p class="muted">主康复师增加 300 元，协作人员保留参与记录；全店业绩只增加 300 元。</p>${button('查看老板概览','tour-boss','','btn-outline')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>4. 体验评价和撤销</h3><p class="muted">切回客户填写评价；老板可在服务明细填写原因后撤销，次数和业绩同步恢复。</p>${button('查看客户服务记录','tour-records','','btn-outline')}</div></div></div>`};
}

const staffTypes = new Set(['register','edit-plan','appointment-create','appointment-edit','followup','add-store','add-therapist','transfer-client','import-opening','revoke-service']);
function buildDialog(type, id) {
  if (staffTypes.has(type)) {
    assertStaff();
    if (['followup','add-store','add-therapist','transfer-client','import-opening','revoke-service'].includes(type)) assertBoss();
    if (['register','edit-plan','transfer-client'].includes(type)) assertClient(id);
    if (type === 'appointment-create' && id) assertClient(id);
    if (type === 'appointment-edit') assertClient(find('appointments',id)?.clientId);
    if (type === 'revoke-service') assertService(id);
    if (type === 'edit-plan' && !canEditPlan(assertClient(id))) throw new Error('请由负责康复师或老板更新计划');
    const content = staffDialog(type,id,ctx());
    if (type === 'edit-plan' && content && find('clients',id).progress.status === 'pending') content.html = content.html.replace(/(<textarea name="progressSummary"[^>]*>)[\s\S]*?(<\/textarea>)/, '$1$2');
    return content;
  }
  if (type === 'plan') return planDialog(id);
  if (type === 'progress') return progressDialog(id);
  if (type === 'package') return packageDialog(id);
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
  if (type === 'register') updateParticipants();
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
    if (action === 'therapist-performance') { assertBoss(); filters.therapistId = id; view = 'performance'; render(true); return; }
    if (action === 'task-complete') {
      assertStaff();
      const task = find('tasks',id);
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
    if (type === 'register') {
      result = model.registerService({...data,participantIds:fd.getAll('participantIds'),requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('本次服务已登记',`<h3>${esc(name('clients',result.clientId))} · ${esc(result.project)}</h3><div class="success-summary detail-grid">${pair('套餐剩余',`${model.remaining(result.clientId)} 次`)}${pair('消费业绩',`${money(result.amount)}，归${name('therapists',result.principalId)}`)}</div><p class="muted">协作人员只保留参与记录，本次仅扣 1 次。</p><div class="action-row">${button('查看服务明细','service-detail',result.id,'btn-outline')}${button('安排下一次服务','appointment-create',result.clientId,'btn-outline')}</div>`); return;
    }
    if (type === 'edit-plan') {
      const summary = String(data.progressSummary || '').trim();
      model.publishPlan(data.clientId,{...data,progress:summary ? {status:'updated',summary,metrics:find('clients',data.clientId).progress.metrics} : {status:'pending',summary:'待康复师完成评估后更新',metrics:[]}},role);
    } else if (['appointment-create','appointment-edit'].includes(type)) model.saveAppointment(data,role);
    else if (type === 'appointment-cancel') model.cancelAppointment(data.id,data.reason,role);
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
      showSuccess('次数已恢复，业绩已冲回',`<div class="detail-grid">${pair('客户',name('clients',result.clientId))}${pair('套餐剩余',`${model.remaining(result.clientId)} 次`)}${pair('冲回消费业绩',money(result.amount))}${pair('主康复师',name('therapists',result.principalId))}</div><p class="muted">原服务记录与撤销原因已保留。</p>${button('查看原记录','service-detail',result.id,'btn-outline')}`); return;
    } else if (type === 'reset') {
      model = new DemoModel(); drafts.clear(); preferences.clear(); $('#network-toggle').checked = false;
      closeDialog(false); role = {type:'customer',id:'c1'}; view='home'; filters={storeId:'',therapistId:'',from:'',to:'',query:''}; render(true); toast('示例已重置'); return;
    } else throw new Error('此表单暂不可提交');
    drafts.delete(context.key); f.dataset.succeeded = 'true'; closeDialog(false); render();
    toast(({ 'edit-plan':'计划已保存，客户页面同步更新','appointment-create':'服务安排已确认','appointment-edit':'新的服务安排已确认','appointment-cancel':'预约已取消，未扣次数',reschedule:'改约申请已提交，等待工作人员确认',followup:'回访结果已保存','add-store':'新门店已加入，共用客户档案','add-therapist':'康复师已加入，可分配客户','transfer-client':'负责人已转交，历史业绩保留原归属','import-opening':'期初档案已录入，不产生新消费业绩','deactivate-therapist':'康复师已停用，历史记录保留' })[type] || '已保存');
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
