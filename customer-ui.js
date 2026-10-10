import { updateAppointmentAvailability, bookingAvailability } from './booking-availability.js?v=20261010-multi-day-booking-1';
import { customerBookingRows, customerBookingConfirmation, customerBookingHandling } from './customer-booking.js?v=20261010-multi-day-booking-1';

export const customerBookingTypes = new Set(['customer-booking', 'customer-booking-detail', 'customer-booking-cancel', 'customer-booking-confirm', 'customer-booking-resolve', 'customer-booking-accept']);
const statusLabels={pending:'待门店确认',confirmed:'申请已处理',cancelled:'申请已取消',reschedule_suggested:'门店建议 · 待您接受',rejected:'无法安排',expired:'申请已过期',suggestion_accepted:'已接受建议 · 新申请待确认'};

export function renderCustomerHome(ctx) {
  const { model, role, esc, icon, fmt: { date }, ui: { button, link, name, appointments, clientServices, reviewFor, selectedStoreId } } = ctx;
  const client = model.state.clients.find(c => c.id === role.id);
  const storeId = model.state.stores.some(store=>store.id===selectedStoreId&&store.active!==false)?selectedStoreId:client.storeId;
  const remaining = model.remainingInStore(client.id,storeId);
  const packs = model.availablePackages(client.id,storeId);
  const total = packs.reduce((sum,p)=>sum+p.total,0);
  const used = total - remaining;
  const storeBalances = model.state.stores.filter(store=>store.active!==false&&model.availablePackages(client.id,store.id).length).map(store=>({id:store.id,name:store.name,remaining:model.remainingInStore(client.id,store.id)}));
  const next = appointments(client.id)[0];
  const allRequests=customerBookingRows(model, role);
  const pending = allRequests.filter(row => ['pending','reschedule_suggested'].includes(row.status));
  const recentResults=allRequests.filter(row=>['rejected','expired'].includes(row.status)).slice(-2).reverse();
  const completed = clientServices(client.id).filter(row => row.status === 'valid');
  const recent = completed.find(row => !reviewFor(row.id)) || completed[0];
  const review = recent && reviewFor(recent.id);
  return `<div class="booking-home">
    <section class="booking-hero"><p>${esc(client.name)}，你好</p><h1>下次康复，轻松约好</h1><span class="booking-store-line">${model.state.stores.filter(s => s.active !== false).map(s => esc(s.name)).join(' · ')}</span>${button('预约康复','customer-booking',client.id,'booking-primary','arrow-right')}${button('一次约多天','multi-day-booking',client.id,'multi-day-entry')}<p class="booking-hero-hint">选择期望时间，门店确认后再到店</p></section>
    <div class="booking-content">
      <section class="booking-balance" aria-label="我的套餐次数"><label class="booking-store-filter"><span>查看哪个店的套餐</span><select data-customer-store aria-label="查看门店套餐">${model.state.stores.filter(store=>store.active!==false).map(store=>`<option value="${esc(store.id)}"${store.id===storeId?' selected':''}>${esc(store.name)}</option>`).join('')}</select></label><button data-action="package-store" data-id="${esc(client.id)}:${esc(storeId)}"><span>套餐剩余次数 <small class="tag tag-green">仅限${esc(name('stores',storeId))}</small></span><strong>${remaining}<em> 次</em></strong><small>${packs.length ? `已用 ${used} / 共 ${total} 次` : '暂无本店套餐'} · 查看使用明细 ${icon('chevron-right',14)}</small></button></section>
      ${storeBalances.length > 1 ? `<p class="booking-store-balances">${storeBalances.map(store=>`<span>${esc(store.name)} <strong>${store.remaining} 次</strong></span>`).join('')}<small>各店套餐分别使用</small></p>` : ''}
      ${remaining <= 2 ? `<p class="booking-low-balance">${remaining === 0 ? (packs.length?'本套餐次数已用完。仍可提交预约申请，后续服务费用请与门店确认。':'尚未办理本店套餐。仍可提交预约申请，服务费用请与门店确认。') : '剩余次数不多，后续安排可在到店时与康复师确认。'}</p>` : ''}
      ${pending.length ? `<section class="booking-panel booking-pending"><div class="booking-panel-head"><h2>预约申请</h2><span class="tag tag-warn">${pending.some(row=>row.status==='reschedule_suggested')?'有建议待接受':'待门店确认'}${pending.length > 1 ? ` · ${pending.length} 条` : ''}</span></div>${pending.slice(-2).reverse().map(row => `<div class="booking-pending-row"><div><strong>${date(row.status==='reschedule_suggested'?row.suggestedDate:row.date)} · ${esc(row.status==='reschedule_suggested'?row.suggestedTime:row.time)}</strong><p>${esc(name('stores',row.storeId))} · ${row.status==='reschedule_suggested'?'门店建议 · 等待您接受':'期望康复师 '+esc(name('therapists',row.principalId))}</p></div>${link('查看','customer-booking-detail',row.id)}</div>`).join('')}<p class="muted">收到确认后再到店；申请未扣次数、未收款。</p>${pending.length > 2 ? link('全部预约申请','appointment-history',client.id) : ''}</section>` : ''}
      ${recentResults.length ? `<section class="booking-panel"><div class="booking-panel-head"><h2>预约处理结果</h2></div>${recentResults.map(row=>`<div class="booking-pending-row"><div><strong>${date(row.date)} · ${esc(row.time)} · ${esc(statusLabels[row.status])}</strong><p>${esc(row.resolutionReason)}</p></div>${link('查看','customer-booking-detail',row.id)}</div>`).join('')}</section>` : ''}
      <section class="booking-panel"><div class="booking-panel-head"><h2>${icon('calendar',20)}下一次预约</h2>${next ? '<span class="tag tag-green">已确认</span>' : ''}</div>${next ? `<div class="booking-next-time">${date(next.date)} · ${esc(next.time)}</div><p class="booking-next-store">${esc(name('stores',next.storeId))}<span>康复师 ${esc(name('therapists',next.principalId))}</span></p><p class="booking-project">${esc(next.project)}</p>${next.status === 'reschedule_requested' ? `<p class="ease-request-note">申请改至 ${date(next.request?.date)} ${esc(next.request?.time || '')}，待门店确认，原预约仍保留。</p>` : ''}<div class="booking-panel-actions">${button('查看预约','appointment',next.id,'btn-outline')}${next.cancellationRequest?.status==='pending' ? '<p class="ease-request-note">取消申请待门店处理；确认取消前，原预约仍保留。</p>' : button(next.status === 'reschedule_requested' ? '查看改约申请' : '申请改约','reschedule',next.id,'btn-quiet')+button('申请取消','appointment-cancel-request',next.id,'btn-quiet')}</div>` : '<p class="booking-empty">还没安排下一次康复</p><p class="muted">点上方“预约康复”，选好门店和期望时间。</p>'}</section>
      <section class="booking-panel"><div class="booking-panel-head"><h2>${icon('star',20)}服务评价</h2>${recent ? `<span class="tag ${review ? 'tag-green' : ''}">${review ? '已评价' : '待评价'}</span>` : ''}</div>${recent ? `<h3>${review ? '感谢您的真实反馈' : '这次服务体验怎么样？'}</h3><p class="muted">${date(recent.date)} · ${esc(recent.project)} · ${esc(name('therapists',recent.principalId))}</p><div class="booking-panel-actions">${button(review ? '查看我的评价' : '评价本次服务','review',recent.id,'btn-outline')}</div><p class="booking-private">${icon('shield-check',15)}除您本人外，仅老板可查看评分与反馈</p>` : '<p class="muted">完成服务后，可在这里填写真实体验。</p>'}</section>
      <section class="booking-panel booking-plan"><div class="booking-panel-head"><h2>我的康复计划</h2>${link('查看计划','plan',client.id)}</div><h3>${esc(client.goal)}</h3><p>当前阶段：${esc(client.phase)}</p><p>下一步：${esc(client.nextStep)}</p>${link('查看康复进展','progress',client.id)}</section>
      <p class="booking-brand-note">涛博士 · 安排清楚，每次服务有记录</p>
    </div>
  </div>`;
}

