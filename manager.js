import { renderCashClosingSummary } from './cash.js?v=20261009-daily-permissions-2';
/* Store managers supervise local work; only single new bookings and pending confirmations are writable. */
import { renderPaperIntakeInbox, renderPaperIntakeList } from './paper-intake.js?v=20261009-daily-permissions-2';
import { renderBookingInbox } from './customer-ui.js?v=20261010-multi-day-booking-1';
import { renderDailyOperations } from './daily-operations-ui.js?v=20261009-daily-permissions-2';
const CHANNELS = {direct:'门店收款',douyin:'抖音',meituan:'美团',other_platform:'其他平台'};
const METHODS = {wechat:'微信',alipay:'支付宝',cash:'现金',bank:'银行转账'};
const PURPOSES = {package:'套餐',renewal:'续费',single:'单次服务',other:'其他',platform_settlement:'平台结算'};
const CONCLUSIONS = {met:'符合要求',improve:'需改进',unobserved:'未观察'};
const APPOINTMENT_STATUS = {confirmed:'待服务',reschedule_requested:'申请改约',pending_reassignment:'人员待安排',completed:'已完成',cancelled:'已取消',no_show:'未到店'};
const CASH_STATUS = {valid:'已到账',pending_settlement:'待结算',settled:'原单已结算',revoked:'已撤销'};
const ASSESSMENT_STATUS = {pending:'待康复师确认',confirmed:'已确认',voided:'已撤销'};
const PENDING_APPOINTMENTS = new Set(['confirmed','reschedule_requested','pending_reassignment']);
const SHANGHAI_DATE = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});

