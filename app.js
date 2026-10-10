import { bossDecisionDialog } from './boss-decision.js?v=20261010-assessor-personnel-1';
import {saveMultiDayBooking} from './multi-day-booking.js?v=20261010-assessor-personnel-1';
import {multiDayBookingDialog,restoreMultiDayBookingDraft,updateMultiDayBookingForm,addMultiDayBookingRow,removeMultiDayBookingRow,multiDayBookingItems,advanceMultiDayBookingForm,multiDayResultSummary} from './multi-day-booking-ui.js?v=20261010-assessor-personnel-1';
import { DemoModel, TODAY, EVIDENCE_LIMITS, ensureStorePackageExamples } from './core.js?v=20261010-assessor-personnel-1';
import { renderStaff, staffDialog, personnelDialog, updateServicePackageChoices } from './staff.js?v=20261010-assessor-personnel-1';
import { renderManager, managerDialog } from './manager.js?v=20261010-assessor-personnel-1';
import { hourTimeField } from './hour-picker.js?v=20261010-assessor-personnel-1';
import { appointmentBatchDialog, restoreBookingDraft, updateBookingMembers, addBookingMember, removeBookingMember, bookingMembers } from './companion-booking.js?v=20261010-assessor-personnel-1';
import { cashDialog, updateCashFields, updateCashPackageChoices } from './cash.js?v=20261010-assessor-personnel-1';
import { receptionDialog, receptionStores, assertReceptionAppointment, receptionIntakeDialog, receptionIntakeSuccess, updateReceptionIntakeChoices, receptionDuplicateMarkup, restoreReceptionIntakeDraft } from './reception.js?v=20261010-assessor-personnel-1';
import { ensureEvaluations, assessmentRows, latestConfirmedAssessment, recordAssessment, confirmAssessment, voidAssessment, recordFrontDeskEvaluation, frontDeskEvaluationRows, voidFrontDeskEvaluation, evaluationDialog } from './evaluations.js?v=20261010-assessor-personnel-1';

import { ensureCustomerBooking, requestCustomerBooking, cancelCustomerBooking, confirmCustomerBooking, customerBookingRows, resolveCustomerBooking, acceptCustomerBookingSuggestion } from './customer-booking.js?v=20261010-assessor-personnel-1';
import { customerBookingTypes, renderCustomerHome, customerRequestDialog, renderBookingInbox, renderRequestHistory, updateCustomerBookingForm, advanceCustomerBookingForm } from './customer-ui.js?v=20261010-assessor-personnel-1';

import { ensurePaperIntakes, paperIntakeRows, savePaperIntake, reviewPaperIntake, paperIntakeDialog, updatePaperIntakeForm } from './paper-intake.js?v=20261010-assessor-personnel-1';

import { ensureSchedules, scheduleRows, scheduleRequestRows, bossScheduleNotifications, saveSchedule, requestScheduleChange, decideScheduleChange, markScheduleNotificationRead } from './schedules.js?v=20261010-assessor-personnel-1';
import { renderSchedulePage, renderScheduleSummary, renderScheduleInbox, scheduleDialog, updateScheduleForm } from './schedules-ui.js?v=20261010-assessor-personnel-1';
import { updateAppointmentAvailability } from './booking-availability.js?v=20261010-assessor-personnel-1';
import { workflowTypes, workflowDialog, updateWorkflowForm, serviceResultSummary } from './workflow-ui.js?v=20261010-assessor-personnel-1';