function requestSummary(row, ctx) {
  const { esc, fmt: { date }, ui: { name, pair } } = ctx;
  return `<div class="detail-grid">${pair('客户',name('clients',row.clientId))}${pair('服务门店',name('stores',row.storeId))}${pair('期望时间',`${date(row.date)} ${row.time}`)}${pair('期望康复师',name('therapists',row.principalId))}</div><p class="meta">项目：${esc(row.project)}</p>`;
}

function resolutionSummary(row,ctx) {
  if(!row.resolvedAt)return '';
  const {esc,ui:{name,pair},fmt:{date}}=ctx;
  const kind={boss:'bosses',frontdesk:'frontDesks',therapist:'therapists'}[row.resolvedRole];
  const person=row.resolvedRole==='boss'?'老板':kind?name(kind,row.resolvedBy):'门店工作人员';
  const stamp=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(row.resolvedAt));
  return `<div class="note"><strong>门店处理结果</strong><p>${esc(row.resolutionReason)}</p>${row.suggestedDate?`<p>建议时间：${date(row.suggestedDate)} ${esc(row.suggestedTime)}</p>`:''}${pair('处理人',person)}<p class="meta">处理时间 ${esc(stamp)}</p></div>`;
}

export function customerRequestDialog(type, id, ctx) {
  const { model, role, esc, fmt: { date }, ui: { button, hidden, field, form, name, hourTimeField, selectedStoreId } } = ctx;
  if (type === 'customer-booking') {
    if (role.type !== 'customer' || id && id !== role.id) throw new Error('只有客户本人可以申请预约');
    const client = model._client(role.id);
    return { title:'预约康复', html:`<form data-form="customer-booking" data-step="1" novalidate>${hidden('project','康复服务')}<ol class="booking-steps" aria-label="预约流程"><li data-booking-progress="1" aria-current="step"><b>1</b>选门店</li><li data-booking-progress="2"><b>2</b>选时间</li><li data-booking-progress="3"><b>3</b>确认申请</li></ol><p class="booking-client-summary">${esc(client.name)} · 负责康复师 ${esc(name('therapists',client.ownerId))}</p><section data-booking-step="1"><h3>您想去哪个店？</h3><fieldset class="booking-store-picker"><legend class="sr-only">服务门店</legend>${model.state.stores.filter(store=>store.active !== false).map(store=>`<label><input type="radio" name="storeId" value="${esc(store.id)}" required${store.id === (selectedStoreId || client.storeId) ? ' checked' : ''}><span>${esc(store.name)}<small>本店套餐剩余 ${model.remainingInStore(client.id,store.id)} 次 · 仅限本店</small></span></label>`).join('')}</fieldset></section><section data-booking-step="2" hidden><h3>哪天、几点方便到店？</h3><div class="form-grid">${field('期望到店日期','date','','date',`required min="${model.today}"`)}<label class="field"><span>服务康复师</span><select name="principalId" required><option value="${esc(client.ownerId)}">${esc(name('therapists',client.ownerId))}</option></select></label>${hourTimeField('',esc,'期望开始时间')}</div><p class="booking-request-explainer">可选整点或半点开始，按已确认排班与当前预约筛选。提交后仍需门店确认。</p><p class="meta">预览使用示例业务日期；这些时间选项不表示实时空位。</p></section><section data-booking-step="3" hidden><h3>核对您的预约申请</h3><div data-booking-summary></div><div class="note"><strong>提交后，待门店确认</strong><p>申请不扣套餐次数、不收款。确认安排后再到店，完成服务后登记消课。</p></div></section><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="customer-booking-back">暂不预约</button><button type="submit" class="btn btn-primary">下一步：选时间</button></div></form>` };
  }
  const row = customerBookingRows(model, role).find(row => row.id === id);
  if (!row) throw new Error('您没有查看此预约申请的权限');
  if (type === 'customer-booking-cancel') {
    if (role.type !== 'customer' || row.clientId !== role.id || !['pending','reschedule_suggested'].includes(row.status)) throw new Error('仅本人可以取消待确认或待接受建议的预约申请');
    return {title:'取消这次预约申请？',html:form(type,`${hidden('id',id)}${requestSummary(row,ctx)}<p>此申请尚未确认为预约，取消不会改变套餐次数。</p>`,'确认取消申请')};
  }
  if (type === 'customer-booking-confirm') {
    const permission = customerBookingConfirmation(model,id,role);
    if (row.status !== 'pending' || !permission.canConfirm) throw new Error(permission.reason || '此申请已经处理');
    return {title:'核对并确认预约',html:form(type,`${hidden('id',id)}${requestSummary(row,ctx)}<div class="note"><strong>请先核对当天排班与客户安排</strong><p>确认会建立正式的演示预约，并再次检查已有预约是否冲突；不扣次数、不记收款。</p></div><p class="meta">系统已核对已确认排班和已有预约；本预览每次服务预留60分钟，请核对当天排班和到店安排。</p>`,'确认预约安排')};
  }
  if(type==='customer-booking-resolve') {
    const handling=customerBookingHandling(model,id,role);
    if(!handling.canHandle)throw new Error(handling.reason||'没有处理此申请的权限');
    const outcomes=row.status==='reschedule_suggested'?'<option value="expired">建议日期已过，标记过期</option>':`<option value="rejected">无法安排，请客户重新预约</option><option value="reschedule_suggested">建议其他时间，等待客户接受</option>${row.date<model.today?'<option value="expired">日期已过，标记过期</option>':''}`;
    return {title:'处理这次预约申请',html:form(type,`${hidden('id',id)}${hidden('clientId',row.clientId)}${hidden('storeId',row.storeId)}${hidden('principalId',row.principalId)}${requestSummary(row,ctx)}<label class="field"><span>处理结果</span><select name="outcome" required>${outcomes}</select></label><label class="field"><span>告诉客户的原因</span><textarea name="reason" required maxlength="500" placeholder="例如：原时间已满，建议周一下午到店"></textarea></label><section data-booking-suggestion hidden><h3>门店建议的时间</h3><div class="form-grid">${field('建议到店日期','date',row.date,'date',`min="${model.today}" disabled`)}${hourTimeField('',esc,'建议开始时间')}</div></section><p class="notice">建议时间须客户接受后形成新的申请，仍需门店确认；本次不占位、不扣次、不收款。</p>`,'保存处理结果')};
  }
  if(type==='customer-booking-accept') {
    if(role.type!=='customer'||row.clientId!==role.id||row.status!=='reschedule_suggested')throw new Error('只有客户本人可以接受待处理的建议时间');
    return {title:'接受门店建议的时间？',html:form(type,`${hidden('id',id)}${requestSummary(row,ctx)}${resolutionSummary(row,ctx)}<p class="notice">接受后会提交新的预约申请，仍需门店确认。收到确认后再到店；申请不扣次数、不收款。</p>`,'接受时间并提交申请')};
  }
  const status = statusLabels[row.status];
  const permission = customerBookingConfirmation(model,id,role);
  const handling=customerBookingHandling(model,id,role);
  const customerActions=role.type==='customer'&&['pending','reschedule_suggested'].includes(row.status)?`${row.status==='reschedule_suggested'?button('接受建议时间','customer-booking-accept',id,'btn-primary'):''}${button('取消申请','customer-booking-cancel',id,'btn-outline')}`:'';
  const staffActions=role.type!=='customer'&&(row.status==='pending'||handling.canHandle)?`${permission.canConfirm?button('核对并确认','customer-booking-confirm',id,'btn-primary'):''}${handling.canHandle?button('不能安排 / 建议时间','customer-booking-resolve',id,'btn-outline'):''}`:'';
  const explanation={pending:'收到门店确认后再到店，本次申请未扣次数、未收款。',cancelled:'此申请已取消，套餐次数未改变。',reschedule_suggested:'门店提供了其他时间，请您核对并决定是否接受。建议尚未占位，接受后仍需门店确认。',rejected:'本次未能安排，您可以选择其他时间重新申请。',expired:'申请日期已过，本次没有形成正式预约。',suggestion_accepted:'您已接受建议并提交新申请，请查看新申请的确认结果。',confirmed:'申请已处理。改约、取消或完成情况请查看最新预约记录。'}[row.status];
  return { title:'预约申请详情',html:`<span class="tag ${row.status==='confirmed'?'tag-green':['pending','reschedule_suggested'].includes(row.status)?'tag-warn':''}">${esc(status)}</span>${row.status==='confirmed'?'<p class="meta">以下是提交时的申请内容，请以最新预约记录为准。</p>':''}${requestSummary(row,ctx)}${resolutionSummary(row,ctx)}<p class="notice">${esc(explanation)}</p><div class="action-row">${customerActions}${staffActions}${row.acceptedRequestId?button('查看接受后的新申请','customer-booking-detail',row.acceptedRequestId,'btn-outline'):''}${row.status==='confirmed' && ['customer','therapist'].includes(role.type) ? button('查看最新预约记录','appointment-history',row.clientId,'btn-outline') : ''}${role.type==='customer'&&['rejected','expired'].includes(row.status)?button('重新预约','customer-booking',row.clientId,'btn-primary'):''}</div>${row.status==='pending' && !['customer','manager'].includes(role.type) && !permission.canConfirm ? `<p class="meta">${esc(permission.reason)}</p>`:''}<p class="meta">提交日期 ${esc(new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'long',day:'numeric'}).format(new Date(row.requestedAt)))}</p>` };
}

