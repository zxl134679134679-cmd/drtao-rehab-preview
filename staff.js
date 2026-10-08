/* Employee and owner views for the in-memory review prototype. */
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
  const pendingTasks = (state.tasks || []).filter(t => t.status !== 'completed' && t.status !== 'done' && (role.type === 'boss' || (t.assigneeId === role.id && clients.some(c => c.id === t.clientId)))).sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || a.title.localeCompare(b.title));
  const appointments = (state.appointments || []).filter(a => ['confirmed', 'reschedule_requested'].includes(a.status) && (role.type === 'boss' || (a.principalId === role.id && clients.some(c => c.id === a.clientId))));
  return { state, esc, find, name, ico, money, date, action, link, tag, role, client, clients, rows, inScope, pendingTasks, appointments };
}

function taskList(ctx, tasks, heading = '下一步待办') {
  const x = h(ctx);
  return `<section class="section card"><div class="section-head"><div><span class="eyebrow">跟进客户的每一步</span><h2>${x.esc(heading)}</h2></div>${x.tag(`${tasks.length} 项`)}</div><div class="line-list">${tasks.length ? tasks.map(t => `<div class="row"><div class="row-main"><strong>${x.esc(t.title)}</strong><div class="meta">${x.esc(x.client(t.clientId)?.name || '客户')} · ${x.esc(x.name('therapists', t.assigneeId))} · ${x.date(t.dueDate)}${t.dueDate && t.dueDate < TODAY ? ` ${x.tag('逾期待跟进', 'warn')}` : ''}</div></div><div class="action-row">${x.link('查看客户', 'client-detail', t.clientId)}${x.action(['reschedule', 'review_followup'].includes(t.type) ? '处理' : '完成', 'task-complete', t.id, 'btn-small btn-outline', 'check')}</div></div>`).join('') : '<div class="empty">待办已完成，下一步安排会显示在这里。</div>'}</div></section>`;
}

function appointmentList(ctx, appointments) {
  const x = h(ctx);
  return `<section class="section card"><div class="section-head"><h2>服务安排</h2>${x.action('安排服务', 'appointment-create', '', 'btn-small btn-outline', 'plus')}</div><div class="line-list">${appointments.length ? appointments.map(a => `<div class="row"><div class="row-main"><div class="appointment-time">${x.date(a.date)} · ${x.esc(a.time)} ${a.date < TODAY ? x.tag('到店情况待确认', 'warn') : ''}</div><strong>${x.esc(x.client(a.clientId)?.name || '客户')} · ${x.esc(a.project)}</strong>${a.status === 'reschedule_requested' ? `<div class="note">客户申请改约至 ${x.date(a.request?.date)} ${x.esc(a.request?.time)} · ${x.esc(a.requestNote)}</div>` : ''}<div class="meta">${x.esc(x.name('stores', a.storeId))} · 主康复师 ${x.esc(x.name('therapists', a.principalId))}${(a.participantIds || []).length ? ` · 协作 ${x.esc(a.participantIds.map(id => x.name('therapists', id)).join('、'))}` : ''}</div></div><div class="action-row">${x.link('客户档案', 'client-detail', a.clientId)}${a.date <= TODAY ? `${x.action(a.date < TODAY ? '补登记服务' : '登记本次服务', 'register-appointment', a.id, 'btn-small btn-primary')}${x.action('未到店', 'appointment-no-show', a.id, 'btn-small btn-outline')}` : ''}${x.action('改约', 'appointment-edit', a.id, 'btn-small btn-outline')}${x.action('取消', 'appointment-cancel', a.id, 'btn-small btn-quiet')}</div></div>`).join('') : '<div class="empty">暂无待服务安排。添加预约后，客户也能查看。</div>'}</div></section>`;
}

function pendingArrivalList(ctx, appointments) {
  const x = h(ctx);
  return `<section class="section card"><div class="section-head"><h2>到店情况待确认</h2>${x.tag(`${appointments.length} 条`, appointments.length ? 'warn' : '')}</div><p class="muted">以下预约日期已过，请核实实际到店情况。已服务可补登记；未到店请记录原因，也可改约或取消。</p><div class="line-list">${appointments.length ? appointments.map(a => `<div class="row"><div class="row-main"><strong>${x.esc(x.client(a.clientId)?.name || '客户')} · ${x.esc(a.project)}</strong><div class="meta">${x.date(a.date)} ${x.esc(a.time)} · ${x.esc(x.name('stores', a.storeId))} · 主康复师 ${x.esc(x.name('therapists', a.principalId))}</div>${a.status === 'reschedule_requested' ? `<div class="meta">客户申请改约至 ${x.date(a.request?.date)} ${x.esc(a.request?.time)}</div>` : ''}</div><div class="action-row">${x.link('客户档案', 'client-detail', a.clientId)}${x.action('补登记服务', 'register-appointment', a.id, 'btn-small btn-primary')}${x.action('未到店', 'appointment-no-show', a.id, 'btn-small btn-outline')}${x.action('改约', 'appointment-edit', a.id, 'btn-small btn-outline')}${x.action('取消', 'appointment-cancel', a.id, 'btn-small btn-quiet')}</div></div>`).join('') : '<div class="empty">暂无日期已过且尚未确认到店情况的预约。</div>'}</div></section>`;
}