// Keep operations on the displayed example day. Real systems use server time.
function previewTimestamp() {
  const time = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date());
  return new Date(`${TODAY}T${time}+08:00`).toISOString();
}
let model = new DemoModel({now:previewTimestamp});
ensureStorePackageExamples(model);
ensureEvaluations(model);
ensureCustomerBooking(model);
ensurePaperIntakes(model);
ensureSchedules(model);
let role = {type: 'customer', id: 'c1'};
let view = 'home';
const previewEntry = new URLSearchParams(location.search).get('preview');
const customerShare = previewEntry === 'customer';
let filters = {storeId: '', therapistId: '', from: '', to: '', query: ''};
const drafts = new Map();
const preferences = new Map();
let dialogContext = null;
let focusBeforeDialog = null;
let toastTimer;
let nextRequest = 0;
let nextPhoto = 0;
let photoFocusBefore = null;
const $ = selector => document.querySelector(selector);
const main = $('#app-main');
const sheet = $('#sheet');
const photoViewer = $('#photo-viewer');
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const find = (kind, id) => model.state[kind].find(row => row.id === id);
const name = (kind, id) => id === 'boss' ? '老板' : find(kind, id)?.name || (kind==='therapists'&&!id?'预约时选择':'待安排');
const icon = (name, size = 20, extra = '') => `<img class="icon ${extra}" src="assets/icons/${name}.svg" width="${size}" height="${size}" alt="" aria-hidden="true">`;
const money = amount => `¥${Number(amount || 0).toLocaleString('zh-CN', {maximumFractionDigits: 2})}`;
const date = value => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : '待安排';
const weekday = value => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',weekday:'short'}).format(new Date(`${value}T00:00:00+08:00`));
const button = (label, action, id = '', style = 'btn-outline', ico = '') => `<button type="button" class="btn ${style}" data-action="${action}" data-id="${esc(id)}">${esc(label)}${ico ? icon(ico, 18) : ''}</button>`;
const link = (label, action, id = '') => button(label, action, id, 'text-link', 'chevron-right');
const hidden = (key, value) => `<input type="hidden" name="${key}" value="${esc(value)}">`;
const field = (label, key, value = '', type = 'text', attrs = '') => `<label class="field"><span>${label}</span><input type="${type}" name="${key}" value="${esc(value)}" ${attrs}></label>`;
const textarea = (label, key, value = '', attrs = '') => `<label class="field span-all"><span>${label}</span><textarea name="${key}" rows="3" ${attrs}>${esc(value)}</textarea></label>`;
const form = (type, html, submit) => `<form data-form="${type}">${html}<p class="form-error" role="alert" hidden></p><div class="dialog-footer">${button('稍后再填写', 'close-dialog', '', 'btn-quiet')}<button type="submit" class="btn btn-primary">${submit}</button></div></form>`;
const pair = (label, value) => `<div class="detail-pair"><span class="muted">${label}</span><strong class="detail-value">${esc(value)}</strong></div>`;
const ctx = () => ({model, role, view, filters, esc, icon, fmt: {money, date}, ui: {}});
const customerCtx = () => ({...ctx(),ui:{button,link,name,pair,field,hourTimeField,form,hidden,clientServices,appointments,reviewFor,selectedStoreId:role.type==='customer'?(preferences.get('store:'+role.id)||find('clients',role.id)?.storeId):''}});
const clientServices = id => model.serviceRows({clientId: id}).filter(s=>role.type!=='therapist'||find('therapists',role.id)?.legacy||s.principalId===role.id||(s.participantIds||[]).includes(role.id));
const appointments = id => model.state.appointments.filter(a => a.clientId === id && a.date >= TODAY && ['confirmed','reschedule_requested'].includes(a.status)).sort((a,b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
const reviewFor = id => model.reviewRows(role).find(r => r.serviceId === id);
const currentClient = () => find('clients', role.id);
const canEditPlan = client => role.type === 'boss' || (role.type === 'therapist' && find('therapists',role.id)?.legacy && !client.assessorId && client.ownerId === role.id);
function assertClient(id) {
  if (!model.canSeeClient(role, id)) throw new Error('您没有查看该客户档案的权限');
  return find('clients', id);
}
function assertBoss() { if (role.type !== 'boss' || role.id !== 'boss') throw new Error('此操作仅老板可使用'); }
function assertStaff() { if (!['boss','therapist'].includes(role.type)) throw new Error('此操作仅工作人员可使用'); }
function assertService(id) {
  if(role.type==='frontdesk')throw new Error('前台只查看接待信息，服务明细由客户、康复师和老板查看');
  const s = find('services', id);
  if (!s) throw new Error('服务记录不存在');
  if(role.type==='manager'&&s.storeId!==model.managerStoreId(role))throw new Error('店长仅能查看本店服务明细');
  // Staff can audit their own historical service without regaining client access.
  const ownHistory = role.type === 'therapist' && (s.principalId === role.id || s.participantIds.includes(role.id));
  if(role.type==='therapist'&&!find('therapists',role.id)?.legacy&&!ownHistory)throw new Error('治疗师仅能查看本人主服务或协作服务');
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
  $('#role-select').innerHTML = `<optgroup label="客户端">${model.state.clients.map(c => `<option value="customer:${c.id}">${esc(c.name)} · 客户 · ${esc(name('stores', c.storeId))}</option>`).join('')}</optgroup><optgroup label="治疗师端">${model.state.therapists.filter(t => t.active).map(t => `<option value="therapist:${t.id}">${esc(t.name)} · ${esc(name('stores', t.storeId))}</option>`).join('')}</optgroup><optgroup label="前台端">${(model.state.frontDesks||[]).filter(f=>f.active!==false).map(f=>`<option value="frontdesk:${esc(f.id)}">${esc(f.name)} · 前台</option>`).join('')}</optgroup><optgroup label="店长端">${model.state.storeManagers.filter(m=>m.active).map(m=>`<option value="manager:${esc(m.id)}">${esc(m.name)} · ${esc(name('stores',m.storeId))}</option>`).join('')}</optgroup><optgroup label="管理端"><option value="boss:boss">涛博士 · 评估师 / 老板 · 所有门店</option></optgroup>`;
  $('#role-select').value = `${role.type}:${role.id}`;
}
function switchRole(value, targetView) {
  closeDialog();
  const [type, id] = value.split(':');
  if (customerShare && type !== 'customer') return;
  if(!['customer','therapist','boss','frontdesk','manager'].includes(type))return;
  if (type === 'customer' && !find('clients', id)) return;
  if (type === 'therapist' && !find('therapists', id)?.active) return;
  if (type === 'boss' && id !== 'boss') return;
  if(type==='frontdesk'&&!model.state.frontDesks?.some(f=>f.id===id&&f.active!==false))return;
  if(type==='manager'&&!model.state.storeManagers.some(m=>m.id===id&&m.active))return;
  role = {type, id};
  if (window.matchMedia('(max-width: 760px)').matches) $('.preview-controls').open = false;
  view = targetView || (type === 'customer' ? 'home' : type === 'boss' ? 'overview' : type==='frontdesk'?'reception':type==='manager'?'manager-overview':'work');
  filters = {storeId: '', therapistId: '', from: '', to: '', query: ''};
  if (type === 'boss') { filters.from = TODAY; filters.to = TODAY; }
  if(type==='frontdesk')filters={...filters,storeId:receptionStores(ctx())[0]?.id||'',from:TODAY,to:TODAY};
  if(type==='manager')filters={...filters,from:TODAY,to:TODAY};
  render(true);
}
function navigation() {
  const items = role.type === 'customer' ? [['home','预约','calendar'],['records','服务记录','clipboard-text'],['profile','我的','user']] : role.type === 'therapist' ? [['work','今日','home'],['therapist-appointments','预约','calendar'],['clients','客户','users'],['performance','业绩','chart-bar']] : role.type==='frontdesk'?[['reception','接待','home'],['reception-assessments','评估','chart-bar'],['cash','收款','clipboard-text'],['reception-clients','客户','users']]:role.type==='manager'?[['manager-overview','今日','home'],['manager-appointments','预约','calendar'],['manager-clients','客户','users'],['manager-records','经营','chart-bar']]:[['overview','概览','chart-bar'],['clients','客户','users'],['performance','业绩','clipboard-text'],['team','人员管理','users']];
  if(['boss','frontdesk'].includes(role.type))items.push(['schedules',role.type==='therapist'?'我的排班':'排班','calendar']);
  return items.map(([key,label,ico]) => `<button class="nav-item ${view === key ? 'active' : ''}" data-action="nav" data-id="${key}" ${view === key ? 'aria-current="page"' : ''}>${icon(ico === 'home' && view === key ? 'home-filled' : ico,25)}<span class="nav-label">${label}</span></button>`).join('');
}
function render(resetScroll = false) {
  roleOptions();
  const customer = role.type === 'customer';
  $('#app-window').className = `app-window ${customer ? 'customer-mode' : 'staff-mode'}`;
  const resetControl=$('[data-action="reset"]');
  if(resetControl)resetControl.hidden=role.type==='manager';
  const label = customer ? name('clients', role.id) : role.type === 'boss' ? '老板管理' : role.type==='frontdesk'?`${name('frontDesks',role.id)} · 前台`:role.type==='manager'?`${name('storeManagers',role.id)} · 店长`:`${name('therapists', role.id)} · 康复师`;
  $('#app-header').innerHTML = `<div class="app-brand"><img class="brand-logo" src="assets/brand-logo.png" alt="涛博士 Dr.Tao 运动康复" width="146" height="56"></div><div class="customer-head"><span class="header-name">${esc(label)}</span>${customer ? `<button class="capsule" data-action="mini-info" aria-label="小程序预览说明">${icon('dots',20)}<span></span>${icon('circle-dot',20)}</button>` : '<span class="tag tag-green">工作端</span>'}</div>`;
  const staffHome=['work','overview','reception','manager-overview'].includes(view);
  main.innerHTML = customer ? view === 'records' ? customerRecords() : view === 'profile' ? customerProfile() : customerHome() : view==='schedules'?renderSchedulePage(ctx()):`${role.type==='manager'?renderManager(ctx()):`${view==='work'?assessmentInbox():''}${renderStaff(ctx())}`}${staffHome?renderScheduleInbox(ctx())+(role.type==='therapist'&&view==='work'?'':renderScheduleSummary(ctx())):''}${role.type==='manager'?'':renderBookingInbox(customerCtx())}`;
  const supervision=main.querySelector('.manager-supervision');
  if(supervision)supervision.open=!window.matchMedia('(max-width: 760px)').matches;
  $('#bottom-nav').innerHTML = navigation();
  if (resetScroll) main.scrollTop = 0;
}

function assessmentInbox() {
  if (role.type !== 'therapist') return '';
  const rows = assessmentRows(model, role).filter(r => r.status === 'pending' && (r.therapistId === role.id || find('clients',r.clientId)?.ownerId === role.id));
  if (!rows.length) return '';
  return `<section class="evaluation-inbox card"><div class="section-head"><h2>待核对评估</h2><span class="tag">${rows.length} 条</span></div>${rows.map(r => `<div class="row"><div><strong>${esc(name('clients',r.clientId))}</strong><p class="meta">${date(r.date)} · ${esc(r.project)}</p></div>${button('核对数据','assessment-detail',r.id,'btn-outline')}</div>`).join('')}</section>`;
}

function customerHome() { return renderCustomerHome(customerCtx()); }
function customerRecords() {
  const services = clientServices(role.id), valid = services.filter(s => s.status === 'valid');
  const unrated = valid.filter(s => !reviewFor(s.id));
  return `<div class="customer-page ease-customer-page"><div class="page-head"><div><span class="eyebrow">每一次服务，都有记录</span><h1>服务记录</h1><p class="muted">已完成 ${valid.length} 次${unrated.length ? ` · ${unrated.length} 次待评价` : ''}</p></div></div>${unrated.length ? `<div class="ease-review-prompt"><span>分享您的真实体验，帮助我们改进服务。</span>${button('去评价','review',unrated[0].id,'btn-primary')}</div>` : ''}<div class="ease-record-list">${services.length ? services.map(s => `<article class="ease-record-card"><div class="ease-section-head"><span class="ease-record-date">${date(s.date)} · ${esc(s.time)}</span><span class="tag ${s.status === 'valid' ? 'tag-green' : 'tag-warn'}">${s.status === 'valid' ? '已完成' : '已撤销'}</span></div><h2>${esc(s.project)}</h2><p class="meta">${esc(name('therapists',s.principalId))} · ${esc(name('stores',s.storeId))} · ${s.billingMode==='single'?'单次服务 · 不扣套餐次数':s.status === 'valid' ? `使用 ${s.sessions} 次` : find('packages',s.packageId)?.closed?'已纠正消课，套餐已结束':'次数已恢复'}</p><details class="ease-record-note"><summary>本次服务小结</summary><p>${esc(s.notes)}</p></details><div class="ease-inline-actions">${button('服务明细','service-detail',s.id,'btn-outline')}${s.status === 'valid' ? button(reviewFor(s.id) ? '查看我的评价' : '评价本次服务','review',s.id,reviewFor(s.id) ? 'btn-quiet' : 'btn-primary','star') : ''}</div></article>`).join('') : '<div class="empty card">还没有服务记录，完成服务后会显示在这里。</div>'}</div><div class="ease-page-links">${link('套餐使用明细','package',role.id)}${link('预约记录','appointment-history',role.id)}</div></div>`;
}
function customerProfile() {
  const c = currentClient(), pref = preferences.get(c.id) || false;
  const menu = (label,action,ico) => `<button class="ease-menu-item" data-action="${action}" data-id="${c.id}">${icon(ico,21)}<span>${label}</span>${icon('chevron-right',18)}</button>`;
  return `<div class="customer-page ease-customer-page"><div class="profile-card"><div class="profile-avatar">${icon('user',30)}</div><div><h1>${esc(c.name)}</h1><p class="muted">${c.phone?esc(String(c.phone).slice(0,3))+'****'+esc(String(c.phone).slice(-4)):'手机号待补充'}</p></div></div><section class="ease-team"><h2>我的服务团队</h2><div class="ease-team-info">${c.ownerId?`<span>客户负责人 <strong>${esc(name('therapists',c.ownerId))}</strong></span>`:''}<span>评估师 <strong>涛博士</strong></span><span>治疗师 <strong>预约时选择</strong></span><span>所属门店 <strong>${esc(name('stores',c.storeId))}</strong></span></div>${link('查看门店信息','stores',c.id)}</section><div class="ease-profile-menu">${menu('我的评估记录','assessment-history','chart-bar')}${menu('我的套餐与剩余次数','package','stack')}${menu('我的预约记录','appointment-history','calendar')}<details class="ease-home-advice"><summary>${icon('clipboard-text',21)}<span>居家指导</span>${icon('chevron-right',18)}</summary><div><p>${esc(c.homeAdvice)}</p>${link('查看完整计划','plan',c.id)}</div></details>${menu('反馈与帮助','help','bell')}${menu('我的档案与隐私','privacy','shield-check')}</div><details class="ease-reminder"><summary>服务提醒设置</summary><label class="check"><input type="checkbox" data-preference="reminder" ${pref ? 'checked' : ''}><span>希望收到服务提醒</span></label><p class="meta">预览中只保存此页面的偏好。正式提醒需您授权后启用。</p></details><p class="ease-brand-caption">涛博士 · 让每一次康复都有清晰的安排</p></div>`;
}

function planDialog(id) {
  const c = assertClient(id);
  const tasks = model.state.tasks.filter(t => t.clientId === id && ['plan','assessment','review','reschedule'].includes(t.type));
  return {title: '我的完整康复计划', html: `<span class="eyebrow">计划第 ${c.planVersion} 版</span><h3>${esc(c.goal)}</h3><p>${esc(c.planNotes)}</p><div class="detail-grid">${pair('当前阶段',c.phase)}${pair('负责康复师',name('therapists',c.ownerId))}</div><div class="note"><strong>下一步</strong><p>${esc(c.nextStep)}</p></div><h3>具体安排</h3><div class="plan-timeline">${tasks.length ? tasks.map(t => `<div class="timeline-item"><span class="timeline-dot ${t.status === 'completed' ? 'completed' : ''}"></span><div><strong>${esc(t.title)}</strong><p class="meta">${esc(name('therapists',t.assigneeId))} · 计划 ${date(t.dueDate)} · ${t.status === 'completed' ? '已完成' : '待完成'}</p></div></div>`).join('') : '<p class="muted">具体安排将由您的负责康复师补充。</p>'}</div><h3>居家指导</h3><p>${esc(c.homeAdvice)}</p><p class="meta">计划会根据阶段评估调整；套餐使用次数与康复进展分别记录。</p><div class="action-row">${link('查看康复进展','progress',id)}${link('计划更新记录','plan-history',id)}${canEditPlan(c) ? button('更新计划','edit-plan',id,'btn-primary') : ''}</div>`};
}
function progressDialog(id) {
  const c = assertClient(id);
  const latest = latestConfirmedAssessment(model,role,id);
  if (latest) { const detail=evaluationDialog('assessment-detail',latest.id,ctx());return {title:'康复进展与评估记录',html:`${detail.html}<h3>当前安排</h3><p>${esc(c.phase)}</p><p>${esc(c.nextStep)}</p>${button('查看全部评估记录','assessment-history',id,'btn-outline')}`}; }
  return {title: '康复进展', html: `<div class="note"><strong>${c.progress.status === 'updated' ? '本阶段评估' : '等待首次阶段记录'}</strong><p>${esc(c.progress.summary)}</p></div>${c.progressUpdatedAt ? `<p class="meta">更新日期 ${date(c.progressUpdatedAt)} · 负责康复师 ${esc(name('therapists',c.ownerId))}</p>` : '<p class="muted">完成评估后，您的康复师会记录实际变化和下一步建议。</p>'}${c.progress.metrics.length ? `<div class="detail-grid">${c.progress.metrics.map(m => pair(m.label || m.name, m.value ?? `${m.before ?? "—"} → ${m.after ?? "—"} ${m.unit || ""}`)).join('')}</div>` : ''}<h3>当前安排</h3><p>${esc(c.phase)}</p><p>${esc(c.nextStep)}</p><p class="notice">套餐次数反映服务使用情况，康复进展以康复师评估记录为依据。</p>${canEditPlan(c) ? button('补充评估与计划','edit-plan',id,'btn-primary') : ''}`};
}
function packageRecord(pack) {
  const balance = model.packageRemaining(pack.id);
  const rows = clientServices(pack.clientId).filter(s => s.packageId === pack.id);
  const used = pack.openingUsed + rows.filter(s=>s.status==='valid').reduce((sum,s)=>sum+s.sessions,0);
  const finance = role.type==='boss' && pack.storeId ? model.packageFinance(pack.id,role) : null;
  return `<h3>${esc(pack.name)}</h3>${pack.closed?'<p class="notice">套餐已结束，未用次数暂停使用，历史服务保留。</p>':''}<div class="detail-grid">${role.type === 'customer' ? '' : pair('套餐金额',money(pack.amount))}${pair('套餐总次数',`${pack.total} 次`)}${pair('剩余次数',`${balance} 次`)}${pair('已使用',`${used} 次`)}${pack.closed?pair('已结束未用次数',`${pack.total-used} 次`):''}</div>${finance?`<section class="note"><strong>本套餐收款核对</strong><div class="detail-grid">${pair('已关联到账',money(finance.received))}${pair('已关联退款',money(finance.refunded))}${pair('关联净收款',money(finance.netReceived))}${pair('套餐与收款差额',money(pack.amount-finance.netReceived))}${pair('平台待到账',money(finance.pending))}</div><p class="meta">${finance.status==='opening'?'历史套餐未自动追记收入，请按旧账核对。':finance.status==='unlinked'?'尚未关联收款，请登记已收款或从收款记录关联。':'仅统计本套餐已关联的收退款；与套餐金额的差额需核对，不自动认定为欠款。'}</p></section>`:''}<h3>次数变动记录</h3>${pack.openingUsed ? `<div class="row"><div><strong>期初纸质档案余额</strong><p class="meta">已核对迁入 ${pack.openingUsed} 次历史使用</p></div><span>−${pack.openingUsed} 次</span></div>` : ''}${rows.length ? rows.map(s => `<div class="row"><div><strong>${date(s.date)} · ${esc(s.project)}</strong><p class="meta">${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? '已完成' : pack.closed?'已撤销，套餐已结束':'已撤销，恢复原套餐 1 次'}</p></div>${link(s.status === 'valid' ? '−1 次' : '已冲回','service-detail',s.id)}</div>`).join('') : '<p class="muted">此套餐暂无新增服务记录。</p>'}`;
}
function packageDialog(id,storeId='') {
  const c = assertClient(id);
  const rows=model.state.packages.filter(pack=>pack.clientId===id&&(!storeId||pack.storeId===storeId||(!pack.storeId&&pack.id===c.packageId)));
  return {title:storeId?name('stores',storeId)+' · 套餐次数':'我的套餐与次数',html:
    '<p class="notice">麦岛店与崂山店的套餐分别使用，消课按实际服务门店扣对应套餐。</p>'+rows.map(pack=>'<section class="store-package-record"><span class="tag tag-green">'+esc(pack.storeId?name('stores',pack.storeId)+' · 仅限本店':'旧套餐 · 使用范围待核对')+'</span>'+packageRecord(pack)+(role.type==='boss'&&!pack.closed&&model.packageRemaining(pack.id)===0?button('续接本店套餐','renew-package',pack.id,'btn-outline'):'')+'</section>').join('')+(rows.length?'':'<p class="muted">暂无该店套餐。可提交预约申请，后续服务费用请与门店确认。</p>')+
    (role.type==='boss'?button('办理本店套餐','create-store-package',id,'btn-primary'):'')+'<p class="meta">每笔消课保留实际使用的套餐。撤销只恢复原套餐次数，不会挪到另一门店。</p>'};
}
function packageHistoryDialog(id) {
  const p = find('packages',id);
  if (!p) throw new Error('套餐不存在');
  const c = assertClient(p.clientId);
  const historical = c.packageId !== id;
  const balance = model.packageRemaining(id);
  return {title:p.storeId ? '门店套餐明细' : historical ? '历史套餐明细' : '套餐记录',html:`<span class="tag ${historical ? '' : 'tag-green'}">${p.storeId ? esc(name('stores',p.storeId))+' · 仅限本店' : historical ? '历史套餐' : '当前套餐'}</span>${packageRecord(p)}${historical && balance > 0 && !p.storeId ? `<div class="notice"><strong>本套餐仍有 ${balance} 次</strong><p>恢复的次数保留在本套餐，由老板核对后选择继续使用。</p>${role.type === 'boss' ? button('切换使用本套餐','activate-package',p.id,'btn-primary') : ''}</div>` : ''}${button('查看客户当前套餐','package',c.id,'btn-outline')}`};
}
function appointmentHistoryDialog(id) {
  const client = assertClient(id);
  const rows = model.state.appointments.filter(a => a.clientId === id && (role.type!=='therapist'||find('therapists',role.id)?.legacy||a.principalId===role.id||(a.participantIds||[]).includes(role.id))).sort((a,b)=>`${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  const labels = {confirmed:'已确认',reschedule_requested:'改约待确认',pending_reassignment:'服务人员待确认',completed:'已服务',cancelled:'已取消',no_show:'未到店'};
  return {title:role.type==='therapist'?`${client.name}的预约记录`:'预约记录',html:`${renderRequestHistory(customerCtx(),id)}<p class="muted">预约与实际服务分别记录；完成服务并登记后，才更新套餐次数和消费业绩。</p>${rows.map(a=>{
    const pending = ['confirmed','reschedule_requested','pending_reassignment'].includes(a.status);
    const needsAssignment = a.status === 'pending_reassignment';
    const status = !needsAssignment && pending && a.date < TODAY ? '到店情况待确认' : labels[a.status] || '待确认';
    const staff = role.type !== 'customer';
    return `<article class="record-item"><div class="section-head"><h3>${date(a.date)} · ${esc(a.time)}</h3><span class="tag ${a.status === 'completed' ? 'tag-green' : a.status === 'no_show' || (pending && a.date < TODAY) ? 'tag-warn' : ''}">${status}</span></div><p>${esc(a.project)}</p><p class="meta">${esc(name('therapists',a.principalId))} · ${esc(name('stores',a.storeId))}</p>${needsAssignment ? '<p class="notice">此安排需要工作人员重新确认服务人员，请等待新安排后到店。</p>' : ''}${(a.participantIds || []).length ? `<p class="meta">协作康复师：${esc(a.participantIds.map(t=>name('therapists',t)).join('、'))}</p>` : ''}${a.status === 'reschedule_requested' ? `<div class="note"><strong>客户申请改至 ${date(a.request?.date)} ${esc(a.request?.time || '')}</strong><p>改约说明：${esc(a.requestNote || a.request?.reason || '未填写说明')}</p></div>` : ''}${a.status === 'no_show' ? `<p>未到店说明：${esc(a.noShowReason)}</p><p class="meta">本次未扣次数，未产生消费业绩。</p>` : a.status === 'cancelled' ? `<p>取消说明：${esc(a.cancelReason)}</p><p class="meta">本次未扣次数。</p>` : ''}<div class="action-row">${role.type==='therapist' ? link('预约详情','appointment',a.id) : ''}${a.status === 'completed' && a.serviceId ? link('查看对应服务','service-detail',a.serviceId) : ''}${pending && !needsAssignment && staff && a.date <= TODAY ? button('按预约登记服务','register-appointment',a.id,'btn-primary') : ''}${pending && !needsAssignment && staff && a.date <= TODAY && (role.type === 'boss' || role.id === a.principalId) ? button('记录未到店','appointment-no-show',a.id,'btn-outline') : ''}${pending && staff ? `${link('调整安排','appointment-edit',a.id)}${link('取消预约','appointment-cancel',a.id)}` : pending && !needsAssignment && role.type === 'customer' && a.date >= TODAY ? button(a.status === 'reschedule_requested' ? '修改改约申请' : '申请改约','reschedule',a.id,'btn-outline')+button(a.cancellationRequest?.status==='pending'?'取消申请待处理':'申请取消','appointment-cancel-request',a.id,'btn-quiet') : ''}</div></article>`;
  }).join('') || '<div class="empty">还没有预约记录。</div>'}`};
}

function serviceDialog(id) {
  const s = assertService(id);
  const r = reviewFor(id);
  const canOpenClient = model.canSeeClient(role, s.clientId);
  return {title: '服务明细', html: `<span class="tag ${s.status === 'valid' ? 'tag-green' : 'tag-warn'}">${s.status === 'valid' ? '已完成' : '已撤销'}</span><h3>${esc(s.project)}</h3><div class="detail-grid">${pair('客户',name('clients',s.clientId))}${pair('服务日期',`${date(s.date)} ${s.time}`)}${pair('服务门店',name('stores',s.storeId))}${pair('本次主康复师',name('therapists',s.principalId))}${pair('参与康复师',s.participantIds.map(t => name('therapists',t)).join('、') || '独立服务')}${pair('登记时客户负责人',name('therapists',s.ownerId))}${pair('登记人',name('therapists',s.recordedBy))}${pair('登记方式',s.billingMode==='single'?'单次服务 · 不扣套餐次数':find('packages',s.packageId)?.name || '原套餐')}${s.billingMode==='single'?role.type!=='customer'?pair('对应单次收款',s.receiptId):'':pair('套餐次数',s.status === 'valid' ? `使用 ${s.sessions} 次` : find('packages',s.packageId)?.closed ? '已纠正消课，原套餐已结束' : '已恢复原套餐 1 次')}${role.type !== 'customer' ? pair('消费业绩',s.status === 'valid' ? `${money(s.amount)}，归${name('therapists',s.principalId)}` : `${money(s.amount)} 已冲回`) : ''}</div><h3>这次为您做了什么</h3><p>${esc(s.notes)}</p>${s.nextStepSuggestion?`<h3>下次建议</h3><p>${esc(s.nextStepSuggestion)}</p>${role.type!=='customer'&&s.status==='valid'&&canEditPlan(find('clients',s.clientId))?button('确认客户下一步','confirm-service-next-step',s.id,'btn-outline'):''}`:''}${serviceEvidence(s)}${s.status === 'revoked' ? `<div class="note"><strong>撤销说明</strong><p>${esc(s.revokeReason)}</p><p class="meta">处理人 ${esc(name('therapists',s.revokedBy))} · 原记录保留</p></div>` : ''}${r ? `<div class="note"><strong>客户评价 ${r.score} 分</strong><p>${esc(r.feedback || '未填写文字反馈')}</p><p class="meta">${r.followupStatus === 'closed' ? '已完成回访' : r.followupStatus === 'pending' ? '老板待跟进' : '已记录'}</p></div>` : ''}<div class="action-row">${role.type === 'customer' && s.status === 'valid' ? button(r ? '查看我的评价' : '评价本次服务','review',id,'btn-primary','star') : ''}${role.type !== 'customer' && canOpenClient ? button('打开客户档案','client-detail',s.clientId,'btn-outline') : ''}${role.type === 'boss' && s.status === 'valid' ? button('撤销错误登记','revoke-service',id,'btn-quiet') : ''}${role.type === 'boss' && r?.followupStatus === 'pending' ? button('记录回访','followup',r.id,'btn-primary') : ''}</div>`};
}
function serviceEvidence(service) {
  const photos = service.evidencePhotos || [];
  if (!photos.length) return '<section class="service-evidence"><h3>消课留底照片</h3><p class="meta">历史记录暂无留底照片。</p></section>';
  if (!model.canSeeEvidence(role, service.id)) return '<section class="service-evidence"><h3>消课留底照片</h3><p class="meta">已留底，仅客户本人、当前负责康复师、本次服务人员及老板可查看。</p></section>';
  return `<section class="service-evidence"><div class="section-head"><h3>消课留底照片</h3><span class="tag tag-green">${photos.length} 张</span></div><p class="meta">登记人 ${esc(name('therapists', service.recordedBy))} · 登记时间 ${esc(new Date(service.recordedAt || service.createdAt).toLocaleString('zh-CN'))}</p><div class="evidence-grid">${photos.map((photo, i) => `<figure class="evidence-tile"><button type="button" class="evidence-thumbnail" data-action="service-photo" data-id="${esc(service.id)}" data-photo-id="${esc(photo.id)}" aria-label="查看留底照片 ${i + 1}"><img src="${esc(photo.dataUrl)}" width="${photo.width}" height="${photo.height}" alt="本次服务留底照片 ${i + 1}" loading="lazy" decoding="async"></button><figcaption>照片 ${i + 1} · 点开查看</figcaption></figure>`).join('')}</div><p class="meta">照片随服务记录保留${service.status === 'revoked' ? '，本次消课已撤销，原照片仍保留供核对' : ''}。</p></section>`;
}

function updateEvidencePicker() {
  const section = $('#sheet-body [data-evidence-section]');
  if (!section || !dialogContext) return;
  const photos = dialogContext.evidencePhotos || [];
  const busy = dialogContext.photoBusy || $('#sheet-body form')?.dataset.busy === 'true';
  const hint = $('#sheet-body [data-registration-photo-hint]');
  if (hint) hint.textContent = dialogContext.photoBusy ? '留底照片正在处理，请稍候。' : photos.length ? `已添加 ${photos.length} 张留底照片，确认小结后可登记。` : '还需添加至少 1 张留底照片，再确认登记。';
  section.setAttribute('aria-busy', String(Boolean(busy)));
  section.querySelector('[data-evidence-status]').textContent = dialogContext.photoBusy ? '正在处理照片，请稍候…' : photos.length ? `已添加 ${photos.length} / ${EVIDENCE_LIMITS.maxCount} 张，可点开核对。` : '尚未添加照片。请先留底，再确认消课。';
  section.querySelector('[data-evidence-list]').innerHTML = photos.map((photo, i) => `<figure class="evidence-tile"><button type="button" class="evidence-thumbnail" data-action="draft-photo" data-id="${esc(photo.id)}" aria-label="预览照片 ${i + 1}" ${busy ? 'disabled' : ''}><img src="${esc(photo.dataUrl)}" width="${photo.width}" height="${photo.height}" alt="待保存的留底照片 ${i + 1}"></button><figcaption><span>照片 ${i + 1}</span><button type="button" class="text-link" data-action="remove-photo" data-id="${esc(photo.id)}" aria-label="删除照片 ${i + 1}" ${busy ? 'disabled' : ''}>删除</button></figcaption></figure>`).join('');
  section.querySelectorAll('[data-action="evidence-pick"], [data-evidence-picker]').forEach(el => { el.disabled = Boolean(busy) || photos.length >= EVIDENCE_LIMITS.maxCount; });
  const error = section.querySelector('[data-evidence-error]');
  error.hidden = !dialogContext.photoError;
  error.textContent = dialogContext.photoError || '';
  section.querySelectorAll('[data-action="evidence-pick"]').forEach(el => el.setAttribute('aria-describedby', dialogContext.photoError ? 'evidence-help evidence-error' : 'evidence-help'));
}

async function prepareEvidencePhoto(file) {
  const accepted = ['image/jpeg', 'image/png', 'image/webp'];
  if (!accepted.includes(file.type) && !(file.type === '' && /\.(jpe?g|png|webp)$/i.test(file.name))) throw new Error('请选择 JPG、PNG 或 WebP 图片。当前格式无法读取时，可拍照重试。');
  if (!file.size || file.size > 15 * 1024 * 1024) throw new Error('单张原图请控制在 15 MB 以内，或拍照重试。');
  const url = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = url;
    try { await image.decode(); } catch { throw new Error('这张图片无法读取，请重新拍照或选择其他图片。'); }
    const scale = Math.min(1, EVIDENCE_LIMITS.maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('浏览器暂时无法处理照片，请重新打开页面后再试。');
    paint.fillStyle = '#fff'; paint.fillRect(0, 0, width, height);
    paint.drawImage(image, 0, 0, width, height);
    for (const quality of [0.82, 0.68, 0.52, 0.36, 0.24]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const bytes = Math.ceil((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);
      if (bytes <= EVIDENCE_LIMITS.maxBytes) return {id: `photo-${++nextPhoto}`, name: `${file.name.replace(/\.[^.]*$/, '').slice(0, 110) || '服务照片'}.jpg`, dataUrl, width, height};
    }
    throw new Error('这张照片处理后仍然过大，请更换图片或重新拍照。');
  } finally { URL.revokeObjectURL(url); }
}

async function addEvidencePhotos(input) {
  const context = dialogContext;
  const files = [...input.files];
  input.value = '';
  if (!context || !files.length || context.photoBusy || $('#sheet-body form')?.dataset.busy === 'true') return;
  context.photoError = '';
  const existing = context.evidencePhotos || [];
  if (existing.length + files.length > EVIDENCE_LIMITS.maxCount) {
    context.photoError = `每次最多留 ${EVIDENCE_LIMITS.maxCount} 张，请减少选择数量。已添加的照片仍保留。`;
    updateEvidencePicker(); return;
  }
  context.photoBusy = true; updateEvidencePicker();
  try {
    const prepared = [];
    for (const file of files) {
      const photo = await prepareEvidencePhoto(file);
      if (context !== dialogContext) return;
      if (![...existing, ...prepared].some(p => p.dataUrl === photo.dataUrl)) prepared.push(photo);
    }
    if (!prepared.length) context.photoError = '所选照片已经添加，无需重复选择。';
    context.evidencePhotos = [...existing, ...prepared];
    saveDraft();
  } catch (error) { if (context === dialogContext) context.photoError = error.message; }
  finally { context.photoBusy = false; if (context === dialogContext) updateEvidencePicker(); }
}

function showPhoto(photo, title, caption) {
  photoFocusBefore = document.activeElement;
  $('#photo-title').textContent = title;
  $('#photo-image').src = photo.dataUrl;
  $('#photo-image').alt = title;
  $('#photo-caption').textContent = caption;
  $('#photo-viewer .icon-button').innerHTML = icon('x', 22);
  photoViewer.showModal();
  $('#photo-viewer .icon-button').focus();
}
function closePhoto() { if (photoViewer.open) photoViewer.close(); }
photoViewer.addEventListener('close', () => {
  $('#photo-image').removeAttribute('src');
  if (photoFocusBefore?.isConnected) photoFocusBefore.focus();
  photoFocusBefore = null;
});

function clientDialog(id) {
  const c = assertClient(id);
  const next = appointments(id)[0];
  return {title: `${c.name}的客户档案`, html: `<div class="detail-grid">${pair('负责康复师',name('therapists',c.ownerId))}${pair('所属门店',name('stores',c.storeId))}${pair('手机号',c.phone)}${pair(name('stores',c.storeId)+'剩余',`${model.remainingInStore(id,c.storeId)} 次`)}</div>${c.openingNotes ? `<div class="note"><strong>期初核对依据</strong><p>${esc(c.openingNotes)}</p></div>` : ""}<h3>${esc(c.goal)}</h3><p>${esc(c.phase)} · ${esc(c.nextStep)}</p><div class="action-row">${button('完整计划','plan',id,'btn-outline')}${button('评估记录','assessment-history',id,'btn-outline')}${button('登记评估数据','assessment-create',id,'btn-outline')}${button('套餐次数','package',id,'btn-outline')}${role.type==='boss'?button('办理本店套餐','create-store-package',id,'btn-outline')+button('指定各店执行师','assign-store-therapist',id,'btn-outline'):''}${button('预约记录','appointment-history',id,'btn-outline')}${role.type === 'boss' && c.packageId && !find('packages',c.packageId)?.closed && model.remaining(id) === 0 ? button('续接新套餐','renew-package',id,'btn-primary') : ''}${canEditPlan(c) ? button('更新计划','edit-plan',id,'btn-outline') : ''}</div><h3>下一次服务</h3>${next ? `<p>${date(next.date)} ${next.time} · ${esc(next.project)}</p><p class="meta">${esc(name('therapists',next.principalId))} · ${esc(name('stores',next.storeId))}</p><div class="action-row">${button('改约','appointment-edit',next.id)}${button('取消预约','appointment-cancel',next.id,'btn-quiet')}</div>` : '<p class="muted">暂无待服务安排</p>'}<div class="action-row">${button('登记已完成服务','register',id,'btn-primary','plus')}${button('安排下次服务','appointment-create',id,'btn-outline','calendar')}${button('与朋友一起预约','appointment-batch',id,'btn-outline')}</div><h3>服务历史</h3>${clientServices(id).map(s => `<div class="row"><div><strong>${date(s.date)} · ${esc(s.project)}</strong><p class="meta">${esc(name('therapists',s.principalId))} · ${esc(name('stores',s.storeId))} · ${s.status === 'valid' ? '已完成' : '已撤销'}</p></div>${link('明细','service-detail',s.id)}</div>`).join('') || '<p class="muted">暂无新增服务记录</p>'}${role.type === 'boss' ? `<div class="action-row">${link('转交负责人','transfer-client',id)}${link('操作留痕','client-audit',id)}</div>` : ''}`};
}
function appointmentDialog(id) {
  const c = currentClient();
  if (role.type === 'therapist' && !id) throw new Error('请选择需要查看的客户预约');
  const a = id ? find('appointments',id) : appointments(c.id)[0];
  if (role.type === 'therapist' && !a) throw new Error('客户预约不存在');
  if (!a) return {title: '下一次服务', html: `<p>暂无预约安排。</p><p class="muted">下次服务的时间、康复师与门店确认后会显示在首页。</p>${button('查看门店信息','stores',c.id)}`};
  assertClient(a.clientId);
  model.assertTherapistAppointment(role,a);
  const store = find('stores',a.storeId);
  if (role.type === 'therapist') {
    const labels = {confirmed:'已确认',reschedule_requested:'改约待确认',pending_reassignment:'服务人员待确认',completed:'已服务',cancelled:'已取消',no_show:'未到店'};
    const status = labels[a.status] || '预约状态待核对';
    const notes = a.status === 'reschedule_requested' ? `<div class="note"><strong>客户申请改约，原时间仍保留</strong><p>希望调整到 ${date(a.request?.date)} ${esc(a.request?.time || '')}</p><p>改约说明：${esc(a.requestNote || a.request?.reason || '未填写说明')}</p></div>` : a.status === 'cancelled' ? `<p class="notice">取消说明：${esc(a.cancelReason || '未填写说明')}。本次未扣次数。</p>` : a.status === 'no_show' ? `<p class="notice">未到店说明：${esc(a.noShowReason || '未填写说明')}。本次未扣次数。</p>` : a.status === 'pending_reassignment' ? '<p class="notice">原服务人员需要重新安排，请由有权限的工作人员确认。</p>' : '';
    return {title:'客户预约详情',html:`<span class="tag ${a.status==='completed'?'tag-green':['reschedule_requested','pending_reassignment','no_show'].includes(a.status)?'tag-warn':''}">${esc(status)}</span><h3>${esc(name('clients',a.clientId))} · ${date(a.date)} ${esc(a.time)}</h3><div class="detail-grid">${pair('服务项目',a.project)}${pair('服务门店',store.name)}${pair('主康复师',name('therapists',a.principalId))}${pair('协作康复师',(a.participantIds || []).map(t=>name('therapists',t)).join('、') || '无')}</div>${a.groupId?'<p class="meta">同行预约 · 本页显示这位客户的独立服务安排。</p>':''}${notes}<p class="meta">查看预约不扣次数、不记收款；完成服务并登记后才产生消费业绩。</p><div class="action-row">${button('查看客户档案','client-detail',a.clientId,'btn-outline')}${button('查看全部预约','appointment-history',a.clientId,'btn-primary')}</div>`};
  }
  if (!['confirmed','reschedule_requested'].includes(a.status)) {
    const label={cancelled:'预约已取消',completed:'本次服务已完成',no_show:'本次未到店',pending_reassignment:'服务人员待确认'}[a.status] || '预约状态待核对';
    const explanation=a.status==='pending_reassignment'?'门店需要重新确认服务人员，请收到新安排后再到店。':a.status==='completed'?'本次服务已完成，请查看服务记录。':'此安排无需按原时间到店，可重新提交预约申请。';
    return {title:label,html:`<h3>${date(a.date)} · ${esc(a.time)}</h3><p>${esc(a.project)} · ${esc(store.name)}</p><p class="notice">${explanation}</p><div class="action-row">${role.type==='customer'?button('查看预约记录','appointment-history',a.clientId,'btn-outline'):''}${a.status==='completed'&&a.serviceId?button('查看服务记录','service-detail',a.serviceId,'btn-outline'):role.type==='customer'?button('预约康复','customer-booking',a.clientId,'btn-primary'):''}</div>`};
  }
  return {title: '下一次服务安排', html: `<h3>${date(a.date)} ${weekday(a.date)} · ${esc(a.time)}</h3><p>${esc(a.project)}</p><div class="detail-grid">${pair('服务康复师',name('therapists',a.principalId))}${pair('服务门店',store.name)}</div><p class="muted">${esc(store.address)}</p>${a.groupId?'<p class="meta">同行预约 · 这是您本人的服务安排，调整时仅修改您的预约。</p>':''}<p class="notice">按当前服务安排到店，完成服务后才扣套餐次数。</p>${a.status === 'reschedule_requested' ? `<div class="note"><strong>改约申请待确认</strong><p>希望调整到 ${date(a.request.date)} ${a.request.time}</p><p>${esc(a.request.reason)}</p><p class="meta">工作人员确认前，原预约时间仍保留。</p></div>` : ''}<div class="action-row">${button(a.status === 'reschedule_requested' ? '修改改约申请' : '申请调整时间','reschedule',a.id,'btn-primary','calendar')}${button(a.cancellationRequest?.status==='pending'?'查看取消申请':'申请取消预约','appointment-cancel-request',a.id,'btn-quiet')}${button('查看门店信息','stores',a.clientId)}</div>`};
}
function reviewDialog(id) {
  const s = assertService(id);
  if (role.type !== 'customer' || role.id !== s.clientId) throw new Error('只有客户本人可以填写评价');
  const r = reviewFor(id);
  if (r) return {title: '我的服务评价', html: `<div class="notice" role="note"><strong>评价仅老板可见</strong><p>除您本人外，评分和文字反馈仅老板可查看，康复师和前台无法查看，店长也无法查看。请放心填写真实体验。</p></div><div class="review-score"><strong>${r.score}</strong><span> / 5 分</span></div><p>${esc(r.feedback || '您没有填写文字反馈。')}</p><p class="meta">${date(s.date)} · ${esc(s.project)} · ${esc(name('therapists',s.principalId))}</p>${r.followupStatus === 'pending' ? '<div class="notice">您的反馈已交给老板，等待老板进一步了解情况。</div>' : r.followupStatus === 'closed' ? `<div class="note"><strong>已完成回访</strong><p>${esc(r.resolution)}</p></div>` : '<p class="notice">感谢您的反馈，我们会持续完善每次服务。</p>'}`};
  if (s.status !== 'valid') throw new Error('已撤销的服务不能评价');
  return {title: '这次服务体验怎么样？', html: form('review', `${hidden('serviceId',id)}<p class="muted">${date(s.date)} · ${esc(s.project)} · ${esc(name('therapists',s.principalId))}</p><div class="notice" role="note"><strong>评价仅老板可见</strong><p>除您本人外，评分和文字反馈仅老板可查看，康复师和前台无法查看，店长也无法查看。请放心填写真实体验。</p></div><fieldset class="field"><legend>请为本次服务评分</legend><div class="star-picker">${[1,2,3,4,5].map(n => `<label class="star-option"><input type="radio" name="score" value="${n}" required aria-label="${n} 分">${icon('star',30)}<span>${n} 分</span></label>`).join('')}</div></fieldset>${textarea('您的反馈（可选）','feedback','','maxlength="1000" placeholder="哪里帮助到了您？还有什么需要改进？"')}<label class="check"><input type="checkbox" name="wantContact"><span>希望老板联系我，进一步了解情况</span></label><p class="meta">您的真实反馈会帮助我们改进后续服务。</p>`,'提交评价')};
}
function requestDialog(id) {
  const a = find('appointments',id);
  if (!a || role.type !== 'customer' || a.clientId !== role.id) throw new Error('您没有调整该预约的权限');
  return {title: '申请调整服务时间', html: form('reschedule', `${hidden('appointmentId',id)}<div class="note">当前预约：${date(a.date)} ${a.time} · ${esc(name('stores',a.storeId))}</div><div class="form-grid">${field('希望调整到的日期','date',a.request?.date || a.date,'date',`required min="${TODAY}"`)}${hourTimeField(a.request?.time || a.time,esc)}${textarea('改约说明','reason',a.request?.reason || '','required maxlength="500" placeholder="请说明您的时间安排"')}</div><p class="meta">工作人员确认前，原预约仍保留。申请本身不会扣除次数。</p>`,'提交改约申请')};
}
function auditDialog(id, plansOnly = false) {
  assertClient(id);
  if (!plansOnly) assertBoss();
  const rows = model.state.audit.filter(a => a.clientId === id && (!plansOnly || a.type === 'plan_published'));
  const titles = {service_registered:'服务登记',service_revoked:'服务撤销',plan_published:'计划更新',appointment_saved:'预约安排',appointment_cancelled:'取消预约',reschedule_requested:'客户改约申请',task_completed:'待办完成',review_submitted:'服务评价',review_followup_closed:'回访完成',client_transferred:'负责人转交',reception_client_created:'新客户建档',paper_intake_created:'初访与服务前确认',paper_intake_reviewed:'接待表专业复核',opening_import:'纸质期初档案录入',package_renewed:'套餐续接',package_activated:'切换使用套餐',appointment_no_show:'未到店记录'};
  return {title: plansOnly ? '计划更新记录' : '客户操作留痕', html: rows.length ? rows.map(a => `<div class="record-item"><strong>${titles[a.type] || '档案更新'}</strong><p class="meta">${esc(a.actorType==='boss'?'老板':a.actorType==='manager'?name('storeManagers',a.actorId):a.actorType==='frontdesk'?name('frontDesks',a.actorId):name('therapists',a.actorId) === '待安排' ? name('clients',a.actorId) : name('therapists',a.actorId))} · ${esc(new Date(a.createdAt).toLocaleString('zh-CN'))}</p>${a.type === 'plan_published' ? `<p>第 ${a.after.planVersion} 版 · ${esc(a.after.phase)}</p><p>${esc(a.after.nextStep)}</p>` : `<p>${esc(a.reason || a.resolution || a.sourceNotes || a.notes || a.note || '变更已保存')}</p>`}</div>`).join('') : '<p class="empty">当前示例还没有更新记录。</p>'};
}
function storesDialog(id) {
  assertClient(id);
  return {title: '门店与服务安排', html: `<p class="muted">两店套餐各自使用，请按已确认预约的门店到店。</p>${model.state.stores.map(store => `<div class="record-item"><h3>${esc(store.name)}</h3><p>${esc(store.address)}</p><p class="meta">${model.state.therapists.filter(t => t.active && t.storeId === store.id).map(t => esc(t.name)).join('、') || '人员待安排'}</p></div>`).join('')}<p class="notice">以上地址为虚构示例，正式版会接入真实门店地址与导航。</p>`};
}
function tourDialog() {
  return {title: '试一遍完整服务流程', html: `<p>建议先用许安然的 3,000 元 / 10 次套餐体验，初始剩余 10 次。</p><div class="plan-timeline"><div class="timeline-item"><span class="timeline-dot"></span><div><h3>1. 看客户首页</h3><p class="muted">查看计划、负责康复师和剩余次数。</p>${button('以许安然身份查看','tour-customer','','btn-outline')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>2. 登记一次服务</h3><p class="muted">以周亦宁登记，在崂山店服务，选择两位协作人员，填写服务小结并添加测试照片。剩余次数变为 9。</p>${button('打开服务登记','tour-register','','btn-primary')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>3. 核对业绩与明细</h3><p class="muted">主康复师增加 300 元，协作人员保留参与记录；全店业绩只增加 300 元。</p>${button('查看老板概览','tour-boss','','btn-outline')}</div></div><div class="timeline-item"><span class="timeline-dot"></span><div><h3>4. 体验评价和撤销</h3><p class="muted">切回客户填写评价；老板可在服务明细填写原因后撤销，次数和业绩同步恢复。</p>${button('查看客户服务记录','tour-records','','btn-outline')}</div></div></div>`};
}

const evaluationTypes = new Set(['assessment-create','assessment-history','assessment-detail','assessment-confirm','assessment-void','frontdesk-work','frontdesk-evaluate','frontdesk-evaluation-detail','frontdesk-evaluation-void']);
const staffTypes = new Set(['register','edit-plan','appointment-create','appointment-edit','followup','add-store','add-therapist','add-frontdesk','transfer-client','import-opening','revoke-service','register-appointment','renew-package']);
function buildDialog(type, id) {
  if(type==='boss-decision-detail')return bossDecisionDialog(id,ctx());
  if(type==='multi-day-booking')return multiDayBookingDialog(id,role.type==='customer'?customerCtx():ctx());
  if(workflowTypes.has(type))return workflowDialog(type,id,ctx());
  if(['add-therapist','add-frontdesk','add-manager','edit-therapist','edit-frontdesk','edit-manager'].includes(type))return personnelDialog(type,id,ctx());
  if(['schedule-edit','schedule-request','schedule-decision','schedule-notification'].includes(type))return scheduleDialog(type,id,ctx());
  if (customerBookingTypes.has(type)) return customerRequestDialog(type,id,customerCtx());
  if(['link-receipt-package','cash-closing','cash-closing-confirm'].includes(type))return cashDialog(type,id,ctx());
  if(role.type==='manager') {
    model.managerStoreId(role);
    if(type.startsWith('manager-'))return managerDialog(type,id,ctx());
    if(!['tour','mini-info','reception-client','paper-intake-detail','paper-intake-list'].includes(type))throw new Error('店长仅有本店监管只读权限，其他资料监管查看，请由对应工作人员处理');
  } else if(type.startsWith('manager-'))throw new Error('此页面仅店长可查看');
  if(['paper-intake-create','paper-intake-detail','paper-intake-review','paper-intake-list'].includes(type))return paperIntakeDialog(type,id,ctx());
  if(['reception-create-client','reception-client'].includes(type))return receptionIntakeDialog(type,id,ctx());
  if(type==='create-store-package') {
    assertBoss();const client=assertClient(id);
    return {title:'办理本店套餐',html:form(type,hidden('clientId',id)+'<p><strong>'+esc(client.name)+'</strong></p><p class="notice">选定所属门店后，套餐只能在该店消课。此操作只建立套餐，不记收款；已收到的钱需另行登记，避免收入重复。</p><div class="form-grid"><label class="field"><span>套餐所属门店</span><select name="storeId" required>'+model.state.stores.map(store=>'<option value="'+esc(store.id)+'"'+(store.id===client.storeId?' selected':'')+'>'+esc(store.name)+'</option>').join('')+'</select></label>'+field('套餐名称','name','运动功能恢复套餐','text','required maxlength="80"')+field('套餐总次数','total','','number','required min="1" max="999" step="1" placeholder="例如 60"')+field('实际套餐金额（元）','amount','','number','required min="0.01" step="0.01" placeholder="例如 24000 或 25200"')+'</div>','建立本店套餐')};
  }
  if(type==='deactivate-manager') {
    assertBoss();const manager=find('storeManagers',id);if(!manager?.active)throw new Error('请选择在职店长');
    return {title:'停用店长账号',html:form(type,`${hidden('id',id)}<p>停用 ${esc(manager.name)} 后，该账号无法查看本店工作；历史业务记录保留。</p>`,'确认停用')};
  }
  if(type==='import-opening-batch') { assertBoss();return {title:'表格批量录入旧客户',html:'<p class="muted" role="status">正在加载本地表格检查工具…</p>'}; }
  if(role.type==='frontdesk'&&!['reception-appointment-list','record-receipt','cash-ledger','receipt-detail','refund-detail','settle-receipt','record-arrival','appointment-batch','appointment-create','appointment-edit','appointment-cancel','appointment-no-show','assessment-create','assessment-history','assessment-detail','frontdesk-work','frontdesk-evaluation-detail','reset','tour','mini-info'].includes(type))throw new Error('此操作由康复师或老板处理');
  if(evaluationTypes.has(type))return evaluationDialog(type,id,ctx());
  if(type==='appointment-batch') {
    if(role.type==='customer')throw new Error('一起预约请联系前台安排');
    if(id)assertClient(id);
    return appointmentBatchDialog(id,ctx());
  }
  if(['record-arrival','reception-appointment-list'].includes(type))return receptionDialog(type,id,ctx());
  if (['record-receipt','cash-ledger','receipt-detail','refund-detail','refund-receipt','settle-receipt','void-receipt','void-refund'].includes(type)) {
    return cashDialog(type,id,ctx());
  }
  if (staffTypes.has(type)) {
    if((role.type==='manager'&&type==='appointment-create') || (role.type==='frontdesk'&&['appointment-create','appointment-edit'].includes(type))) {
      if(type==='appointment-edit')assertReceptionAppointment(ctx(),id);
    } else assertStaff();
    if (['followup','add-store','add-therapist','add-frontdesk','transfer-client','import-opening','revoke-service','renew-package'].includes(type)) assertBoss();
    if (type==='renew-package') assertClient(find('packages',id)?.clientId || id);
    if (['edit-plan','transfer-client'].includes(type) || (type === 'register' && id)) assertClient(id);
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
  if (type === 'package-store') {const [clientId,storeId]=id.split(':');assertClient(clientId);if(!find('stores',storeId))throw new Error('门店不存在');return packageDialog(clientId,storeId);}
  if (type === 'package-history') return packageHistoryDialog(id);
  if (type === 'appointment-history') return appointmentHistoryDialog(id);
  if (type === 'activate-package') {
    assertBoss(); const p = find('packages',id); if (!p) throw new Error('套餐不存在'); assertClient(p.clientId);
    return {title:'切换当前使用套餐',html:form('activate-package',`${hidden('packageId',id)}<div class="note"><strong>${esc(p.name)} · 剩余 ${model.packageRemaining(id)} 次</strong><p>此套餐将作为当前使用套餐。其他套餐的余额和历史消费记录各自保留。</p></div>${textarea('切换原因','reason','','required maxlength="500" placeholder="例如：旧服务撤销后，确认先使用原套餐恢复的次数"')}`,'确认切换使用套餐')};
  }
  if (type === 'appointment-no-show') {
    if(role.type==='frontdesk')assertReceptionAppointment(ctx(),id);else assertStaff(); const a = find('appointments',id); if (!a) throw new Error('预约不存在'); model.assertTherapistAppointment(role,a); assertClient(a.clientId);
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
    if(role.type==='frontdesk')assertReceptionAppointment(ctx(),id);else assertStaff();
    const a = find('appointments',id); assertClient(a?.clientId);
    return {title:'取消预约',html:form('appointment-cancel',`${hidden('id',id)}<p>${esc(name('clients',a.clientId))} · ${date(a.date)} ${a.time}</p>${textarea('取消说明','reason','','required maxlength="500"')}`,'确认取消预约')};
  }
  if (type === 'privacy') {
    assertClient(id);
    return {title:'我的档案与隐私',html:'<p>客户端查看本人的计划、套餐与服务记录。康复师查看自己负责或实际参与服务的客户，老板统一管理各店记录。</p><p>服务留底照片由客户本人、当前负责康复师、本次主/协作康复师及老板查看。店长仅查看实际在本店服务的留底照片。参与该客户其他服务，不会自动获得本次照片权限。</p><p>除客户本人外，服务评分、文字反馈和老板的回访记录仅老板可查看，康复师和前台无法查看，店长也无法查看。</p><p class="muted">本次预览使用虚构数据，角色切换仅用于体验。正式版本需要真实身份验证和服务器权限校验。</p>'};
  }
  if (type === 'help') {
    assertClient(id);
    const last = clientServices(id).find(s => s.status === 'valid');
    return {title:'反馈与帮助',html:`<h3>您的负责康复师：${esc(name('therapists',find('clients',id).ownerId))}</h3><p>调整到店时间，可在下一次服务中申请改约。对已完成服务有建议，可填写评价并勾选“希望老板联系我”。除您本人外，评分与文字反馈仅老板可查看，康复师和前台无法查看，店长也无法查看。</p><div class="action-row">${role.type === 'customer' ? button('查看预约','appointment',appointments(id)[0]?.id || '','btn-outline') : ''}${last && role.type === 'customer' ? button('反馈最近一次服务','review',last.id,'btn-primary') : ''}</div><p class="muted">正式版本会补充真实客服电话和微信联系入口。</p>`};
  }
  if (type === 'mini-info') return {title:'涛博士 · 客户体验预览',html:'<p>您可以体验预约康复、查看剩余次数、康复计划、服务记录与评价。</p><p class="muted">所有姓名与服务安排均为虚构示例。预约申请、评价和改约仅用于体验，刷新后恢复示例，不会提交给门店。微信登录、真实档案和消息提醒将在正式版本启用。</p>'};
  if (type === 'reset') return {title:'重置示例数据',html:form('reset','<p>将恢复初始的两家门店、五名康复师和虚构客户。本次预览中新增的记录与草稿会清除。</p>','恢复初始示例')};
  if (type === 'deactivate-therapist') {
    assertBoss();
    return {title:'停用康复师',html:form('deactivate-therapist',`${hidden('id',id)}<p>停用 ${esc(name('therapists',id))} 前，需要先转交负责客户、处理预约和待办。历史服务归属保留。</p>`,'检查并停用')};
  }
  if(type==='deactivate-frontdesk') {
    assertBoss();const row=find('frontDesks',id);if(!row)throw new Error('前台账号不存在');
    return {title:'停用前台账号',html:form(type,`${hidden('id',id)}<p>停用 ${esc(row.name)} 后，不能再接待、安排预约或录入收款；历史接待和收款记录保留。</p>`,'确认停用')};
  }
  return null;
}
function draftKey(type,id) { return `${role.type}:${role.id}:${type}:${id}`; }
function saveDraft() {
  if (!dialogContext || !sheet.open) return;
  if(dialogContext.type==='import-opening-batch')return;
  const el = $('#sheet-body form');
  if (!el || el.dataset.succeeded) return;
  const entries = [...new FormData(el).entries()].filter(([, value]) => typeof value === 'string');
  drafts.set(dialogContext.key,{entries,requestId:dialogContext.requestId,evidencePhotos:(dialogContext.evidencePhotos || []).map(photo => ({...photo}))});
}
function restoreDraft(saved) {
  if (!saved) return;
  const f = $('#sheet-body form');
  if (!f) return;
  for (const el of f.elements) {
    if (!el.name || el.type === 'file') continue;
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
  dialogContext?.legacyController?.destroy();
  const key = draftKey(type,id);
  let saved = type==='import-opening-batch'?null:drafts.get(key);
  if(saved && ['edit-therapist','edit-frontdesk','edit-manager'].includes(type)) {
    const collection={ 'edit-therapist':'therapists','edit-frontdesk':'frontDesks','edit-manager':'storeManagers' }[type];
    const latest=model.state[collection].find(person=>person.id===id)?.profileVersion ?? 0;
    const drafted=saved.entries.find(([name])=>name==='expectedVersion')?.[1];
    if(String(latest)!==String(drafted)){drafts.delete(key);saved=null;toast('人员资料已更新，已打开最新资料，请重新核对后填写。');}
  }
  dialogContext = {type,id,key,requestId:saved?.requestId || `preview-${++nextRequest}`,evidencePhotos:(saved?.evidencePhotos || []).map(photo => ({...photo})),photoBusy:false,photoError:''};
  $('#sheet-title').textContent = content.title;
  $('#sheet-body').innerHTML = content.html;
  sheet.classList.toggle('evidence-sheet', Boolean($('#sheet-body [data-evidence-section]') || type === 'service-detail'));
  sheet.classList.toggle('legacy-sheet',type==='import-opening-batch');
  $('.sheet-head .icon-button').innerHTML = icon('x',22);
  restoreBookingDraft($('#sheet-body form'),saved,ctx());
  restoreMultiDayBookingDraft($('#sheet-body form'),saved,ctx());
  restoreDraft(saved);
  restoreReceptionIntakeDraft($('#sheet-body form'),saved,ctx());
  updateCustomerBookingForm($('#sheet-body form'),customerCtx());
  updateCashFields($('#sheet-body form'));
  updateCashPackageChoices($('#sheet-body form'),ctx());
  constrainEvaluationChoices();
  constrainStaffChoices(type,id);
  updateBookingMembers($('#sheet-body form'),ctx());
  updateServicePackageChoices($('#sheet-body form'),ctx());
  updateWorkflowForm($('#sheet-body form'),ctx());
  updateReceptionIntakeChoices($('#sheet-body form'),ctx());
  updatePaperIntakeForm($('#sheet-body form'),ctx());
  updateScheduleForm($('#sheet-body form'),ctx());
  updateAppointmentAvailability($('#sheet-body form'),ctx());
  updateMultiDayBookingForm($('#sheet-body form'),ctx());
  if(type==='reception-create-client'&&$('#sheet-body form')?.elements.phone?.value)checkReceptionIntakePhone($('#sheet-body form'));
  if (['register','register-appointment'].includes(type)) {
    updateParticipants();
    const collaborators = $('#sheet-body .ease-register-collabs');
    if (collaborators && collaborators.querySelector('input:checked')) collaborators.open = true;
    updateEvidencePicker();
  }
  if (!sheet.open) { focusBeforeDialog = document.activeElement; sheet.showModal(); }
  $('#sheet-body').scrollTop = 0;
  // Focus the dialog heading to avoid opening a mobile keyboard on read-only views.
  $('#sheet-title').tabIndex = -1;
  $('#sheet-title').focus();
  if(type==='import-opening-batch')void loadLegacyDialog(dialogContext);
}
async function loadLegacyDialog(context) {
  const active=()=>context===dialogContext&&sheet.open&&role.type==='boss'&&role.id==='boss';
  try {
    const legacy=await import('./legacy.js?v=20261010-assessor-personnel-1');
    if(!active())return;
    $('#sheet-body').innerHTML=legacy.legacyDialog(ctx()).html;
    context.legacyController=legacy.mountLegacyForm({form:$('#sheet-body form'),getModel:()=>model,getRole:()=>role,isActive:active,
      applyModel:candidate=>{model=candidate;},
      beforeCommit:async()=>{
        await new Promise(resolve=>setTimeout(resolve,160));
        if(active()&&$('#network-toggle').checked){$('#network-toggle').checked=false;throw new Error('模拟提交失败：整批未录入，修正后可重新确认。');}
      },
      onSuccess:outcome=>{
        filters.query='';render();
        showSuccess(`已录入 ${outcome.importedCount} 位虚构客户`,`<p>这批客户已加入本次演示，套餐余额已保留。</p><p class="notice">未追记历史服务、消费业绩或实收。刷新页面会恢复初始示例。</p>${button('查看客户列表','nav','clients','btn-outline')}`);
      }});
  } catch(error) { if(active())$('#sheet-body').innerHTML=`<p class="form-error" role="alert">${esc(error.message || '表格工具暂未加载，请关闭后重新打开。')}</p>`; }
}
function closeDialog(keepDraft = true) {
  closePhoto();
  if (keepDraft) saveDraft();
  dialogContext?.legacyController?.destroy();
  if (sheet.open) sheet.close();
  dialogContext = null;
  if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus();
}
function showSuccess(title,html) {
  closePhoto();
  dialogContext?.legacyController?.destroy();
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
    if(action==='schedule-notification-read'){markScheduleNotificationRead(model,id,role);render();openDialog('schedule-notification',id);toast('已标为已读，变更记录保留');return;}
    if(['multi-day-add','multi-day-remove','multi-day-back'].includes(action)){
      const f=$('#sheet-body form');if(dialogContext?.type!=='multi-day-booking'||f?.dataset.busy==='true')return;
      if(action==='multi-day-add')addMultiDayBookingRow(f,ctx());
      else if(action==='multi-day-remove')removeMultiDayBookingRow(target.closest('[data-multi-day-row]'),f,ctx());
      else if(Number(f.dataset.step)===1)return closeDialog();
      else {f.dataset.step='1';updateMultiDayBookingForm(f,ctx());}
      saveDraft();return;
    }
    if (['booking-add','booking-remove'].includes(action)) {
      const f = $('#sheet-body form');
      if(dialogContext?.type!=='appointment-batch'||f?.dataset.busy==='true')return;
      if(action==='booking-add')addBookingMember(f,ctx());
      else removeBookingMember(target.closest('[data-booking-member]'),f,ctx());
      updateAppointmentAvailability(f,ctx());
      saveDraft(); return;
    }
    if (action === 'close-photo') return closePhoto();
    if (action === 'evidence-pick') {
      assertStaff();
      if (!['register','register-appointment'].includes(dialogContext?.type) || dialogContext.photoBusy || $('#sheet-body form')?.dataset.busy === 'true') return;
      const picker = $('#sheet-body [data-evidence-picker="' + (id === 'camera' ? 'camera' : 'album') + '"]');
      if (picker && !picker.disabled) picker.click();
      return;
    }
    if (action === 'remove-photo' || action === 'draft-photo') {
      assertStaff();
      if (!['register','register-appointment'].includes(dialogContext?.type) || dialogContext.photoBusy || $('#sheet-body form')?.dataset.busy === 'true') return;
      const photo = dialogContext.evidencePhotos.find(p => p.id === id);
      if (!photo) throw new Error('照片不存在，请重新选择。');
      if (action === 'draft-photo') return showPhoto(photo,'待保存的留底照片',`${photo.name} · 尚未提交消课`);
      dialogContext.evidencePhotos = dialogContext.evidencePhotos.filter(p => p.id !== id);
      dialogContext.photoError = ''; saveDraft(); updateEvidencePicker(); return;
    }
    if (action === 'service-photo') {
      const service = assertService(id);
      if (!model.canSeeEvidence(role, id)) throw new Error('您没有查看本次留底照片的权限');
      const photo = service.evidencePhotos?.find(p => p.id === target.dataset.photoId);
      if (!photo) throw new Error('照片不存在');
      return showPhoto(photo,`${name('clients',service.clientId)}的留底照片`,`${date(service.date)} ${service.time} · ${name('stores',service.storeId)} · ${service.project}${service.status === 'revoked' ? ' · 本次消课已撤销，原照片保留' : ''}`);
    }
    if (action === 'customer-booking-back') {
      const f=$('#sheet-body form');
      if (dialogContext?.type!=='customer-booking' || f?.dataset.busy==='true') return;
      const step=Number(f.dataset.step);
      if(step===1)return closeDialog();
      f.dataset.step=String(step-1);updateCustomerBookingForm(f,customerCtx());
      const heading=f.querySelector('[data-booking-step="'+(step-1)+'"] h3');heading.tabIndex=-1;heading.focus();saveDraft();return;
    }
    if(action==='reception-check-phone')return checkReceptionIntakePhone($('#sheet-body form'),true);
    if (action === 'close-dialog') return closeDialog();
    if (action === 'nav') {
      const allowed = role.type === 'customer' ? ['home','records','profile'] : role.type === 'boss' ? ['overview','clients','performance','team','schedules'] : role.type==='frontdesk'?['reception','reception-assessments','cash','reception-clients','schedules']:role.type==='manager'?['manager-overview','manager-appointments','manager-clients','manager-records','manager-team','schedules']:['work','therapist-appointments','clients','performance','schedules'];
      if (!allowed.includes(id)) throw new Error('该页面不可访问');
      closeDialog(); view = id; render(true); return;
    }
    if (action === 'reset-filters') { filters = {storeId:'',therapistId:'',from:'',to:'',query:''}; render(); return; }
    if (action === 'manager-clear-filters') {
      model.managerStoreId(role);filters={...filters,from:'',to:''};render();return;
    }
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
      if (task?.type === 'appointment_cancellation') return openDialog('appointment-cancel-handle',task.appointmentId);
      return openDialog('task-complete',id);
    }
    if (action === 'tour-customer') return switchRole('customer:c2');
    if (action === 'tour-register') { switchRole('therapist:t2'); openDialog('register','c2'); $('#sheet-body [name="storeId"]').value = 'b'; return; }
    if (action === 'tour-boss') return switchRole('boss:boss');
    if (action === 'tour-records') return switchRole('customer:c2','records');
    if (action === 'export-preview') return exportPreview();
    openDialog(action,id);
  } catch (error) { toast(error.message); }
});
function checkReceptionIntakePhone(f,reportInvalid=false) {
  if(f?.dataset.form!=='reception-create-client'||f.dataset.busy==='true')return;
  const phone=f.elements.phone;
  const output=f.querySelector('[data-intake-duplicates]');
  f.dataset.duplicate='false';
  if(!phone.checkValidity()) {
    output.innerHTML='';updateReceptionIntakeChoices(f,ctx());
    if(reportInvalid)phone.reportValidity();return;
  }
  try {
    const result=model.findReceptionDuplicates(phone.value,role);
    f.dataset.duplicate=String(result.duplicate);output.innerHTML=receptionDuplicateMarkup(result,ctx());
    updateReceptionIntakeChoices(f,ctx());saveDraft();
  } catch(error){formError(f,error.message);}
}
document.addEventListener('input', event => {
  const f=event.target.closest('form');
  updatePaperIntakeForm(f,ctx());
  updateScheduleForm(f,ctx());
  if(f?.dataset.form==='multi-day-booking'&&event.target.name==='project')updateMultiDayBookingForm(f,ctx());
  if(f?.dataset.form==='reception-create-client'&&event.target.name==='phone') {
    f.dataset.duplicate='false';f.querySelector('[data-intake-duplicates]').innerHTML='';
    updateReceptionIntakeChoices(f,ctx());
  }
});
document.addEventListener('change', event => {
  const intakeForm=event.target.closest('form');
  updatePaperIntakeForm(intakeForm,ctx());
  updateScheduleForm(intakeForm,ctx());
  if(intakeForm?.dataset.form==='reception-create-client'){
    if(event.target.name==='phone')checkReceptionIntakePhone(intakeForm);
    else if(['storeId','ownerId'].includes(event.target.name))updateReceptionIntakeChoices(intakeForm,ctx());
  }
  if (event.target.matches('[data-booking-client],[data-booking-principal]')) updateBookingMembers(event.target.closest('form'),ctx());
  if (['channel','settlementStatus','purpose'].includes(event.target.name)) updateCashFields(event.target.closest('form'),event.target.name);
  if (['channel','clientId','storeId','purpose','packageId'].includes(event.target.name)) updateCashPackageChoices(event.target.closest('form'),ctx());
  if (['clientId','storeId','packageId','previousPackageId','billingMode','receiptId'].includes(event.target.name)) updateServicePackageChoices(event.target.closest('form'),ctx());
  if (event.target.name==='storeId') updateWorkflowForm(event.target.closest('form'),ctx());
  if (event.target.hasAttribute('data-evidence-picker')) { void addEvidencePhotos(event.target); return; }
  if (event.target.id === 'role-select') switchRole(event.target.value);
  if (event.target.hasAttribute('data-boss-store')) { assertBoss(); filters.storeId = event.target.value; render(); }
  if(event.target.hasAttribute('data-reception-store')) {
    if(role.type!=='frontdesk'||!receptionStores(ctx()).some(s=>s.id===event.target.value))throw new Error('请选择授权门店');
    filters.storeId=event.target.value;render();
  }
  if (event.target.hasAttribute('data-customer-store') && role.type==='customer') {
    if(!model.state.stores.some(store=>store.id===event.target.value))return;
    preferences.set('store:'+role.id,event.target.value);render();
  }
  if (event.target.dataset.preference === 'reminder' && role.type === 'customer') { preferences.set(role.id,event.target.checked); toast('已保存本次预览的提醒偏好'); }
  if (event.target.name === 'clientId' && ['appointment-create','appointment-edit'].includes($('#sheet-body form')?.dataset.form)) constrainStaffChoices($('#sheet-body form').dataset.form,event.target.value);
  if (['clientId','frontDeskId'].includes(event.target.name)) constrainEvaluationChoices();
  if (event.target.name === 'principalId' && $('#sheet-body form')?.dataset.form === 'register') updateParticipants();
  updateAppointmentAvailability(intakeForm,ctx());
  updateCustomerBookingForm(intakeForm,customerCtx());
  updateMultiDayBookingForm(intakeForm,ctx());
});
function updateParticipants() {
  const principal = $('#sheet-body [name="principalId"]')?.value;
  $('#sheet-body')?.querySelectorAll('[name="participantIds"]').forEach(el => {
    el.disabled = el.value === principal;
    if (el.disabled) el.checked = false;
  });
}
function constrainEvaluationChoices() {
  const f = $('#sheet-body form');
  if (f?.dataset.form === 'assessment-create' && f.elements.assessorId) f.elements.assessorId.value='tao';
  if (f?.dataset.form === 'frontdesk-evaluate') {
    const account=find('frontDesks',f.elements.frontDeskId?.value);
    const select=f.elements.storeId;
    if (!select || !account) return;
    const previous=select.value;
    select.innerHTML=account.storeIds.map(id=>`<option value="${esc(id)}">${esc(name('stores',id))}</option>`).join('');
    select.value=account.storeIds.includes(previous)?previous:account.storeIds[0];
  }
}
function constrainStaffChoices(type,id) {
  const f = $('#sheet-body form');
  if (!f || !['appointment-create','appointment-edit','edit-plan'].includes(type)) return;
  const clientId = f.querySelector('[name="clientId"]')?.value || id;
  const key = type === 'edit-plan' ? 'assigneeId' : 'principalId';
  const select = f.querySelector(`[name="${key}"]`);
  if (!select) return;
  const previous = select.value;
  const storeId = f.elements.storeId?.value;
  const allowed = model.state.therapists.filter(t => t.active && (type==='edit-plan'?model.canSeeClient({type:'therapist',id:t.id},clientId):model.bookingTherapistAllowed(t.id,clientId,storeId)) && (role.type!=='therapist'||find('therapists',role.id)?.legacy||t.id===role.id));
  if(type==='edit-plan')allowed.unshift({id:'boss',name:'涛博士'});
  select.innerHTML = `<option value="">${type==='edit-plan'?'请选择下一步负责人':'预约时选择服务治疗师'}</option>`+allowed.map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  select.value = allowed.some(t => t.id === previous) ? previous : (type==='edit-plan'?'boss':'') || '';
  if (!f.querySelector('.assignment-note')) {
    const note = document.createElement('p'); note.className='meta assignment-note';
    note.textContent=type==='edit-plan'?'涛博士发布专业计划；下一步事项可以交给已授权人员。':'每次预约分别选择本店在职治疗师；系统核对当天排班与已有预约。';
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
  if(role.type==='manager'&&!['manager-filters','manager-search','schedule-filters','cash-closing-select'].includes(f.dataset.form)){formError(f,'店长仅有本店监管只读权限，业务录入请由前台或老板处理');return;}
  if(f.dataset.form==='import-opening-batch'){void dialogContext?.legacyController?.submit();return;}
  if(f.dataset.form==='customer-booking' && !advanceCustomerBookingForm(f,customerCtx())) {saveDraft();return;}
  if(f.dataset.form==='multi-day-booking'&&!advanceMultiDayBookingForm(f,ctx())){saveDraft();return;}
  if (!f.reportValidity()) return;
  const type = f.dataset.form;
  if (['register','register-appointment'].includes(type)) {
    if (dialogContext?.photoBusy) { formError(f,'照片正在处理，请完成后再确认消课。'); return; }
    if (!dialogContext?.evidencePhotos?.length) {
      dialogContext.photoError = '请至少添加 1 张本次服务的留底照片，再确认消课。';
      updateEvidencePicker();
      f.querySelector('[data-action="evidence-pick"]')?.focus({preventScroll:true});
      f.querySelector('[data-evidence-section]')?.scrollIntoView({block:'start'});
      return;
    }
  }
  const fd = new FormData(f);
  const data = Object.fromEntries(fd);
  if(type==='manager-filters'||type==='manager-search') {
    try {
      if(role.type!=='manager')throw new Error('店长页面不可访问');
      if(type==='manager-filters') {
        model.managerSnapshot(role,{from:data.from,to:data.to});
        filters={...filters,from:data.from,to:data.to};
      } else {model.managerStoreId(role);filters.query=String(data.query||'');}
      render();
    } catch(error) {formError(f,error.message);}
    return;
  }
  if(type==='schedule-filters'){
    try{scheduleRows(model,role,{date:data.date,storeId:data.storeId});filters={...filters,scheduleDate:data.date,storeId:data.storeId||''};render();}catch(error){formError(f,error.message);}
    return;
  }
  if(type==='paper-intake-select'){openDialog('paper-intake-create',data.clientId);return;}
  if(type==='cash-closing-select'){try{model.cashClosingSummary(role,{storeId:data.storeId,date:data.date});openDialog('cash-closing',JSON.stringify({storeId:data.storeId,date:data.date}));}catch(error){formError(f,error.message);}return;}
  if(role.type==='manager') {formError(f,'店长仅有本店监管只读权限，其他操作请由对应工作人员处理');return;}
  if (type === 'filters') {
    if (data.from && data.to && data.from > data.to) { toast('开始日期不能晚于结束日期'); return; }
    filters = {...filters,...data}; render(); return;
  }
  if (type === 'client-search') { filters.query = data.query; render(); return; }
  saveDraft();
  f.dataset.busy = 'true';
  updateEvidencePicker();
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
      if(['add-therapist','add-frontdesk','add-manager','edit-therapist','edit-frontdesk','edit-manager'].includes(type))throw new Error('模拟提交失败：人员资料和权限未改变，填写内容已保留，请重试。');
      if(['schedule-save','schedule-request','schedule-decision'].includes(type))throw new Error('模拟提交失败：填写内容已保留，排班和通知未改变，请重试。');
      if (['reception-create-client','paper-intake-create','paper-intake-review','assessment-create','assessment-confirm','assessment-void','frontdesk-evaluate','frontdesk-evaluation-void'].includes(type)) throw new Error('模拟提交失败：记录未保存，填写内容已保留，请重试。');
      throw new Error(['record-receipt','settle-receipt','refund-receipt','void-receipt','void-refund','link-receipt-package','cash-closing','cash-closing-confirm'].includes(type)?'模拟提交失败：内容已保留，收支、套餐和日结未改变，请重试。':type==='record-arrival'?'模拟提交失败：到店状态未改变，请重试。':'模拟提交失败：内容已保留，未扣次数，请重试。');
    }
    let result;
    if(type==='multi-day-booking'){
      result=saveMultiDayBooking(model,{clientId:data.clientId,storeId:data.storeId,project:data.project,items:multiDayBookingItems(fd),requestId:context.requestId},role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      showSuccess(role.type==='customer'?`${result.count} 天预约申请已提交，待门店确认`:`${result.count} 天预约已确认`,multiDayResultSummary(result,ctx()));return;
    }
    if(['task-complete','task-edit','assign-store-therapist','appointment-cancel-request','appointment-cancel-handle','confirm-service-next-step'].includes(type)) {
      if(type==='task-complete') result=model.completeTask(data.id,role,{result:data.result});
      else if(type==='task-edit'){assertBoss();result=model.updateTask(data.id,data,role);}
      else if(type==='assign-store-therapist'){assertBoss();result=model.assignStoreTherapist(data,role);}
      else if(type==='appointment-cancel-request')result=model.requestAppointmentCancellation(data.id,{reason:data.reason,requestId:context.requestId},role);
      else if(type==='appointment-cancel-handle')result=model.handleAppointmentCancellation(data.id,data,role);
      else {
        const service=assertService(data.serviceId),client=find('clients',service.clientId);
        if(service.status!=='valid'||!service.nextStepSuggestion||!canEditPlan(client))throw new Error('请由客户负责人或老板确认有效服务的下一步建议');
        result=model.publishPlan(client.id,{goal:client.goal,phase:client.phase,planNotes:client.planNotes,homeAdvice:client.homeAdvice,progress:client.progress,nextStep:data.nextStep},role);
      }
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      const titles={'task-complete':'待办已完成，处理结果已保留','task-edit':'待办负责人和日期已调整','assign-store-therapist':'本店执行康复师已指定','appointment-cancel-request':'取消申请已提交，待门店处理','appointment-cancel-handle':data.decision==='approve'?'预约已取消，时间已释放':'处理说明已保存，原预约保留','confirm-service-next-step':'客户下一步已更新'};
      const details=type==='task-complete'?`<p>${esc(result.completionResult||'关联业务已处理')}</p>${button('查看待办记录','task-detail',result.id,'btn-primary')}`:type==='task-edit'?`<p>${esc(name('therapists',result.assigneeId))} · ${esc(result.dueDate)}</p>${button('查看待办','task-detail',result.id,'btn-primary')}`:type==='assign-store-therapist'?`<p>${esc(name('clients',data.clientId))} · ${esc(name('stores',data.storeId))} · ${esc(name('therapists',data.therapistId))}</p><p class="notice">统一负责人和套餐次数保留，客户可以选择该店执行师预约。</p>${button('查看客户档案','client-detail',data.clientId,'btn-primary')}`:type==='confirm-service-next-step'?`<p>${esc(data.nextStep)}</p>${button('查看客户计划','plan',result.id,'btn-primary')}`:`<p class="notice">${type==='appointment-cancel-request'?'原预约仍保留，收到门店处理结果后再确认安排。':'客户可以查看处理结果。'}本次没有扣次数、收款或退款。</p>${button('查看预约记录','appointment-history',result.clientId,'btn-primary')}`;
      showSuccess(titles[type],details);return;
    }
    if(['link-receipt-package','cash-closing','cash-closing-confirm'].includes(type)) {
      if(type==='link-receipt-package')assertBoss();
      result=type==='link-receipt-package'?model.linkReceiptPackage({...data,requestId:context.requestId},role):type==='cash-closing'?model.saveCashClosing({...data,requestId:context.requestId},role):model.confirmCashClosing(data.id,{version:data.version,requestId:context.requestId},role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      const closing=type!=='link-receipt-package',difference=Number(result.differenceTotal || 0),hasDifference=Object.values(result.difference||{}).some(value=>value!==0)||difference!==0;
      showSuccess(closing?type==='cash-closing-confirm'?'营业日结已确认':hasDifference?'日结已保存，差额待核对':'日结已保存，待老板确认':'收款已关联套餐',`<p class="notice">${closing?'本次保存核对记录，没有新增收入或转账。':'原收款与本店套餐已对应，没有重复计入实收或改变次数。'}</p>${closing&&hasDifference?`<p>合计差额 ${money(difference)}；请逐项核对各收款方式的差额，再重新填写。</p>`:''}<p class="meta">公开预览使用页面内示例，刷新恢复初始资料。</p>${button(closing?'查看营业日结':'查看原收款',closing?'cash-closing':'receipt-detail',closing?JSON.stringify({storeId:result.storeId,date:result.date}):result.id,'btn-primary')}`);return;
    }
    if(['add-therapist','add-frontdesk','add-manager','edit-therapist','edit-frontdesk','edit-manager'].includes(type)) {
      model._boss(role);
      if(!['true','false'].includes(data.active))throw new Error('请选择有效的人员状态');
      const editing=type.startsWith('edit-'), kind=type.replace(/^(?:add|edit)-/,'');
      const input={...data,active:data.active==='true',requestId:context.requestId,...(kind==='frontdesk'?{storeIds:fd.getAll('storeIds')}:{})};
      const method=editing?{therapist:'updateTherapist',frontdesk:'updateFrontDesk',manager:'updateStoreManager'}[kind]:{therapist:'addTherapist',frontdesk:'addFrontDesk',manager:'addStoreManager'}[kind];
      result=model[method](input,role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      const label={therapist:'康复师',frontdesk:'前台',manager:'店长'}[kind];
      const stores=(kind==='frontdesk'?result.storeIds:[result.storeId]).map(id=>name('stores',id)).join('、');
      showSuccess(editing?'人员资料已更新':`${label}已添加`, `<div class="detail-grid">${pair('姓名',result.name)}${pair('岗位',label)}${pair('门店',stores)}${pair('人员状态',result.active?'使用中':'已停用')}</div><p class="notice">${editing?'历史业务记录和人员归属保留，修改原因已记录。':'已加入本次预览，可切换到该身份体验对应工作。'}${!editing&&kind==='therapist'&&result.active?' 新康复师需先设置工作排班，再安排预约。':''}</p><p class="muted">本次资料仅保存在当前页面，刷新会恢复示例；正式账号和长期保存将在正式系统接入。</p><div class="action-row">${button('返回人员管理','nav','team','btn-primary')}${kind==='therapist'&&result.active?button('设置排班','nav','schedules','btn-outline'):''}</div>`);return;
    }
    if(['schedule-save','schedule-request','schedule-decision'].includes(type)){
      const input={...data,requestId:context.requestId};
      result=type==='schedule-save'?saveSchedule(model,input,role):type==='schedule-request'?requestScheduleChange(model,input,role):decideScheduleChange(model,data.id,input,role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      const effective=type==='schedule-save'||result.status==='approved';
      showSuccess(type==='schedule-request'?'申请已提交，等待老板确认':effective?'排班已更新，老板通知已记录':'申请已拒绝，原排班保留',`<p>${esc(name('therapists',result.therapistId))} · ${esc(result.date)} · ${esc(name('stores',result.storeId))}</p><p class="notice">${effective?'老板端已生成系统内通知，保留改前改后和原因。微信消息待正式接入，当前未发送。':type==='schedule-request'?'申请期间原排班不变；老板批准后生效，店长可以查看处理进度。':'审批记录已保留，排班未改变。'}</p>${button('返回排班','nav','schedules','btn-primary')}`);return;
    }
    if(type==='reception-create-client') {
      result=model.createReceptionClient({...data,requestId:context.requestId},role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      showSuccess('新客户档案已保存',receptionIntakeSuccess(result,ctx()));return;
    }
    if(type==='paper-intake-create'||type==='paper-intake-review') {
      result=type==='paper-intake-create'?savePaperIntake(model,{...data,requestId:context.requestId},role):reviewPaperIntake(model,data.id,{...data,requestId:context.requestId},role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      showSuccess(type==='paper-intake-create'?'接待表已保存，待康复师复核':'本次复核与下一步已保存',`<h3>${esc(name('clients',result.clientId))} · ${esc(name('stores',result.storeId))}</h3><p class="meta">本次接待 ${esc(result.date)} ${esc(result.time)} · 负责康复师 ${esc(name('therapists',find('clients',result.clientId).ownerId))}</p><p class="notice">${type==='paper-intake-create'?'记录了客户本次自述，请交给负责康复师核对。尚未形成专业评估结论。':esc(result.review.nextStep)}</p><p>本次保存不收款、不扣次数。</p>${button('查看本次接待表','paper-intake-detail',result.id,'btn-primary')}${type==='paper-intake-review'&&result.review.taskId?button('查看下一步待办','task-detail',result.review.taskId,'btn-outline'):''}`);return;
    }
    if(type==='create-store-package') {
      result=model.createStorePackage({...data,requestId:context.requestId},role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      showSuccess('本店套餐已建立','<h3>'+esc(name('clients',result.clientId))+' · '+esc(name('stores',result.storeId))+'</h3><p>本套餐剩余 '+model.packageRemaining(result.id)+' 次，仅限本店使用。</p><p class="notice">办卡本身不登记收入。已收到钱时，手动登记这份套餐的收款；之前已经记过的款项，请打开原收款关联，避免重复记账。</p><div class="action-row">'+button('登记本套餐收款','record-receipt',result.id,'btn-primary')+button('查看收款记录','cash-ledger','','btn-outline')+button('查看套餐','package',result.clientId,'btn-outline')+'</div>');return;
    }
    if (['customer-booking','customer-booking-cancel','customer-booking-confirm','customer-booking-resolve','customer-booking-accept'].includes(type)) {
      if(type==='customer-booking')result=requestCustomerBooking(model,{...data,requestId:context.requestId},role);
      else if(type==='customer-booking-cancel')result=cancelCustomerBooking(model,data.id,role);
      else if(type==='customer-booking-resolve')result=resolveCustomerBooking(model,data,role);
      else if(type==='customer-booking-accept')result=acceptCustomerBookingSuggestion(model,data.id,role);
      else result=confirmCustomerBooking(model,data.id,role);
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      const title=type==='customer-booking'?'预约申请已提交，待门店确认':type==='customer-booking-cancel'?'预约申请已取消':type==='customer-booking-resolve'?'预约申请处理结果已保存':type==='customer-booking-accept'?'已接受建议，等待门店确认':'预约已确认';
      showSuccess(title,
        '<h3>'+date(result.date)+' · '+esc(result.time)+' · '+esc(name('stores',result.storeId))+'</h3><p>'+(type==='customer-booking'||type==='customer-booking-accept'?'收到门店确认后再到店。':type==='customer-booking-cancel'?'套餐次数未改变。':type==='customer-booking-resolve'?'客户可查看处理结果；建议时间需要客户接受后，再由门店确认。':'客户可在首页查看确认的预约安排。')+'</p><p class="muted">本次未扣次数、未收款。预览记录仅保存在当前页面，刷新会恢复示例，不会发送给真实门店。</p>'+button('查看申请记录','customer-booking-detail',result.id,'btn-outline'));return;
    }
    if (['assessment-create','assessment-confirm','assessment-void','frontdesk-evaluate','frontdesk-evaluation-void'].includes(type)) {
      if(type==='assessment-create')result=recordAssessment(model,{...data,requestId:context.requestId},role);
      else if(type==='assessment-confirm')result=confirmAssessment(model,data.id,role);
      else if(type==='assessment-void')result=voidAssessment(model,data.id,data.reason,role);
      else if(type==='frontdesk-evaluate')result=recordFrontDeskEvaluation(model,{...data,requestId:context.requestId},role);
      else result=voidFrontDeskEvaluation(model,data.id,data.reason,role);
      const assessment=type.startsWith('assessment-');
      const title=({'assessment-create':'评估数据已登记，等待核对','assessment-confirm':'评估已确认，客户可以查看','assessment-void':'评估已撤销，原记录保留','frontdesk-evaluate':'工作考核已记录','frontdesk-evaluation-void':'考核已撤销，原记录保留'})[type];
      drafts.delete(context.key);f.dataset.succeeded='true';render();
      showSuccess(title,`${assessment?`<p>${esc(name('clients',result.clientId))} · ${date(result.date)} · ${esc(result.project)}</p>`:'<p>本次结论、工作数据与改进安排已保留，可随时回看。</p>'}<div class="action-row">${button('查看记录',assessment?'assessment-detail':'frontdesk-evaluation-detail',result.id,'btn-primary')}</div>`);return;
    }
    if (type === 'register' || type === 'register-appointment') {
      result = model.registerService({...data,participantIds:fd.getAll('participantIds'),evidencePhotos:context.evidencePhotos.map(photo => ({...photo})),requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('本次服务已登记',`<h3>${esc(name('clients',result.clientId))} · ${esc(result.project)}</h3>${serviceResultSummary(result,ctx())}<div class="action-row">${button('查看服务明细','service-detail',result.id,'btn-outline')}${button('安排下一次服务','appointment-create',result.clientId,'btn-outline')}${result.nextStepSuggestion&&canEditPlan(find('clients',result.clientId))?button('确认客户下一步','confirm-service-next-step',result.id,'btn-primary'):''}</div>`); return;
    }
    if (type === 'record-receipt' || type === 'settle-receipt' || type === 'refund-receipt') {
      if(type==='refund-receipt')assertBoss();
      result = type === 'record-receipt' ? model.recordReceipt({...data,requestId:context.requestId},role) : type === 'settle-receipt' ? model.settleReceipt(data.id,{...data,requestId:context.requestId},role) : model.refundReceipt({...data,requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded='true'; render();
      const pending=result.status==='pending_settlement';
      const packageNotice=result.packageId?`<p class="notice">${esc(name('packages',result.packageId))} · 可用 ${model.packageRemaining(result.packageId)} 次。${type==='refund-receipt'?(result.packageAction==='close'?'该套餐已结束，历史服务和原消费业绩保留。':'套餐次数保持原处理状态，历史服务和原消费业绩保留。'):'已关联本次手动收款，登记收款本身不扣次数。'}</p>`:'';
      showSuccess(pending?'已保存，等待平台结算':type==='refund-receipt'?'退款记录已保存':'收款已计入实收',`<div class="detail-grid">${pair('金额',money(result.amount))}${pair('日期',`${result.date} ${result.time}`)}${pair('门店',name('stores',result.storeId))}</div>${packageNotice}<p class="muted">${pending?'此笔暂不计入实收。平台到账后，在收支明细中登记结算。':type==='refund-receipt'?'按实际退款日期扣减收入，原收款记录保留。':'老板看板已更新，套餐次数和消费业绩各自保留。'}</p><div class="action-row">${button('查看本笔记录',type==='refund-receipt'?'refund-detail':'receipt-detail',result.id,'btn-outline')}${button('继续记收款','record-receipt','','btn-outline')}${button(role.type==='frontdesk'?'返回接待工作台':'返回老板看板','nav',role.type==='frontdesk'?'reception':'overview','btn-primary')}</div>`); return;
    } else if(type==='record-arrival')model.recordArrival(data.id,{notes:data.notes,requestId:context.requestId},role);
    else if (type === 'void-receipt') model.voidReceipt(data.id,data.reason,role);
    else if (type === 'void-refund') model.voidRefund(data.id,data.reason,role);
    else if (type === 'edit-plan') {
      const summary = String(data.progressSummary || '').trim();
      model.publishPlan(data.clientId,{...data,progress:summary ? {status:'updated',summary,metrics:find('clients',data.clientId).progress.metrics} : {status:'pending',summary:'待康复师完成评估后更新',metrics:[]}},role);
    } else if (type==='appointment-batch') {
      result=model.saveAppointmentBatch({...data,items:bookingMembers(fd),requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded='true'; render();
      showSuccess(`${result.length} 人预约已确认`,`<div class="line-list">${result.map(a=>`<div class="row"><div><strong>${esc(name('clients',a.clientId))} · ${esc(name('therapists',a.principalId))}</strong><p class="meta">${date(a.date)} ${esc(a.time)} · ${esc(name('stores',a.storeId))}</p></div></div>`).join('')}</div><p class="notice">每人分别到店、完成服务后分别消课。调整或取消一人的预约，不影响其他人的安排。</p>`); return;
    } else if (['appointment-create','appointment-edit'].includes(type)) model.saveAppointment(data,role);
    else if (type === 'appointment-cancel') model.cancelAppointment(data.id,data.reason,role);
    else if (type === 'appointment-no-show') model.markNoShow(data.id,data.reason,role);
    else if (type === 'renew-package') {
      result = model.renewPackage({...data,requestId:context.requestId},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('新套餐已续接',`<h3>${esc(name('clients',result.clientId))} · ${esc(result.name)}</h3><div class="detail-grid">${pair('套餐门店',name('stores',result.storeId))}${pair('本次新套餐可用次数',`${model.packageRemaining(result.id)} 次`)}${pair('新套餐单次消费折算',money(model.unitValue(result.id)))}</div><p class="muted">旧套餐已保存到历史。消费业绩在后续实际服务登记时产生。</p><p class="notice">已收到钱时再手动记收款。已登记过的款项请打开原收款关联，避免重复录入。</p><div class="action-row">${button('登记本套餐收款','record-receipt',result.id,'btn-primary')}${button('查看收款记录','cash-ledger','','btn-outline')}${button('查看套餐记录','package',result.clientId,'btn-outline')}</div>`); return;
    } else if (type === 'activate-package') model.activatePackage(data.packageId,data.reason,role);
    else if (type === 'reschedule') model.requestReschedule(data.appointmentId,data,role);
    else if (type === 'review') {
      result = model.submitReview(data.serviceId,{...data,wantContact:fd.has('wantContact')},role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess('评价已提交',`<h3>感谢您的真实反馈</h3><p>${result.followupStatus === 'pending' ? '您的反馈已进入老板的待跟进列表。' : '您的评价仅老板可查看，会帮助我们完善后续服务。'}</p>`); return;
    } else if (type === 'followup') model.closeFollowup(data.reviewId,data.result,role);
    else if (type === 'add-store') model.addStore(data,role);
    else if(type==='deactivate-frontdesk')model.deactivateFrontDesk(data.id,role);
    else if(type==='deactivate-manager')model.deactivateStoreManager(data.id,role);
    else if (type === 'transfer-client') model.transferClient(data.clientId,data.ownerId,data.reason,role);
    else if (type === 'import-opening') model.importOpening(data,role);
    else if (type === 'deactivate-therapist') model.deactivateTherapist(data.id,role);
    else if (type === 'revoke-service') {
      result = model.revokeService(data.id,data.reason,role);
      drafts.delete(context.key); f.dataset.succeeded = 'true'; render();
      showSuccess(result.billingMode==='single'?'服务已更正，业绩已冲回':find('packages',result.packageId)?.closed?'消课已更正，业绩已冲回':'次数已恢复，业绩已冲回',`${serviceResultSummary(result,ctx(),'revoked')}${button('查看原记录','service-detail',result.id,'btn-outline')}`); return;
    } else if (type === 'reset') {
      model = new DemoModel({now:previewTimestamp}); ensureStorePackageExamples(model); ensureEvaluations(model); ensurePaperIntakes(model); ensureCustomerBooking(model); ensureSchedules(model); drafts.clear(); preferences.clear(); $('#network-toggle').checked = false;
      closeDialog(false); role = {type:'customer',id:'c1'}; view='home'; filters={storeId:'',therapistId:'',from:'',to:'',query:''}; render(true); toast('示例已重置'); return;
    } else throw new Error('此表单暂不可提交');
    drafts.delete(context.key); f.dataset.succeeded = 'true'; closeDialog(false); render();
    toast(({ 'record-arrival':'已确认到店，套餐次数未改变','void-receipt':'错误收款已撤销，原记录保留','void-refund':'错误退款已撤销，原记录保留','edit-plan':'计划已保存，客户页面同步更新','appointment-create':'服务安排已确认','appointment-edit':'新的服务安排已确认','appointment-cancel':'预约已取消，未扣次数','appointment-no-show':'未到店已记录，未扣次数','activate-package':'当前使用套餐已切换，历史余额和业绩各自保留',reschedule:'改约申请已提交，等待工作人员确认',followup:'回访结果已保存','add-store':'新门店已加入，共用客户档案','add-therapist':'康复师已加入，可分配客户','transfer-client':'负责人已转交，历史业绩保留原归属','import-opening':'期初档案已录入，不产生新消费业绩','deactivate-therapist':'康复师已停用，历史记录保留','add-frontdesk':'前台已加入，可在预览身份切换体验','deactivate-frontdesk':'前台账号已停用，历史记录保留' })[type] || '已保存');
  } catch (error) { if (f.isConnected) formError(f,type==='multi-day-booking'&&!error.message.includes('本批未保存')?`${error.message}。本批未保存，请调整后重试`:error.message); else toast(error.message); }
  finally {
    f.dataset.busy = 'false';
    submits.forEach(el => { el.disabled = false; el.textContent = el.dataset.original; });
    if(f.isConnected){if(f.dataset.form==='assign-store-therapist')updateWorkflowForm(f,ctx());updateReceptionIntakeChoices(f,ctx());updatePaperIntakeForm(f,ctx());updateScheduleForm(f,ctx());updateAppointmentAvailability(f,ctx());if(type==='multi-day-booking')updateMultiDayBookingForm(f,ctx());}
    updateEvidencePicker();
  }
});

function exportPreview() {
  if (role.type === 'boss') assertBoss();
  const ids = new Set(model.visibleClients(role).map(c => c.id));
  const state = model.state;
  const exportService = s => {
    const {inputKey, taskSnapshots, appointmentSnapshots, evidencePhotos, ...record} = s;
    const photos = model.canSeeEvidence(role, s.id) ? evidencePhotos || [] : undefined;
    return role.type === 'customer' ? {id:s.id,clientId:s.clientId,storeId:s.storeId,date:s.date,time:s.time,project:s.project,principalId:s.principalId,participantIds:s.participantIds,sessions:s.sessions,billingMode:s.billingMode,status:s.status,notes:s.notes,nextStepSuggestion:s.nextStepSuggestion,revokeReason:s.revokeReason,recordedAt:s.recordedAt || s.createdAt,recordedBy:s.recordedBy,evidencePhotos:photos} : {...record,...(photos ? {evidencePhotos:photos} : {})};
  };
  const cleanAudit=row=>{const {inputKey,requestId,personnelOperation,...safe}=row;return safe;};
  const cleanCash=row=>{const {inputKey,requestId,requestType,confirmRequestId,confirmInputKey,ledgerFingerprint,...safe}=row;return safe;};
  const frontStores=role.type==='frontdesk'?receptionStores(ctx()):[];
  const frontStoreIds=role.type==='frontdesk'?new Set(frontStores.map(s=>s.id)):null;
  const data = role.type==='manager'?model.managerSnapshot(role):role.type === 'boss' ? {...state,audit:state.audit.map(cleanAudit),services:state.services.map(exportService),receipts:state.receipts.map(cleanCash),refunds:state.refunds.map(cleanCash)} : role.type==='frontdesk'?{
    clients:state.clients.filter(c=>ids.has(c.id)).map(c=>({id:c.id,name:c.name,phone:c.phone,age:c.age,problem:c.problem,storeId:c.storeId,ownerId:c.ownerId,assessorId:c.assessorId,storeSessions:frontStores.map(store=>({storeId:store.id,storeName:store.name,remainingSessions:model.remainingInStore(c.id,store.id)}))})),
    appointments:state.appointments.filter(a=>frontStoreIds.has(a.storeId)).map(a=>({id:a.id,clientId:a.clientId,storeId:a.storeId,date:a.date,time:a.time,principalId:a.principalId,status:a.status,arrivalAt:a.arrivalAt,arrivalBy:a.arrivalBy})),
    receipts:state.receipts.filter(r=>frontStoreIds.has(r.storeId)).map(cleanCash),refunds:state.refunds.filter(r=>frontStoreIds.has(r.storeId)).map(cleanCash),
    assessments:assessmentRows(model,role),frontDeskEvaluations:frontDeskEvaluationRows(model,role,role.id)
  } : {
    clients:state.clients.filter(c => ids.has(c.id)),
    packages:state.packages.filter(p => ids.has(p.clientId)).map(p=>role.type==='customer'?{id:p.id,clientId:p.clientId,name:p.name,total:p.total,openingUsed:p.openingUsed,status:p.status,storeId:p.storeId,closed:p.closed===true,remaining:model.packageRemaining(p.id)}:p),
    services:state.services.filter(s => role.type==='therapist'&&!state.therapists.find(t=>t.id===role.id)?.legacy ? s.principalId===role.id || s.participantIds.includes(role.id) : ids.has(s.clientId) || (role.type === 'therapist' && (s.principalId === role.id || s.participantIds.includes(role.id)))).map(exportService),
    appointments:state.appointments.filter(a => ids.has(a.clientId)&&(role.type!=='therapist'||state.therapists.find(t=>t.id===role.id)?.legacy||a.principalId===role.id||(a.participantIds||[]).includes(role.id))),
    tasks:state.tasks.filter(t => ids.has(t.clientId) && (role.type === 'customer' ? ['plan','assessment','review','reschedule'].includes(t.type) : t.type !== 'review_followup' && t.assigneeId === role.id)),
    reviews:model.reviewRows(role),
    assessments:assessmentRows(model,role)
  };
  if(['boss','frontdesk','manager'].includes(role.type)){
    const allowedCashStores=new Set(role.type==='boss'?state.stores.map(s=>s.id):role.type==='manager'?[model.managerStoreId(role)]:[...frontStoreIds]);
    data.cashClosings=(state.cashClosings||[]).filter(row=>allowedCashStores.has(row.storeId)).map(cleanCash);
  }
  data.bookingRequests = customerBookingRows(model,role);
  if(role.type!=='customer'){data.paperIntakes=paperIntakeRows(model,role);data.staffSchedules=scheduleRows(model,role);data.scheduleChangeRequests=scheduleRequestRows(model,role);}
  if(role.type==='boss')data.scheduleNotifications=bossScheduleNotifications(model,role);
  const blob = new Blob([JSON.stringify({说明:'虚构示例，非真实业务档案',身份:role,数据:data},null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download='涛博士-演示记录.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('已导出当前身份可见的演示记录');
}

// Use the layout breakpoint for the initial view and when entering a phone layout.
// A manual toggle stays in place while the viewport remains on the same side.
const compactPreview = window.matchMedia('(max-width: 760px)');
$('.preview-controls').open = !compactPreview.matches;
compactPreview.addEventListener('change', event => { $('.preview-controls').open = !event.matches; const supervision=main.querySelector('.manager-supervision');if(supervision)supervision.open=!event.matches; });
document.body.classList.toggle('customer-share', customerShare);
$('#share-preview-note').hidden = !customerShare;
if(previewEntry==='boss')switchRole('boss:boss');
else if(previewEntry==='frontdesk'&&model.state.frontDesks?.find(f=>f.active!==false))switchRole(`frontdesk:${model.state.frontDesks.find(f=>f.active!==false).id}`);
else if(previewEntry==='therapist'&&model.state.therapists.some(t=>t.active))switchRole(`therapist:${model.state.therapists.find(t=>t.active&&t.id===new URLSearchParams(location.search).get('staff'))?.id||model.state.therapists.find(t=>t.active).id}`);
else if(previewEntry==='manager'&&model.state.storeManagers.some(m=>m.active))switchRole(`manager:${model.state.storeManagers.find(m=>m.active&&m.storeId===new URLSearchParams(location.search).get('store'))?.id||model.state.storeManagers.find(m=>m.active).id}`);
else render();