export function renderBookingInbox(ctx) {
  const { model, role, view, esc, fmt:{date}, ui:{button,name} } = ctx;
  const entry = {boss:'overview',frontdesk:'reception',therapist:'work',manager:'manager-overview'}[role.type];
  if (!entry || (view !== entry && !(role.type==='manager'&&view==='manager-appointments') && !(role.type==='therapist'&&view==='therapist-appointments'))) return '';
  const all=customerBookingRows(model,role);
  const rows=all.filter(row=>['pending','reschedule_suggested'].includes(row.status));
  const recent=all.filter(row=>['rejected','expired','suggestion_accepted','cancelled'].includes(row.status)).slice(-5).reverse();
  if (!rows.length&&!recent.length && role.type!=='manager') return '';
  const rowHtml = row => {
    const permission=customerBookingConfirmation(model,row.id,role),handling=customerBookingHandling(model,row.id,role);
    return `<article class="booking-inbox-row"><div><strong>${esc(name('clients',row.clientId))} · ${date(row.date)} ${esc(row.time)}</strong><p class="meta">${esc(name('stores',row.storeId))} · 期望 ${esc(name('therapists',row.principalId))} · ${esc(statusLabels[row.status])}</p>${row.status==='reschedule_suggested'?`<p class="meta">建议 ${date(row.suggestedDate)} ${esc(row.suggestedTime)}，等待客户接受</p>`:''}${row.status==='pending'&&!permission.canConfirm?`<p class="meta">${esc(permission.reason)}</p>`:''}</div><div class="action-row">${permission.canConfirm?button('核对并确认','customer-booking-confirm',row.id,'btn-outline'):handling.canHandle?button('处理申请','customer-booking-resolve',row.id,'btn-outline'):''}${button('查看申请','customer-booking-detail',row.id,'btn-quiet')}</div></article>`;
  };
  return `<section class="card booking-inbox"><div class="section-head"><h2>客户预约申请</h2><span class="tag ${rows.length?'tag-warn':''}">${rows.filter(row=>row.status==='pending').length} 条待确认${rows.some(row=>row.status==='reschedule_suggested')?' · 有建议待客户接受':''}</span></div><p class="meta">${role.type==='manager'?'店长可核对并确认本店待预约；需改期或无法安排时，联系前台或负责康复师处理。':'先核对排班再确认；不能安排时给出原因或建议时间。'}申请不占位、不扣次、不记收款。</p>${rows.length?rows.slice(0,3).map(rowHtml).join(''):'<p class="empty">本店暂无待确认的预约申请。</p>'}${rows.length>3?`<details><summary>其余 ${rows.length-3} 条申请</summary>${rows.slice(3).map(rowHtml).join('')}</details>`:''}${recent.length?`<details><summary>最近处理结果 · ${recent.length} 条</summary>${recent.map(rowHtml).join('')}</details>`:''}</section>`;
}