function clientFollowups(ctx) {
  const x = h(ctx);
  const f = ctx.filters || {};
  const clients = x.clients.filter(c => (!f.storeId || c.storeId === f.storeId) && (!f.therapistId || c.ownerId === f.therapistId));
  const low = clients.filter(c => ctx.model.remaining(c.id) <= 2).sort((a, b) => ctx.model.remaining(a.id) - ctx.model.remaining(b.id));
  const unplanned = clients.filter(c => !x.state.appointments.some(a => a.clientId === c.id && ['confirmed', 'reschedule_requested'].includes(a.status) && a.date >= TODAY));
  const reminder = (c, kind) => `<div class="row"><div class="row-main"><strong>${x.esc(c.name)}</strong><div class="meta">${x.esc(x.name('stores', c.storeId))} · 负责人 ${x.esc(x.name('therapists', c.ownerId))}</div><div class="meta">${kind === 'low' ? `当前套餐剩余 ${ctx.model.remaining(c.id)} 次${ctx.model.remaining(c.id) === 0 ? ' · 次数已用完' : ' · 建议安排阶段复评'}` : '今天及之后暂无待服务预约'}</div></div><div class="action-row">${x.link('客户档案', 'client-detail', c.id)}${x.link('套餐次数', 'package', c.id)}${kind === 'low' && ctx.model.remaining(c.id) === 0 && x.role.type === 'boss' ? x.action('续接套餐', 'renew-package', c.id, 'btn-small btn-primary') : ''}${kind === 'unplanned' ? x.action('安排服务', 'appointment-create', c.id, 'btn-small btn-outline') : ''}</div></div>`;
  return `<section class="section"><div class="section-head"><div><h2>客户跟进提醒</h2><p class="muted">按客户所属门店和负责人筛选。这是客户当前状态的提醒，不受消费业绩日期范围影响。</p></div></div><div class="split-grid"><section class="section card"><div class="section-head"><h2>套餐次数不足</h2>${x.tag(`${low.length} 位`, low.length ? 'warn' : '')}</div><p class="muted">当前套餐剩余 2 次及以下，建议结合阶段评估确认后续安排。</p><div class="line-list">${low.length ? low.map(c => reminder(c, 'low')).join('') : '<div class="empty">当前范围内没有剩余次数不足的客户。</div>'}</div></section><section class="section card"><div class="section-head"><h2>尚未安排下一次服务</h2>${x.tag(`${unplanned.length} 位`, unplanned.length ? 'warn' : '')}</div><p class="muted">已申请改约的预约，在工作人员确认前仍保留原安排。</p><div class="line-list">${unplanned.length ? unplanned.map(c => reminder(c, 'unplanned')).join('') : '<div class="empty">当前范围内客户已有待服务预约。</div>'}</div></section></div></section>`;
}

function ledger(ctx, services, title = '消费业绩明细', showOwner = true) {
  const x = h(ctx);
  return `<section class="section card"><div class="section-head"><h2>${x.esc(title)}</h2><span class="muted">${services.length} 条记录</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>客户 / 项目</th><th>日期 / 门店</th>${showOwner ? '<th>主康复师 / 协作</th>' : ''}<th>消费业绩</th><th>记录状态</th><th></th></tr></thead><tbody>${services.map(s => `<tr><td>${x.inScope(s) ? `<button class="text-link" data-action="client-detail" data-id="${x.esc(s.clientId)}">${x.esc(x.client(s.clientId)?.name || '客户')}</button>` : `<span>${x.esc(x.client(s.clientId)?.name || '客户')}</span>`}<div class="meta">${x.esc(s.project)}</div></td><td>${x.date(s.date)} ${x.esc(s.time)}<div class="meta">${x.esc(x.name('stores', s.storeId))}</div></td>${showOwner ? `<td>${x.esc(x.name('therapists', s.principalId))}<div class="meta">${(s.participantIds || []).length ? `协作：${x.esc(s.participantIds.map(id => x.name('therapists', id)).join('、'))}` : '独立服务'}</div></td>` : ''}<td><span class="${s.status === 'revoked' ? 'revoked-amount' : 'amount'}">${x.money(s.amount)}</span></td><td>${x.tag(s.status === 'revoked' ? '已撤销' : '已完成', s.status === 'revoked' ? 'warn' : 'green')}</td><td>${x.link('查看明细', 'service-detail', s.id)}</td></tr>`).join('')}</tbody></table>${!services.length ? '<div class="empty">当前筛选下没有服务记录。</div>' : ''}</div></section>`;
}