function helpers(ctx, period = false) {
  const filters = ctx.filters || {};
  const all = ctx.model.managerSnapshot(ctx.role,{from:'',to:''});
  const snapshot = period ? ctx.model.managerSnapshot(ctx.role,{from:filters.from || '',to:filters.to || ''}) : all;
  const esc = ctx.esc || (value => String(value ?? '').replace(/[&<>"']/g,ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])));
  const ico = (name,size = 18) => ctx.icon ? ctx.icon(name,size) : '';
  const money = amount => `¥${Number(amount || 0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const name = (kind,id) => id === 'boss' ? '老板' : (all[kind] || []).find(row => row.id === id)?.name || (id ? '历史人员' : '待安排');
  const clientName = id => (all.clients || []).find(row => row.id === id)?.name || '未关联客户';
  const actorName = id => id === 'boss' ? '老板' : [...(all.therapists || []),...(all.frontDesks || [])].find(row => row.id === id)?.name || (id ? '历史人员' : '未记录');
  const button = (label,type,id = '',style = 'btn-outline') => `<button type="button" class="btn ${style}" data-action="${esc(type)}" data-id="${esc(id)}">${esc(label)}</button>`;
  const link = (label,type,id = '') => `<button type="button" class="text-link" data-action="${esc(type)}" data-id="${esc(id)}">${esc(label)}${ico('chevron-right',17)}</button>`;
  const tag = (label,color = '') => `<span class="tag ${color ? `tag-${color}` : ''}">${esc(label)}</span>`;
  const pair = (label,value) => `<div class="detail-pair"><span>${esc(label)}</span><strong>${esc(value ?? '未填写')}</strong></div>`;
  const detail = pairs => `<div class="detail-grid">${pairs.map(([label,value]) => pair(label,value)).join('')}</div>`;
  const clientLink = id => (all.clients || []).some(row => row.id === id) ? link(clientName(id),'manager-client',id) : esc(clientName(id));
  const empty = text => `<div class="empty">${esc(text)}</div>`;
  const periodLabel = snapshot.from || snapshot.to ? `${snapshot.from || '不限开始'} 至 ${snapshot.to || '不限结束'}` : '全部时间';
  return {ctx,all,snapshot,esc,ico,money,name,clientName,actorName,button,link,tag,pair,detail,clientLink,empty,periodLabel,today:ctx.model.today};
}

function serviceAmount(rows) {
  const minor = rows.reduce((sum,row) => sum + (Number.isSafeInteger(row.amountMinor) ? row.amountMinor : Math.round(Number(row.amount || 0) * 100)),0);
  if (!Number.isSafeInteger(minor)) throw new Error('业绩金额需核对，请缩短统计日期');
  return minor / 100;
}
function latest(rows) {
  return rows.slice().sort((a,b) => `${b.date || b.to || ''} ${b.time || ''}`.localeCompare(`${a.date || a.to || ''} ${a.time || ''}`));
}
function scheduled(rows) {
  return rows.slice().sort((a,b) => `${a.date || ''} ${a.time || ''}`.localeCompare(`${b.date || ''} ${b.time || ''}`));
}
function businessDate(stamp) {
  if (!stamp || !Number.isFinite(Date.parse(stamp))) return '';
  const parts = Object.fromEntries(SHANGHAI_DATE.formatToParts(new Date(stamp)).map(part => [part.type,part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function between(value,from,to) { return Boolean(value) && (!from || value >= from) && (!to || value <= to); }

function heading(x,title,description) {
  return `<div class="page-head"><div><span class="eyebrow">${x.esc(x.all.store.name)} · 店长工作台</span><h1>${x.esc(title)}</h1><p class="muted">${x.esc(description)}</p><p class="meta">可代客户新建本店预约、确认待预约；其他资料监管查看，调整由对应工作人员处理。</p></div><div class="action-row">${x.button('代客户预约','appointment-create','','btn-primary')}${x.button('一次约多天','multi-day-booking','','btn-outline')}${x.tag(`${x.all.manager.name} · 监管查看`,'green')}</div></div>`;
}
function periodFilter(x) {
  return `<form class="filters" data-form="manager-filters"><label class="field"><span>开始日期</span><input type="date" name="from" value="${x.esc(x.snapshot.from || '')}"></label><label class="field"><span>结束日期</span><input type="date" name="to" value="${x.esc(x.snapshot.to || '')}"></label><button class="btn btn-primary" type="submit">查看</button>${x.button('全部时间','manager-clear-filters','','btn-quiet')}</form>`;
}
function fold(x,label,rows,render,emptyText,open = false) {
  return `<details class="ease-work-notice" ${open && rows.length ? 'open' : ''}><summary><strong>${x.esc(label)}</strong><span class="ease-fold-count">${rows.length} 条</span>${x.ico('chevron-right',18)}</summary><div class="ease-fold-body">${rows.length ? rows.map(render).join('') : x.empty(emptyText)}</div></details>`;
}
function appointmentCard(x,row) {
  const text = row.arrivalAt && PENDING_APPOINTMENTS.has(row.status) ? '已到店待登记' : APPOINTMENT_STATUS[row.status] || '待核对';
  return `<article class="ease-service-card"><div class="ease-service-head"><div><span class="ease-service-time">${x.esc(row.date)} · ${x.esc(row.time)}</span><h3>${x.esc(x.clientName(row.clientId))}</h3></div>${x.tag(text,row.status === 'completed' ? 'green' : row.status !== 'confirmed' || row.arrivalAt ? 'warn' : '')}</div><p class="ease-service-project">${x.esc(row.project)}</p><p class="meta">康复师 ${x.esc(x.name('therapists',row.principalId))}${row.groupId ? ' · 同行预约，每人独立安排' : ''}</p><div class="ease-service-actions">${x.link('预约明细','manager-appointment',row.id)}${x.clientLink(row.clientId)}</div></article>`;
}
function taskRow(x,row) {
  return `<div class="row"><div class="row-main"><strong>${x.esc(row.title)}</strong><div class="meta">${x.esc(x.clientName(row.clientId))} · 负责人 ${x.esc(x.actorName(row.assigneeId))}</div><div class="meta">计划日期 ${x.esc(row.dueDate || '待安排')} ${row.dueDate && row.dueDate < x.today ? x.tag('已逾期','warn') : ''}</div></div><div class="action-row">${x.button('查看待办','task-detail',row.id,'btn-small btn-outline')}${x.clientLink(row.clientId)}</div></div>`;
}
function cashHero(x,cash,label,showChannels = true) {
  return `<section class="cash-hero" aria-label="本店营业收入"><div class="cash-hero-head"><span>${x.esc(label)}</span><span>${x.esc(x.all.store.name)}</span></div><strong class="cash-total">${x.money(cash.net)}</strong><p class="cash-formula">收款 ${x.money(cash.received)} <span>−</span> 退款 ${x.money(cash.refunded)}</p>${showChannels ? `<div class="cash-channels">${(cash.channels || []).map(row => `<div><span>${x.esc(CHANNELS[row.channel] || '其他渠道')}</span><strong>${x.money(row.net)}</strong></div>`).join('')}</div>` : ''}<p class="cash-hero-note">按实际到账日期统计，已扣除退款。消费业绩来自已完成服务，单独统计。</p></section>`;
}

function bookingInbox(ctx,x) {
  return renderBookingInbox({...ctx,fmt:{money:x.money,date:value=>`${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日`},ui:{button:x.button,name:x.name}});
}
function appointmentsPage(ctx) {
  const x=helpers(ctx),rows=scheduled(x.all.appointments.filter(row=>row.date>=x.today&&PENDING_APPOINTMENTS.has(row.status)));
  return `<div class="manager-dashboard">${heading(x,'本店预约','核对客户申请与已确认的本店安排。')}${bookingInbox(ctx,x)}<section class="ease-work-main"><div class="section-head"><h2>今天及之后的预约</h2>${x.tag(`${rows.length} 次`)}</div><div class="ease-service-list">${rows.length?rows.map(row=>appointmentCard(x,row)).join(''):x.empty('本店暂无今天或之后的待服务预约。')}</div></section><p class="meta">新建预约与确认申请不扣次数、不记收款；已有安排需调整时，请联系前台或负责康复师。</p></div>`;
}
function overview(ctx) {
  const x = helpers(ctx);
  const today = ctx.model.managerSnapshot(ctx.role,{from:x.today,to:x.today});
  const validServices = (today.services || []).filter(row => row.status === 'valid');
  const appointments = scheduled((x.all.appointments || []).filter(row => PENDING_APPOINTMENTS.has(row.status)));
  const todayAppointments = appointments.filter(row => row.date === x.today);
  const unrecorded = appointments.filter(row => row.arrivalAt && row.date <= x.today);
  const attention = appointments.filter(row => row.status !== 'confirmed' || row.date < x.today).filter(row => !unrecorded.some(item => item.id === row.id));
  const future = appointments.filter(row => row.date > x.today && row.status === 'confirmed');
  const tasks = (x.all.tasks || []).filter(row => !['completed','done'].includes(row.status) && row.type !== 'review_followup').sort((a,b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const assessments = latest((x.all.assessments || []).filter(row => row.status === 'pending'));
  const pendingReceipts = latest((x.all.receipts || []).filter(row => row.status === 'pending_settlement'));
  const assessmentItem = row => `<div class="row"><div class="row-main"><strong>${x.esc(x.clientName(row.clientId))} · ${x.esc(row.project)}</strong><div class="meta">${x.esc(row.date)} · 待 ${x.esc(x.name('therapists',row.therapistId))} 确认</div></div>${x.link('查看记录','manager-assessment',row.id)}</div>`;
  return `<div class="boss-dashboard manager-dashboard">${heading(x,'本店今天','先看今天安排，再确认客户预约。')}<section class="ease-work-main manager-panel manager-today"><div class="section-head"><h2>今天的安排</h2>${x.tag(`${todayAppointments.length} 次`)}</div><div class="ease-service-list">${todayAppointments.length ? todayAppointments.map(row => appointmentCard(x,row)).join('') : x.empty('今天暂无待服务预约。')}</div></section>${bookingInbox(ctx,x)}<details class="manager-supervision" open><summary><strong>本店收支与员工工作</strong><span>展开监管记录</span></summary><div class="manager-supervision-body">${cashHero(x,today.cash,'本店今日实收')}${renderCashClosingSummary(ctx)}<div class="ease-work-stats"><div class="ease-work-stat"><span>今日待服务</span><strong>${todayAppointments.length}<small> 次</small></strong><small>其中已到店 ${todayAppointments.filter(row => row.arrivalAt).length} 次</small></div><div class="ease-work-stat"><span>今日完成服务</span><strong>${validServices.length}<small> 次</small></strong><small>按本店实际服务记录</small></div><div class="ease-work-stat"><span>今日消费业绩</span><strong>${x.money(serviceAmount(validServices))}</strong><small>主服务计一次，协作不重复计</small></div></div>${renderDailyOperations({...ctx,filters:{...ctx.filters,from:ctx.model.today,to:ctx.model.today}},{compact:true})}</div></details><section class="boss-panel manager-panel"><div class="section-head"><h2>先处理这些事</h2><span class="muted">当前全部待办</span></div>${renderPaperIntakeInbox(ctx)}${fold(x,'已到店待登记',unrecorded,row => appointmentCard(x,row),'服务记录均已补齐。',true)}${fold(x,'预约需要确认',attention,row => appointmentCard(x,row),'暂无改约、人员调整或逾期预约。')}${fold(x,'工作待办',tasks,row => taskRow(x,row),'暂无未完成工作。')}${fold(x,'评估待确认',assessments,assessmentItem,'本店评估均已处理。')}${fold(x,'平台待结算',pendingReceipts,row => cashRow(x,row,'receipt'),'本店没有平台待结算款项。')}<p class="manager-panel-note">待办由对应工作人员处理；退款、更正和权限调整由老板处理。</p></section>${fold(x,'之后的预约',future,row => appointmentCard(x,row),'暂无已确认的后续预约。')}<div class="boss-footer">${x.button('查看本店记录','nav','manager-records')}${x.button('查看人员工作','nav','manager-team')}</div></div>`;
}

function clientList(ctx) {
  const x = helpers(ctx);
  const query = String(ctx.filters?.query || '').trim().toLowerCase();
  const clients = (x.all.clients || []).filter(row => !query || `${row.name} ${row.phone || ''}`.toLowerCase().includes(query));
  const cards = clients.map(client => {
    const next = scheduled((x.all.appointments || []).filter(row => row.clientId === client.id && row.date >= x.today && PENDING_APPOINTMENTS.has(row.status)))[0];
    return `<article class="card person-card"><div class="section-head"><h2>${x.esc(client.name)}</h2>${x.tag(client.total?`剩余 ${client.remaining} 次`:'尚未办理本店套餐',client.total&&client.remaining <= 2 ? 'warn' : 'green')}</div><p class="meta">${x.esc(client.phone || '手机号待补充')} · 负责人 ${x.esc(x.name('therapists',client.ownerId))}</p><p class="client-goal">${x.esc(client.goal || client.planName || '计划待完善')}</p><p class="meta">本店下次服务：${next ? `${x.esc(next.date)} ${x.esc(next.time)}` : '待安排'}</p><p class="meta">${x.esc(client.nextStep || '下一步待康复师更新')}</p><div class="action-row">${x.link('查看档案与本店记录','manager-client',client.id)}${x.button('代客户预约','appointment-create',client.id,'btn-primary')}${x.button('一次约多天','multi-day-booking',client.id,'btn-outline')}${x.button('接待记录','paper-intake-list',client.id)}</div></article>`;
  }).join('');
  return `<div class="manager-dashboard">${heading(x,'本店客户','查找本店客户，代约时间或查看本店工作记录。')}<form class="toolbar" data-form="manager-search"><label class="field search-field"><span>查找客户</span><input name="query" type="search" value="${x.esc(ctx.filters?.query || '')}" placeholder="输入姓名或手机号" maxlength="80"></label><button type="submit" class="btn btn-primary">查找</button></form><div class="section-head"><h2>客户档案</h2><span class="muted">${clients.length} 位</span></div><div class="client-grid">${cards || x.empty('未找到本店客户，请更换搜索内容。')}</div></div>`;
}

function serviceLedger(x,rows,title = '本店服务记录') {
  return `<section class="section card"><div class="section-head"><h2>${x.esc(title)}</h2><span class="muted">${rows.length} 次</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>客户 / 项目</th><th>日期 / 时间</th><th>主康复师 / 协作</th><th>消费业绩</th><th>状态 / 留底</th><th></th></tr></thead><tbody>${latest(rows).map(row => `<tr><td data-label="客户 / 项目">${x.clientLink(row.clientId)}<div class="meta">${x.esc(row.project)}</div></td><td data-label="日期 / 时间">${x.esc(row.date)}<div class="meta">${x.esc(row.time)}</div></td><td data-label="主康复师 / 协作">${x.esc(x.name('therapists',row.principalId))}<div class="meta">${(row.participantIds || []).length ? `协作：${x.esc(row.participantIds.map(id => x.name('therapists',id)).join('、'))}` : '独立服务'}</div></td><td data-label="消费业绩"><strong class="${row.status === 'revoked' ? 'revoked-amount' : 'amount'}">${x.money(row.amount)}</strong></td><td data-label="状态 / 留底">${x.tag(row.status === 'valid' ? '已完成' : '已撤销',row.status === 'valid' ? 'green' : 'warn')}<div class="meta">${row.evidencePhotos?.length ? `${row.evidencePhotos.length} 张照片` : '历史未留照片'}</div></td><td data-label="明细">${x.link('查看','manager-service',row.id)}</td></tr>`).join('')}</tbody></table>${!rows.length ? x.empty('当前日期没有本店服务记录。') : ''}</div></section>`;
}
function cashRow(x,row,kind) {
  const isRefund = kind === 'refund';
  const state = isRefund ? row.status === 'valid' ? '已退款' : '已撤销' : CASH_STATUS[row.status] || '待核对';
  return `<button type="button" class="cash-ledger-row" data-action="manager-${kind}" data-id="${x.esc(row.id)}"><span><strong>${isRefund ? '退款' : x.esc(CHANNELS[row.channel] || '收款')} · ${x.esc(row.clientId ? x.clientName(row.clientId) : '平台汇总')}</strong><small>${x.esc(row.date)} ${x.esc(row.time)} · ${x.esc(state)}</small><small>${x.esc(row.reference || (isRefund ? row.reason : PURPOSES[row.purpose]) || '查看明细')}</small></span><strong class="${row.status === 'revoked' ? 'revoked-amount' : isRefund ? 'cash-refund' : 'amount'}">${isRefund ? '−' : ''}${x.money(row.amount)}</strong>${x.ico('chevron-right',17)}</button>`;
}
function assessmentList(x,rows) {
  return latest(rows).map(row => `<div class="row"><div class="row-main"><strong>${x.esc(x.clientName(row.clientId))} · ${x.esc(row.project)}</strong><div class="meta">${x.esc(row.date)} ${x.esc(row.time)} · ${x.esc(ASSESSMENT_STATUS[row.status] || '待核对')}</div></div>${x.link('评估明细','manager-assessment',row.id)}</div>`).join('') || x.empty('当前范围没有本店评估记录。');
}
function records(ctx) {
  const x = helpers(ctx,true);
  const cashRows = latest([...(x.snapshot.receipts || []).map(row => ({...row,kind:'receipt'})),...(x.snapshot.refunds || []).map(row => ({...row,kind:'refund'}))]);
  const evaluations = x.snapshot.frontDeskEvaluations || [];
  return `<div class="manager-dashboard">${heading(x,'本店经营','按日期核对服务、收支、预约和评估。')}<div class="action-row manager-operations-links">${x.button('人员工作','nav','manager-team')}${x.button('本店排班','nav','schedules')}</div>${periodFilter(x)}<p class="boss-scope">${x.esc(x.all.store.name)} · ${x.esc(x.periodLabel)}</p>${cashHero(x,x.snapshot.cash,'所选日期实收',false)}${serviceLedger(x,x.snapshot.services || [])}<section class="section card"><div class="section-head"><h2>收支明细</h2><span class="muted">${cashRows.length} 笔</span></div>${cashRows.map(row => cashRow(x,row,row.kind)).join('') || x.empty('当前日期没有本店收支记录。')}<p class="meta">待结算、已结算原单和已撤销记录保留备查，不重复计入实收。</p></section>${fold(x,'预约记录',scheduled(x.snapshot.appointments || []),row => appointmentCard(x,row),'当前日期没有本店预约记录。')}${fold(x,'评估记录',x.snapshot.assessments || [],row => assessmentList(x,[row]),'当前日期没有本店评估记录。')}${fold(x,'前台考核记录',evaluations,row => `<div class="row"><div><strong>${x.esc(x.name('frontDesks',row.frontDeskId))}</strong><p class="meta">${x.esc(row.from)} 至 ${x.esc(row.to)} · ${row.status === 'voided' ? '已撤销' : '已记录'}</p></div>${x.link('考核明细','manager-frontdesk-evaluation',row.id)}</div>`,'当前日期没有本店前台考核记录。')}</div>`;
}

function therapistWork(x,person) {
  const valid = (x.snapshot.services || []).filter(row => row.status === 'valid');
  const main = valid.filter(row => row.principalId === person.id);
  const collaboration = valid.filter(row => row.principalId !== person.id && (row.participantIds || []).includes(person.id));
  return {main,collaboration,amount:serviceAmount(main)};
}
function frontDeskWork(x,person) {
  const arrivals = (x.all.appointments || []).filter(row => row.arrivalBy === person.id && row.arrivalByRole === 'frontdesk' && between(businessDate(row.arrivalAt),x.snapshot.from,x.snapshot.to));
  const receipts = (x.snapshot.receipts || []).filter(row => row.recordedBy === person.id && row.status === 'valid');
  const assessments = (x.snapshot.assessments || []).filter(row => row.recordedBy === person.id && row.status !== 'voided');
  return {arrivals,receipts,assessments};
}
function team(ctx) {
  const x = helpers(ctx,true);
  const therapists = x.all.therapists || [];
  const frontDesks = x.all.frontDesks || [];
  return `<div class="manager-dashboard">${heading(x,'本店人员工作','消费业绩看主服务，协作和前台工作分别看。')}${periodFilter(x)}<p class="boss-scope">${x.esc(x.all.store.name)} · ${x.esc(x.periodLabel)}</p><section class="boss-panel manager-panel"><div class="section-head"><h2>康复师</h2><span class="muted">${therapists.length} 位</span></div><div class="boss-people">${therapists.map(person => { const work = therapistWork(x,person); return `<button class="boss-person" type="button" data-action="manager-employee" data-id="therapist:${x.esc(person.id)}"><span class="boss-person-info"><strong>${x.esc(person.name)}</strong><span>${person.storeId === x.all.store.id ? '本店人员' : '跨店参与'}${person.active === false ? ' · 已停用' : ''} · 主服务 ${work.main.length} 次 · 协作 ${work.collaboration.length} 次</span></span><span class="boss-person-amount">${x.money(work.amount)}</span>${x.ico('chevron-right',17)}</button>`; }).join('') || x.empty('本店暂无康复师工作记录。')}</div><p class="manager-panel-note">只统计本店实际服务；全部消费业绩归主康复师，协作不重复计算。</p></section><section class="boss-panel manager-panel"><div class="section-head"><h2>前台</h2><span class="muted">${frontDesks.length} 位</span></div>${frontDesks.map(person => { const work = frontDeskWork(x,person); return `<button class="boss-person" type="button" data-action="manager-employee" data-id="frontdesk:${x.esc(person.id)}"><span class="boss-person-info"><strong>${x.esc(person.name)}${person.active === false ? ' · 已停用' : ''}</strong><span>到店确认 ${work.arrivals.length} 次 · 收款录入 ${work.receipts.length} 笔 · 评估录入 ${work.assessments.length} 条</span></span>${x.ico('chevron-right',17)}</button>`; }).join('') || x.empty('本店暂未分配前台。')}<p class="manager-panel-note">数量用于核对工作记录，不自动判断工作质量。前台考核结论由老板记录。</p></section></div>`;
}

export function renderManager(ctx) {
  if (ctx.view === 'manager-appointments') return appointmentsPage(ctx);
  if (ctx.view === 'manager-clients') return clientList(ctx);
  if (ctx.view === 'manager-records') return records(ctx);
  if (ctx.view === 'manager-team') return team(ctx);
  return overview(ctx);
}

function allowedRow(x,kind,id) {
  const row = (x.all[kind] || []).find(item => item.id === id);
  if (!row) throw new Error('记录不存在或不在本店权限内');
  return row;
}
function servicePhotos(x,row) {
  const photos = row.evidencePhotos || [];
  if (!photos.length) return '<p class="meta">历史服务未留照片。</p>';
  return `<section class="service-evidence"><div class="section-head"><h3>消课留底照片</h3>${x.tag(`${photos.length} 张`,'green')}</div><p class="meta">点击查看本次服务照片，按需加载。</p><div class="evidence-grid">${photos.map((photo,index) => `<button type="button" class="btn btn-outline" data-action="service-photo" data-id="${x.esc(row.id)}" data-photo-id="${x.esc(photo.id)}">查看留底照片 ${index + 1}</button>`).join('')}</div></section>`;
}

export function managerDialog(type,id,ctx) {
  const known = new Set(['manager-client','manager-service','manager-appointment','manager-receipt','manager-refund','manager-assessment','manager-frontdesk-evaluation','manager-employee']);
  if (!known.has(type)) throw new Error('店长仅能查看本店工作记录');
  const x = helpers(ctx,type === 'manager-employee');
  const close = `<div class="dialog-footer">${x.button('返回','close-dialog','','btn-quiet')}</div>`;
  let title = '',html = '';
  if (type === 'manager-client') {
    const row = allowedRow(x,'clients',id);
    const services = (x.all.services || []).filter(item => item.clientId === id);
    const appointments = scheduled((x.all.appointments || []).filter(item => item.clientId === id));
    const assessments = (x.all.assessments || []).filter(item => item.clientId === id);
    const tasks = (x.all.tasks || []).filter(item => item.clientId === id && item.type !== 'review_followup');
    title = `${row.name}的档案`;
    html = `<p class="muted">各门店套餐分别使用，下方只显示本店套餐及工作记录。</p>${x.detail([['年龄',row.age!=null?`${row.age} 岁`:'未填写'],['主要问题（客户自述）',row.problem || '未填写'],['手机',row.phone || '待补充'],['负责康复师',x.name('therapists',row.ownerId)],['当前套餐',row.packageName || '待完善'],['剩余 / 总次数',`${row.remaining} / ${row.total} 次`],['康复目标',row.goal || row.planName || '待完善'],['当前阶段',row.phase || '待康复师更新']])}<div class="note"><strong>下一步</strong><p>${x.esc(row.nextStep || '待康复师更新')}</p></div><h3>康复进展</h3><p>${x.esc(row.progress?.summary || '待康复师评估后更新')}</p>${row.homeAdvice ? `<h3>居家建议</h3><p>${x.esc(row.homeAdvice)}</p>` : ''}<h3>本店预约</h3>${appointments.map(item => appointmentCard(x,item)).join('') || x.empty('该客户暂无本店预约记录。')}<h3>本店工作待办</h3>${tasks.map(item => `<div class="row"><div><strong>${x.esc(item.title)}</strong><p class="meta">${x.esc(x.actorName(item.assigneeId))} · ${x.esc(item.dueDate || '待安排')} · ${['completed','done'].includes(item.status) ? '已完成' : '待完成'}</p></div></div>`).join('') || x.empty('该客户暂无本店工作待办。')}<h3>初访与服务前确认</h3>${renderPaperIntakeList({...ctx,filters:{...ctx.filters,clientId:id,storeId:x.all.storeId}})}${serviceLedger(x,services,'本店服务历史')}<h3>本店评估</h3>${assessmentList(x,assessments)}`;
  } else if (type === 'manager-service') {
    const row = allowedRow(x,'services',id);
    title = '本店服务明细';
    html = `${x.detail([['客户',x.clientName(row.clientId)],['服务日期',`${row.date} ${row.time}`],['服务门店',x.all.store.name],['项目',row.project],['主康复师',x.name('therapists',row.principalId)],['协作人员',(row.participantIds || []).map(personId => x.name('therapists',personId)).join('、') || '无'],['消费业绩',`${x.money(row.amount)}${row.status === 'revoked' ? '（已冲回）' : ''}`],['使用次数',`${row.sessions || 1} 次${row.status === 'revoked' ? '（已恢复）' : ''}`],['登记人',x.actorName(row.recordedBy)],['记录状态',row.status === 'valid' ? '已完成' : '已撤销']])}<h3>服务小结</h3><p>${x.esc(row.notes || '未填写')}</p>${row.revokeReason ? `<div class="note">撤销原因：${x.esc(row.revokeReason)}</div>` : ''}${servicePhotos(x,row)}${x.clientLink(row.clientId)}`;
  } else if (type === 'manager-appointment') {
    const row = allowedRow(x,'appointments',id);
    title = '本店预约明细';
    html = `${x.detail([['客户',x.clientName(row.clientId)],['服务时间',`${row.date} ${row.time}`],['门店',x.all.store.name],['项目',row.project],['康复师',x.name('therapists',row.principalId)],['状态',APPOINTMENT_STATUS[row.status] || '待核对'],['到店情况',row.arrivalAt ? `已确认到店 · ${businessDate(row.arrivalAt)}` : '未记录到店']])}${row.groupId ? '<p class="note">同行预约，每位客户独立安排、分别消课。</p>' : ''}${row.request ? `<div class="note"><strong>申请改约至 ${x.esc(row.request.date)} ${x.esc(row.request.time)}</strong><p>${x.esc(row.requestNote || row.request.reason || '未填写说明')}</p></div>` : ''}${x.clientLink(row.clientId)}`;
  } else if (type === 'manager-receipt') {
    const row = allowedRow(x,'receipts',id);
    const refunds = (x.all.refunds || []).filter(item => item.receiptId === id);
    title = '本店收款记录';
    html = `${x.detail([['金额',x.money(row.amount)],['状态',CASH_STATUS[row.status] || '待核对'],['客户',row.clientId ? x.clientName(row.clientId) : '平台汇总'],['门店',x.all.store.name],['日期',`${row.date} ${row.time}`],['渠道',CHANNELS[row.channel] || '其他'],['用途',PURPOSES[row.purpose || row.businessType] || '其他'],['收款方式',METHODS[row.method] || row.method || '未记录'],['订单 / 账单',row.reference || '未填写'],['登记人',x.actorName(row.recordedBy)]])}${row.notes ? `<p>${x.esc(row.notes)}</p>` : ''}${row.voidReason ? `<div class="note">撤销原因：${x.esc(row.voidReason)}</div>` : ''}${row.parentId && (x.all.receipts || []).some(item => item.id === row.parentId) ? x.link('查看原待结算单','manager-receipt',row.parentId) : ''}${row.settlementReceiptId && (x.all.receipts || []).some(item => item.id === row.settlementReceiptId) ? x.link('查看到账记录','manager-receipt',row.settlementReceiptId) : ''}${refunds.length ? `<h3>关联退款</h3>${refunds.map(item => cashRow(x,item,'refund')).join('')}` : ''}`;
  } else if (type === 'manager-refund') {
    const row = allowedRow(x,'refunds',id);
    title = '本店退款记录';
    html = `${x.detail([['金额',x.money(row.amount)],['状态',row.status === 'valid' ? '已退款' : '已撤销'],['日期',`${row.date} ${row.time}`],['门店',x.all.store.name],['渠道',CHANNELS[row.channel] || '其他'],['登记人',x.actorName(row.recordedBy)]])}<h3>退款原因</h3><p>${x.esc(row.reason || '未填写')}</p>${row.voidReason ? `<div class="note">撤销原因：${x.esc(row.voidReason)}</div>` : ''}${(x.all.receipts || []).some(item => item.id === row.receiptId) ? x.link('查看原收款','manager-receipt',row.receiptId) : ''}`;
  } else if (type === 'manager-assessment') {
    const row = allowedRow(x,'assessments',id);
    title = '本店评估数据';
    html = `${x.detail([['客户',x.clientName(row.clientId)],['日期',`${row.date} ${row.time}`],['项目',row.project],['类型',row.type === 'initial' ? '初次评估' : '阶段复评'],['评估康复师',x.name('therapists',row.therapistId)],['录入人',x.actorName(row.recordedBy)],['状态',ASSESSMENT_STATUS[row.status] || '待核对'],['确认人',row.confirmedBy ? x.actorName(row.confirmedBy) : '待确认']])}<dl class="evaluation-metrics">${(row.metrics || []).map(metric => `<div class="assessment-metric-row"><dt>${x.esc(metric.name)}</dt><dd>${x.esc(metric.value)} ${x.esc(metric.unit || '')}</dd></div>`).join('')}</dl><h3>评估记录说明</h3><p>${x.esc(row.summary || '未填写')}</p>${row.voidReason ? `<div class="note">撤销原因：${x.esc(row.voidReason)}</div>` : ''}${x.clientLink(row.clientId)}`;
  } else if (type === 'manager-frontdesk-evaluation') {
    const row = allowedRow(x,'frontDeskEvaluations',id);
    title = '本店前台考核';
    html = `${x.detail([['前台',x.name('frontDesks',row.frontDeskId)],['考核门店',x.all.store.name],['开始日期',row.from],['结束日期',row.to],['资料记录',CONCLUSIONS[row.dataConclusion] || '未观察'],['接待配合',CONCLUSIONS[row.receptionConclusion] || '未观察'],['收款交接',CONCLUSIONS[row.cashConclusion] || '未观察'],['记录状态',row.status === 'voided' ? '已撤销' : '老板已记录']])}<h3>考核说明</h3><p>${x.esc(row.summary || '未填写')}</p>${row.improvement ? `<div class="note"><strong>改进事项</strong><p>${x.esc(row.improvement)}</p><p>计划日期 ${x.esc(row.dueDate || '待安排')}</p></div>` : ''}${row.voidReason ? `<p class="notice">撤销原因：${x.esc(row.voidReason)}</p>` : ''}`;
  } else if (type === 'manager-employee') {
    const separator = String(id).indexOf(':');
    const kind = String(id).slice(0,separator),personId = String(id).slice(separator + 1);
    if (separator < 1 || !['therapist','frontdesk'].includes(kind)) throw new Error('人员不存在或不在本店权限内');
    const person = allowedRow(x,kind === 'therapist' ? 'therapists' : 'frontDesks',personId);
    title = `${person.name}的本店工作`;
    html = `<p class="muted">${x.esc(x.all.store.name)} · ${x.esc(x.periodLabel)}</p>`;
    if (kind === 'therapist') {
      const work = therapistWork(x,person);
      html += `<div class="note"><strong>主服务 ${work.main.length} 次 · 消费业绩 ${x.money(work.amount)}</strong><p>协作 ${work.collaboration.length} 次，协作不重复计算业绩。</p></div>${serviceLedger(x,work.main,'本店主服务')}${serviceLedger(x,work.collaboration,'本店协作记录')}`;
    } else {
      const work = frontDeskWork(x,person);
      const evaluations = (x.snapshot.frontDeskEvaluations || []).filter(row => row.frontDeskId === person.id);
      html += `${x.detail([['到店确认',`${work.arrivals.length} 次`],['有效收款录入',`${work.receipts.length} 笔`],['评估录入',`${work.assessments.length} 条`]])}<h3>到店确认记录</h3>${work.arrivals.map(row => appointmentCard(x,row)).join('') || x.empty('当前日期没有本店到店确认记录。')}<h3>收款录入记录</h3>${work.receipts.map(row => cashRow(x,row,'receipt')).join('') || x.empty('当前日期没有本店有效收款录入。')}<h3>评估录入记录</h3>${assessmentList(x,work.assessments)}<h3>老板考核记录</h3>${evaluations.map(row => `<div class="row"><span>${x.esc(row.from)} 至 ${x.esc(row.to)} · ${row.status === 'voided' ? '已撤销' : '已记录'}</span>${x.link('查看','manager-frontdesk-evaluation',row.id)}</div>`).join('') || x.empty('当前日期没有本店考核记录。')}`;
    }
  }
  return {title,html:`<div class="manager-detail">${html}${close}</div>`};
}