export function renderRequestHistory(ctx, clientId) {
  const { model, role, esc, fmt:{date}, ui:{link,name} } = ctx;
  const customerOwn = role.type === 'customer' && role.id === clientId;
  const therapistRead = role.type === 'therapist' && model.canSeeClient(role, clientId);
  const managementRead=['boss','frontdesk','manager'].includes(role.type)&&model.canSeeClient(role,clientId);
  if (!customerOwn && !therapistRead && !managementRead) return '';
  const rows=customerBookingRows(model,role).filter(row=>row.clientId===clientId).reverse();
  if (customerOwn) {
    if (!rows.length) return '';
    return `<h3>我的预约申请</h3>${rows.map(row=>`<div class="booking-history-row"><div><strong>${date(row.date)} · ${esc(row.time)}</strong><p class="meta">${esc(name('stores',row.storeId))} · ${esc(statusLabels[row.status])}</p></div>${link('查看','customer-booking-detail',row.id)}</div>`).join('')}<h3>已安排的预约</h3>`;
  }
  const statusLabel=statusLabels;
  return `<h3>客户预约申请</h3><p class="meta">先查看客户的申请；已安排的预约以最新记录为准。</p>${rows.length ? rows.map(row=>`<div class="booking-history-row"><div><strong>${esc(name('clients',row.clientId))} · ${date(row.date)} ${esc(row.time)}</strong><p class="meta">${esc(name('stores',row.storeId))} · ${esc(statusLabel[row.status])}</p><p class="meta">项目：${esc(row.project)} · 期望康复师 ${esc(name('therapists',row.principalId))}</p></div>${link('查看申请','customer-booking-detail',row.id)}</div>`).join('') : '<p class="muted">暂无客户预约申请。</p>'}<h3>已安排的预约</h3>`;
}