function filters(ctx, includeTherapists = true) {
  const x = h(ctx);
  const f = ctx.filters || {};
  return `<form class="filters" data-form="filters"><label class="field"><span>门店</span><select name="storeId"><option value="">全部门店</option>${x.state.stores.map(s => `<option value="${x.esc(s.id)}" ${f.storeId === s.id ? 'selected' : ''}>${x.esc(s.name)}</option>`).join('')}</select></label>${includeTherapists ? `<label class="field"><span>康复师</span><select name="therapistId"><option value="">全部康复师</option>${x.state.therapists.map(t => `<option value="${x.esc(t.id)}" ${f.therapistId === t.id ? 'selected' : ''}>${x.esc(t.name)}</option>`).join('')}</select></label>` : ''}<label class="field"><span>开始日期</span><input type="date" name="from" value="${x.esc(f.from || '')}"></label><label class="field"><span>结束日期</span><input type="date" name="to" value="${x.esc(f.to || '')}"></label><button class="btn btn-primary" type="submit">查看</button>${x.action('清除筛选', 'reset-filters', '', 'btn-quiet')}</form>`;
}

function work(ctx) {
  const x = h(ctx);
  const name = x.name('therapists', x.role.id);
  const todayServices = x.rows({from: TODAY, to: TODAY}).filter(s => s.principalId === x.role.id && s.status === 'valid');
  const todayAppointments = x.appointments.filter(a => a.date === TODAY).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const next = x.appointments.filter(a => a.date >= TODAY).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  const nextClient = next && x.client(next.clientId);
  const pending = ctx.model.pendingAppointments(x.role);
  return `<div class="page-head"><div><span class="eyebrow">10月08日 · 周四</span><h1>${x.esc(name)}，今天好</h1><p class="muted">每次服务都有记录，每位客户都有下一步。</p></div>${x.action('登记已完成服务', 'register', nextClient?.id || x.clients[0]?.id || '', 'btn-primary', 'plus')}</div>
  <div class="stat-grid"><div class="stat"><span>今日待服务</span><strong>${todayAppointments.length}<small> 位</small></strong></div><div class="stat"><span>今日已完成</span><strong>${todayServices.length}<small> 次</small></strong></div><div class="stat"><span>今日消费业绩</span><strong>${x.money(todayServices.reduce((sum, s) => sum + s.amount, 0))}</strong></div><div class="stat"><span>到店情况待确认</span><strong>${pending.length}<small> 条</small></strong></div></div>
  ${nextClient ? `<section class="section card next-service"><div class="section-head"><div><span class="eyebrow">下一位客户</span><h2>${x.esc(nextClient.name)}</h2></div>${x.tag(`剩余 ${ctx.model.remaining(nextClient.id)} 次`, ctx.model.remaining(nextClient.id) <= 2 ? 'warn' : 'green')}</div><div class="appointment-time">${x.date(next.date)} · ${x.esc(next.time)} · ${x.esc(x.name('stores', next.storeId))}</div><p>${x.esc(next.project)}</p><div class="meta">客户负责人 ${x.esc(x.name('therapists', nextClient.ownerId))} · 本次主康复师 ${x.esc(x.name('therapists', next.principalId))}</div><div class="note">下一步：${x.esc(nextClient.nextStep || '完成评估后，由负责康复师安排下一步。')}</div><div class="action-row">${x.action('查看客户档案', 'client-detail', nextClient.id, 'btn-outline')}${next.date <= TODAY ? x.action('登记本次服务', 'register-appointment', next.id, 'btn-primary', 'clipboard-text') : x.action('调整服务安排', 'appointment-edit', next.id, 'btn-outline', 'calendar')}</div></section>` : `<section class="section card"><h2>暂无待服务安排</h2><p class="muted">您可以核实已过日期的预约，为客户安排下一次服务。</p>${x.action('安排下一次服务', 'appointment-create', '', 'btn-outline', 'calendar')}</section>`}
  <div class="split-grid">${taskList(ctx, x.pendingTasks.slice(0, 6))}${pendingArrivalList(ctx, pending)}</div>${clientFollowups(ctx)}${appointmentList(ctx, x.appointments.slice().sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)))}`;
}

function clientList(ctx) {
  const x = h(ctx);
  const f = ctx.filters || {};
  const q = (f.query || '').trim().toLowerCase();
  const visible = x.clients.filter(c => (!f.storeId || c.storeId === f.storeId) && (!f.therapistId || c.ownerId === f.therapistId) && (!q || `${c.name} ${c.phone || ''}`.toLowerCase().includes(q)));
  return `<div class="page-head"><div><span class="eyebrow">客户档案</span><h1>${x.role.type === 'boss' ? '所有客户' : '我的客户'}</h1><p class="muted">${x.role.type === 'boss' ? '多店共用一份档案，跨店服务清晰可追溯。' : '查看您负责或实际参与过服务的客户。'}</p></div>${x.role.type === 'boss' ? x.action('录入纸质档案', 'import-opening', '', 'btn-primary', 'plus') : ''}</div><form class="toolbar" data-form="client-search"><label class="field search-field"><span class="sr-only">搜索客户姓名或手机号</span><input name="query" type="search" placeholder="搜索客户姓名或手机号" value="${x.esc(q)}"></label><button class="btn btn-outline" type="submit">${x.ico('search', 18)}搜索</button></form><div class="client-grid">${visible.length ? visible.map(c => `<article class="card person-card"><div class="section-head"><div><h2>${x.esc(c.name)}</h2><span class="meta">${x.esc(x.name('stores', c.storeId))}</span></div><div class="metric"><strong>${ctx.model.remaining(c.id)}</strong><span>剩余次数</span></div></div><div class="meta">负责人 ${x.esc(x.name('therapists', c.ownerId))} ${c.ownerId === x.role.id ? x.tag('我负责', 'green') : x.role.type === 'therapist' ? x.tag('参与服务') : ''}</div><p class="client-goal">${x.esc(c.goal || '康复目标待评估后完善')}</p><div class="note"><span class="muted">下一步</span><p>${x.esc(c.nextStep || '由负责康复师制定下一步安排')}</p></div><div class="action-row">${x.action('查看档案', 'client-detail', c.id, 'btn-outline')}${x.action('登记服务', 'register', c.id, 'btn-primary')}${x.role.type === 'boss' ? x.link('转交负责人', 'transfer-client', c.id) : ''}</div></article>`).join('') : '<div class="empty card">未找到符合条件的客户。</div>'}</div>`;
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
  return `<div class="page-head"><div><span class="eyebrow">实际服务产生的业绩</span><h1>${tid ? `${x.esc(x.name('therapists', tid))}的业绩` : '康复师业绩'}</h1><p class="muted">以每次已完成服务为依据，点击明细核对客户、门店和服务人员。</p></div></div>${filters(ctx, x.role.type === 'boss')}<div class="stat-grid"><div class="stat"><span>消费业绩</span><strong>${x.money(total)}</strong></div><div class="stat"><span>主康复师服务</span><strong>${valid.length}<small> 次</small></strong></div><div class="stat"><span>协作参与</span><strong>${tid ? collabs.filter(s => s.status === 'valid').length : valid.reduce((sum, s) => sum + (s.participantIds || []).length, 0)}<small> 次</small></strong></div><div class="stat"><span>已撤销记录</span><strong>${services.filter(s => s.status === 'revoked').length}<small> 条</small></strong></div></div><div class="note">一次服务扣 1 次；消费业绩全部归本次主康复师。协作记录单独保留。</div>${ledger(ctx, services)}${tid ? `<section class="section card"><div class="section-head"><h2>协作服务记录</h2>${x.tag('参与记录')}</div><p class="muted">您参与了以下服务，消费业绩归相应主康复师。</p><div class="line-list">${collabs.length ? collabs.map(s => `<div class="row"><div class="row-main"><strong>${x.esc(x.client(s.clientId)?.name)} · ${x.esc(s.project)}</strong><div class="meta">${x.date(s.date)} · ${x.esc(x.name('stores', s.storeId))} · 主康复师 ${x.esc(x.name('therapists', s.principalId))}</div></div><div class="row-side">${x.tag(s.status === 'revoked' ? '已撤销' : '协作参与', s.status === 'revoked' ? 'warn' : '')}${x.link('查看明细', 'service-detail', s.id)}</div></div>`).join('') : '<div class="empty">当前日期范围内暂无协作服务。</div>'}</div></section>` : ''}`;
}