export function updateCustomerBookingForm(form, ctx) {
  if (form?.dataset.form !== 'customer-booking') return;
  const step=Number(form.dataset.step || 1);
  form.querySelectorAll('[data-booking-step]').forEach(panel=>{panel.hidden=Number(panel.dataset.bookingStep)!==step;});
  form.querySelectorAll('[data-booking-progress]').forEach(item=>{item.classList.toggle('completed',Number(item.dataset.bookingProgress)<step);if(Number(item.dataset.bookingProgress)===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');});
  const submit=form.querySelector('[type="submit"]');
  submit.textContent=['','下一步：选时间','下一步：核对申请','提交预约申请'][step];
  form.querySelector('[data-action="customer-booking-back"]').textContent=step===1?'暂不预约':'上一步';
  updateAppointmentAvailability(form,ctx);
  const data=Object.fromEntries(new FormData(form));
  form.querySelector('[data-booking-summary]').innerHTML=requestSummary({...data,clientId:ctx.role.id},ctx);
}

export function advanceCustomerBookingForm(form, ctx) {
  if (form?.dataset.form !== 'customer-booking') return false;
  const step=Number(form.dataset.step || 1);
  const controls=[...form.querySelector(`[data-booking-step="${step}"]`).querySelectorAll('input,select')];
  const invalid=controls.find(input=>!input.checkValidity());
  if (invalid) { invalid.reportValidity();return false; }
  if (step===2 && form.elements.date.value<ctx.model.today) {
    const error=form.querySelector('.form-error');error.hidden=false;error.textContent='请选择示例业务日期之后的到店日期。';form.elements.date.focus();return false;
  }
  if(step>=2){const data=Object.fromEntries(new FormData(form)),availability=bookingAvailability(ctx.model,{...data,clientId:ctx.role.id});if(!availability.available){const error=form.querySelector('.form-error');error.hidden=false;error.textContent=availability.message;return false;}}
  if (step>=3) return true;
  form.dataset.step=String(step+1);
  form.querySelector('.form-error').hidden=true;
  updateCustomerBookingForm(form,ctx);
  const title=form.querySelector(`[data-booking-step="${step+1}"] h3`);title.tabIndex=-1;title.focus();
  return false;
}