function overview(ctx) {
  const x = h(ctx);
  const all = x.rows(ctx.filters || {});
  const valid = all.filter(s => s.status === 'valid');
  const pending = ctx.model.pendingAppointments(x.role, ctx.filters || {});
  const reviews = (x.state.reviews || []).filter(r => r.followupStatus === 'pending' && all.some(s => s.id === r.serviceId));
  const therapists = x.state.therapists.filter(t => !ctx.filters?.therapistId || t.id === ctx.filters.therapistId);
  return `<div class="page-head"><div><span class="eyebrow">所有门店，统一管理</span><h1>老板概览</h1><p class="muted">把服务、消费业绩与待跟进事项放在一起核对。</p></div>${x.action('登记服务', 'register', x.clients[0]?.id || '', 'btn-primary', 'plus')}</div>${filters(ctx)}
  <div class="stat-grid"><div class="stat"><span>消费业绩</span><strong>${x.money(valid.reduce((sum, s) => sum + s.amount, 0))}</strong></div><div class="stat"><span>已完成服务</span><strong>${valid.length}<small> 次</small></strong></div><div class="stat"><span>到店情况待确认</span><strong>${pending.length}<small> 条</small></strong></div><div class="stat"><span>评价待回访</span><strong>${reviews.length}<small> 条</small></strong></div></div>
  <section class="section card"><div class="section-head"><h2>人员消费业绩</h2><span class="muted">同一服务仅计一次</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>康复师</th><th>所属门店</th><th>主康复师服务</th><th>消费业绩</th><th>协作参与</th><th></th></tr></thead><tbody>${therapists.map(t => { const own = valid.filter(s => s.principalId === t.id); const part = valid.filter(s => (s.participantIds || []).includes(t.id) && s.principalId !== t.id); return `<tr><td><strong>${x.esc(t.name)}</strong></td><td>${x.esc(x.name('stores', t.storeId))}</td><td>${own.length} 次</td><td class="amount">${x.money(own.reduce((sum, s) => sum + s.amount, 0))}</td><td>${part.length} 次</td><td>${x.link('业绩明细', 'therapist-performance', t.id)}</td></tr>`; }).join('')}</tbody></table></div></section>
  <div class="split-grid">${pendingArrivalList(ctx, pending)}<section class="section card"><div class="section-head"><h2>客户评价待回访</h2>${x.tag(`${reviews.length} 条`, reviews.length ? 'warn' : '')}</div><div class="line-list">${reviews.length ? reviews.map(r => { const s = x.find('services', r.serviceId); return `<div class="row"><div class="row-main"><strong>${x.esc(x.client(s?.clientId || r.clientId)?.name || '客户')} · ${x.esc(r.score || r.rating)} 分</strong><p>${x.esc(r.feedback || r.comment || r.text || '客户希望工作人员联系。')}</p><div class="meta">${x.date(s?.date)} · ${x.esc(x.name('stores', s?.storeId))}</div></div>${x.action('记录回访', 'followup', r.id, 'btn-small btn-outline')}</div>`; }).join('') : '<div class="empty">暂无需要回访的评价。</div>'}</div></section></div>${clientFollowups(ctx)}${taskList(ctx, x.pendingTasks)}${ledger(ctx, all, '全部服务记录')}`;
}

function team(ctx) {
  const x = h(ctx);
  return `<div class="page-head"><div><span class="eyebrow">门店与人员</span><h1>随着新门店一起成长</h1><p class="muted">新增门店和账号后，继续使用同一套客户档案和服务记录。</p></div><div class="action-row">${x.action('新增门店', 'add-store', '', 'btn-outline', 'plus')}${x.action('新增康复师', 'add-therapist', '', 'btn-primary', 'users')}</div></div><section class="section"><div class="section-head"><h2>门店</h2><span class="muted">${x.state.stores.length} 家门店</span></div><div class="client-grid">${x.state.stores.map(s => `<article class="card person-card"><span class="eyebrow">${x.ico('map-pin', 18)} 服务门店</span><h2>${x.esc(s.name)}</h2><p class="muted">${x.esc(s.address || '地址待完善')}</p><div class="meta">${x.state.therapists.filter(t => t.storeId === s.id && t.active !== false).length} 位康复师 · 客户档案跨店共享</div></article>`).join('')}</div></section><section class="section card"><div class="section-head"><h2>康复师账号</h2><span class="muted">停用账号会保留历史服务</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>康复师</th><th>所属门店</th><th>负责客户</th><th>账号状态</th><th>操作</th></tr></thead><tbody>${x.state.therapists.map(t => `<tr><td><strong>${x.esc(t.name)}</strong></td><td>${x.esc(x.name('stores', t.storeId))}</td><td>${x.state.clients.filter(c => c.ownerId === t.id).length} 位</td><td>${x.tag(t.active === false ? '已停用' : '使用中', t.active === false ? '' : 'green')}</td><td><div class="action-row">${x.link('业绩明细', 'therapist-performance', t.id)}${t.active !== false ? x.action('停用', 'deactivate-therapist', t.id, 'btn-small btn-quiet') : ''}</div></td></tr>`).join('')}</tbody></table></div></section><section class="section card"><div class="section-head"><div><h2>旧档案迁入</h2><p class="muted">录入客户、负责人和期初剩余次数。历史已使用次数不自动计入新系统消费业绩。</p></div>${x.action('录入一位客户', 'import-opening', '', 'btn-outline', 'plus')}</div></section>`;
}

export function renderStaff(ctx) {
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
  const x = h(ctx);
  const c = x.client(id);
  const clients = x.clients;
  const active = x.state.therapists.filter(t => t.active !== false);
  const opts = (items, selected, empty = '') => `${empty ? `<option value="">${x.esc(empty)}</option>` : ''}${items.map(item => `<option value="${x.esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${x.esc(item.name)}</option>`).join('')}`;
  const select = (label, name, items, selected, extra = '') => `<label class="field"><span>${x.esc(label)}</span><select name="${name}" required ${extra}>${opts(items, selected)}</select></label>`;
  const input = (label, name, value = '', type = 'text', extra = '') => `<label class="field"><span>${x.esc(label)}</span><input name="${name}" type="${type}" value="${x.esc(value)}" ${extra}></label>`;
  const textarea = (label, name, value = '', extra = '') => `<label class="field span-all"><span>${x.esc(label)}</span><textarea name="${name}" rows="3" ${extra}>${x.esc(value)}</textarea></label>`;
  const hidden = (name, value) => `<input type="hidden" name="${name}" value="${x.esc(value)}">`;
  const submit = label => `<div class="dialog-footer"><button class="btn btn-primary" type="submit">${x.esc(label)}</button>${x.action('返回', 'close-dialog', '', 'btn-quiet')}</div>`;
  const form = (name, body, label) => `<form data-form="${name}">${body}${submit(label)}</form>`;

  if (type === 'register' || type === 'register-appointment') {
    const ap = type === 'register-appointment' ? x.state.appointments.find(a => a.id === id && ['confirmed', 'reschedule_requested'].includes(a.status) && clients.some(c => c.id === a.clientId)) : null;
    if (type === 'register-appointment' && !ap) return {title: '按预约登记服务', html: '<div class="empty">该预约已处理或不在您的服务范围内，请返回后查看最新安排。</div>'};
    if (ap && ap.date > TODAY) return {title: '按预约登记服务', html: '<div class="empty">此预约日期尚未到，实际服务完成后再登记。</div>'};
    const selected = ap ? x.client(ap.clientId) : c || clients[0];
    if (!selected) return {title: '登记服务', html: '<div class="empty">暂无可登记服务的客户。</div>'};
    const pkg = x.find('packages', selected.packageId);
    const remaining = ctx.model.remaining(selected.id);
    if (remaining < 1) return {title: `${selected.name}的套餐次数已用完`, html: `<div class="note"><strong>当前套餐剩余 ${remaining} 次，暂不能登记服务。</strong><p>请由老板核对套餐并确认续接，或切换到仍有次数的套餐，再登记实际完成的服务。</p></div><div class="action-row">${x.action('查看套餐次数', 'package', selected.id, 'btn-outline')}${x.action('查看客户档案', 'client-detail', selected.id, 'btn-outline')}${x.role.type === 'boss' ? x.action('续接套餐', 'renew-package', selected.id, 'btn-primary') : ''}</div>`};
    const todayAp = ap || x.appointments.find(a => a.clientId === selected.id && a.date === TODAY);
    const principal = ap?.principalId || (x.role.type === 'therapist' ? x.role.id : todayAp?.principalId || selected.ownerId);
    const fields = ap
      ? `${hidden('appointmentId', ap.id)}${hidden('storeId', ap.storeId)}${hidden('principalId', ap.principalId)}<div class="field"><span>服务门店 · 按预约</span><strong>${x.esc(x.name('stores', ap.storeId))}</strong></div><div class="field"><span>本次主康复师 · 按预约</span><strong>${x.esc(x.name('therapists', ap.principalId))}</strong></div>${input('服务日期 · 按预约', 'date', ap.date, 'date', 'readonly required')}${input('服务时间 · 按预约', 'time', ap.time, 'time', 'readonly required')}${input('服务项目 · 按预约', 'project', ap.project, 'text', 'readonly required')}`
      : `${select('服务门店', 'storeId', x.state.stores, todayAp?.storeId || selected.storeId)}${select('本次主康复师', 'principalId', active, principal)}${input('服务日期', 'date', TODAY, 'date', `required max="${TODAY}"`)}${input('服务时间', 'time', todayAp?.time || '11:30', 'time', 'required')}${input('服务项目', 'project', todayAp?.project || '基础训练与阶段复评', 'text', 'required maxlength="60"')}`;
    return {title: ap && ap.date < TODAY ? '补登记已完成的预约服务' : '登记已完成服务', html: form(type, `<p class="muted">服务完成后登记，每次扣 1 次，消费业绩归本次主康复师。</p><div class="note"><strong>${x.esc(selected.name)} · 当前套餐剩余 ${remaining} 次</strong><div class="meta">客户负责人：${x.esc(x.name('therapists', selected.ownerId))} · 单次消费业绩 ${x.money(pkg && pkg.total ? pkg.amount / pkg.total : 0)}</div></div>${ap ? `<div class="note"><strong>关联预约：${x.date(ap.date)} ${x.esc(ap.time)} · ${x.esc(ap.project)}</strong><p>门店、主康复师、日期、时间与项目已按这条预约锁定。提交后仅将本条预约标记为已完成。</p></div>` : '<p class="muted">请按实际服务填写；如需按预约补登记，请从服务安排进入。</p>'}<div class="form-grid">${hidden('clientId', selected.id)}${fields}<fieldset class="field span-all"><legend>其他参与康复师（可多选）</legend><div class="checkbox-grid">${active.map(t => `<label class="check"><input type="checkbox" name="participantIds" value="${x.esc(t.id)}" ${(ap?.participantIds || []).includes(t.id) ? 'checked' : ''}><span>${x.esc(t.name)} <small>${x.esc(x.name('stores', t.storeId))}</small></span></label>`).join('')}</div><span class="muted">参与人员保留协作记录，主康复师不重复计为协作。</span></fieldset>${textarea('本次服务小结', 'notes', '', 'required placeholder="用客户看得懂的话，记录本次评估、训练内容与下一步；客户也能查看"')}</div><div class="note">登记人：${x.esc(x.role.type === 'boss' ? '老板' : x.name('therapists', x.role.id))}。提交成功后，客户次数与消费业绩同时更新。</div>`, '确认登记 · 使用 1 次')};
  }

  if (type === 'renew-package') {
    if (x.role.type !== 'boss' || !c) return null;
    const pkg = x.find('packages', c.packageId);
    const remaining = ctx.model.remaining(c.id);
    if (remaining > 0) return {title: `核对${c.name}的后续套餐`, html: `<div class="note"><strong>当前套餐剩余 ${remaining} 次，请用完后再续套餐。</strong><p>您可以先核对套餐记录和客户的后续服务安排。</p></div><div class="action-row">${x.action('查看套餐次数', 'package', c.id, 'btn-outline')}${x.action('查看客户档案', 'client-detail', c.id, 'btn-outline')}${x.action('安排下一次服务', 'appointment-create', c.id, 'btn-primary')}</div>`};
    return {title: `为${c.name}续接套餐`, html: form('renew-package', `${hidden('clientId', c.id)}<div class="note"><strong>${x.esc(c.name)} · 当前套餐剩余 ${remaining} 次</strong><p>当前套餐次数已用完，可核对并登记后续套餐。历史服务与原套餐记录会保留。</p></div><p class="muted">只登记套餐，不收款，不生成消费业绩。每次实际服务登记时，才扣次数并产生消费业绩。</p><div class="form-grid">${input('新套餐名称', 'name', pkg?.name || '运动功能恢复套餐', 'text', 'required maxlength="60"')}${input('套餐金额（元）', 'amount', pkg?.amount || 3000, 'number', 'required min="0.01" step="0.01"')}${input('套餐总次数', 'total', pkg?.total || 10, 'number', 'required min="1" max="999" step="1"')}${textarea('核对依据与续接说明', 'reason', '', 'required maxlength="500" placeholder="说明已确认的套餐安排、核对依据和接续原因"')}</div>`, '确认登记后续套餐')};
  }

  if (type === 'edit-plan') {
    if (!c) return null;
    return {title: `更新${c.name}的康复计划`, html: form('edit-plan', `${hidden('clientId', c.id)}<p class="muted">用客户能理解的语言说明目标、当前进展和下一步。套餐次数不能代替康复进展。</p><div class="form-grid">${input('康复目标', 'goal', c.goal, 'text', 'required maxlength="80"')}${input('当前阶段', 'phase', c.phase, 'text', 'required maxlength="60"')}${textarea('计划安排', 'planNotes', c.planNotes, 'required')}${textarea('下一步', 'nextStep', c.nextStep, 'required')}${textarea('本次评估后的进展说明', 'progressSummary', c.progress?.summary || '', 'placeholder="没有完成评估时可留空，客户会看到待更新状态"')}${textarea('居家建议', 'homeAdvice', c.homeAdvice || '', 'required placeholder="只填写本次评估后适用于该客户的建议"')}<div class="span-all"><h3>安排一个下一步任务（可选）</h3></div>${input('待办事项', 'taskTitle', '', 'text', 'maxlength="80"')}${select('负责人', 'assigneeId', active, c.ownerId)}${input('计划日期', 'dueDate', '2026-10-10', 'date')}</div>`, '保存计划并更新客户页面')};
  }

  if (type === 'appointment-create' || type === 'appointment-edit') {
    const ap = type === 'appointment-edit' ? x.find('appointments', id) : null;
    const selected = ap?.clientId || c?.id || clients[0]?.id;
    if (!clients.length) return {title: '安排服务', html: '<div class="empty">暂无可安排服务的客户。</div>'};
    return {title: ap ? '调整服务安排' : '安排下一次服务', html: form(type, `${ap ? hidden('id', ap.id) : ''}<p class="muted">预约仅安排时间，不扣套餐次数。实际服务完成后再登记。</p><div class="form-grid">${ap ? `${hidden('clientId', selected)}<div class="field"><span>客户</span><strong>${x.esc(x.client(selected)?.name)}</strong></div>` : select('客户', 'clientId', clients, selected)}${select('服务门店', 'storeId', x.state.stores, ap?.storeId || c?.storeId || x.state.stores[0]?.id)}${select('主康复师', 'principalId', active, ap?.principalId || (x.role.type === 'therapist' ? x.role.id : c?.ownerId || active[0]?.id))}${input('服务项目', 'project', ap?.project || '阶段复评与训练', 'text', 'required maxlength="60"')}${input('日期', 'date', ap?.request?.date || ap?.date || '2026-10-10', 'date', `required min="${TODAY}"`)}${input('开始时间', 'time', ap?.request?.time || ap?.time || '10:00', 'time', 'required')}</div><div class="note">系统会检查康复师同一时间的服务冲突。</div>`, ap ? '保存新的安排' : '确认安排')};
  }

  if (type === 'followup') {
    const r = x.find('reviews', id);
    if (!r) return null;
    const s = x.find('services', r.serviceId);
    return {title: '记录客户回访', html: form('followup', `${hidden('reviewId', id)}<div class="note"><strong>${x.esc(x.client(s?.clientId || r.clientId)?.name || '客户')} · ${x.esc(r.score || r.rating)} 分</strong><p>${x.esc(r.feedback || r.comment || r.text || '客户希望工作人员联系。')}</p></div><div class="form-grid"><div class="field"><span>处理人</span><strong>老板</strong></div>${textarea('沟通情况与后续安排', 'result', r.resolution || '', 'required maxlength="1000" placeholder="记录已了解的问题、和客户确认的安排及跟进时间"')}</div>`, '保存回访结果')};
  }

  if (type === 'add-store') {
    return {title: '新增门店', html: form('add-store', `<p class="muted">新店使用同一套客户档案，服务记录会标记实际服务门店。</p><div class="form-grid">${input('门店名称', 'name', '', 'text', 'required maxlength="30" placeholder="例如：C店 · 市北"')}${textarea('门店地址', 'address', '', 'required maxlength="120"')}</div>`, '新增门店')};
  }

  if (type === 'add-therapist') {
    return {title: '新增康复师', html: form('add-therapist', `<p class="muted">账号加入后，可以分配客户和安排服务。正式版本再接入真实手机号登录。</p><div class="form-grid">${input('姓名', 'name', '', 'text', 'required maxlength="20"')}${select('所属门店', 'storeId', x.state.stores, x.state.stores[0]?.id)}</div>`, '新增康复师')};
  }

  if (type === 'transfer-client') {
    if (!c) return null;
    return {title: `转交${c.name}的负责人`, html: form('transfer-client', `${hidden('clientId', c.id)}<div class="note">当前负责人：${x.esc(x.name('therapists', c.ownerId))}。转交后历史服务和业绩仍保留原归属。</div><div class="form-grid">${select('新的负责康复师', 'ownerId', active, c.ownerId)}${textarea('转交说明', 'reason', '', 'required placeholder="说明转交原因和需要接续的事项"')}</div>`, '确认转交')};
  }

  if (type === 'import-opening') {
    return {title: '录入纸质客户档案', html: form('import-opening', `<p class="muted">先核对纸质记录。期初已使用次数会保留，不计入上线后的消费业绩。</p><div class="form-grid">${input('客户姓名', 'name', '', 'text', 'required maxlength="30"')}${input('手机号', 'phone', '', 'tel', 'required maxlength="20"')}${select('所属门店', 'storeId', x.state.stores, x.state.stores[0]?.id)}${select('负责康复师', 'ownerId', active, active[0]?.id)}${input('套餐名称', 'packageName', '运动康复 10 次套餐', 'text', 'required maxlength="60"')}${input('套餐金额（元）', 'amount', 3000, 'number', 'required min="0.01" step="0.01"')}${input('套餐总次数', 'total', 10, 'number', 'required min="1" max="999" step="1"')}${input('期初剩余次数', 'openingRemaining', 9, 'number', 'required min="0" max="999" step="1"')}${textarea('已核对的原档案说明', 'notes', '', 'required placeholder="说明核对依据，例如纸档日期与已服务次数"')}</div><div class="note">如果姓名或手机号重复，请先核对已有客户，不要重复建立档案。</div>`, '确认核对并录入')};
  }

  if (type === 'revoke-service') {
    const s = x.find('services', id);
    if (!s) return null;
    return {title: '撤销错误的服务登记', html: form('revoke-service', `${hidden('id', id)}<div class="note"><strong>${x.esc(x.client(s.clientId)?.name)} · ${x.esc(s.project)}</strong><p>${x.date(s.date)} · ${x.esc(x.name('stores', s.storeId))} · ${x.esc(x.name('therapists', s.principalId))}</p><p>撤销后恢复本笔服务所用套餐的 1 次，并冲回 ${x.money(s.amount)} 消费业绩。原记录保留，协作记录同时标记撤销。</p></div>${textarea('撤销原因', 'reason', '', 'required maxlength="500" placeholder="请说明登记错误的具体原因"')}`, '确认撤销并恢复次数')};
  }
  return null;
}
