import { renderPaperIntakeList } from './paper-intake.js?v=20261009-therapist-bookings';
import { cashOverview } from './cash.js?v=20261009-therapist-bookings';
import { renderReceptionAssessments } from './evaluations.js?v=20261009-therapist-bookings';

export function receptionStores(ctx) {
  const account=ctx.model.state.frontDesks.find(r=>r.id===ctx.role.id&&r.active!==false);
  if(!account)throw new Error('前台账号不可用');
  return ctx.model.state.stores.filter(s=>account.storeIds.includes(s.id));
}
export function assertReceptionAppointment(ctx,id) {
  const row=ctx.model.state.appointments.find(r=>r.id===id);
  if(!row||!receptionStores(ctx).some(s=>s.id===row.storeId))throw new Error('您没有操作此门店预约的权限');
  return row;
}
export function renderReception(ctx) {
  const {model,esc,icon,filters,view}=ctx;
  const stores=receptionStores(ctx);
  const selected=stores.find(s=>s.id===filters.storeId)||stores[0];
  if(!selected)return '<div class="empty">请由老板分配门店后使用前台工作台。</div>';
  const scoped={...ctx,filters:{...filters,storeId:selected.id,from:model.today,to:model.today}};
  const query=String(filters.query||'').trim().toLowerCase();
  const clients=model.visibleClients(ctx.role).filter(c=>(c.storeId===selected.id||model.state.packages.some(p=>p.clientId===c.id&&p.storeId===selected.id)||model.state.appointments.some(a=>a.clientId===c.id&&a.storeId===selected.id)||model.state.services.some(row=>row.clientId===c.id&&row.storeId===selected.id))&&(!query||c.name.toLowerCase().includes(query)||String(c.phone||'').includes(query)));
  const name=(kind,id)=>model.state[kind].find(r=>r.id===id)?.name || '待安排';
  const packageLabel=(id,storeId)=>model.state.packages.some(p=>p.clientId===id&&(p.storeId===storeId||(!p.storeId&&p.id===model.state.clients.find(c=>c.id===id)?.packageId)))?'本店剩余 '+model.remainingInStore(id,storeId)+' 次':'尚未办理本店套餐';
  const action=(label,type,id='',style='btn-outline')=>`<button type="button" class="btn ${style}" data-action="${type}" data-id="${esc(id)}">${label}</button>`;
  const appointments=model.state.appointments.filter(a=>a.storeId===selected.id).sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const today=appointments.filter(a=>a.date===model.today&&!['cancelled','no_show'].includes(a.status));
  const waiting=today.filter(a=>!a.arrivalAt&&['confirmed','reschedule_requested'].includes(a.status));
  const unrecorded=today.filter(a=>a.arrivalAt&&['confirmed','reschedule_requested'].includes(a.status));
  const cash=model.cashSummary(scoped.filters,ctx.role);
  const toolbar=`<div class="page-head"><div><span class="eyebrow">${esc(model.today)} · 前台 · 示例数据</span><h1>${view==='reception-assessments'?'初访与评估':view==='reception-clients'?'接待客户':view==='cash'?'本店收款':'今天的接待'}</h1><p class="muted">${view==='reception-assessments'?'先填客户自述和注意事项，再交康复师复核。':'接待、预约和收款，各做一步就清楚。'}</p></div><label class="boss-store"><span class="sr-only">前台门店</span><select data-reception-store aria-label="前台门店">${stores.map(s=>`<option value="${esc(s.id)}" ${s.id===selected.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label></div>`;
  if(view==='reception-assessments')return `<div class="boss-dashboard">${toolbar}${renderPaperIntakeList(scoped)}<details class="paper-intake-section"><summary>专业评估记录（康复师核对后供客户查看）</summary>${renderReceptionAssessments(scoped,selected.id)}</details></div>`;
  if(view==='cash')return `<div class="boss-dashboard">${toolbar}${cashOverview(scoped,'今天')}<p class="meta">可登记收款与平台到账。退款、撤销错误记录请交给老板。</p>${action('查看本店收支记录','cash-ledger','','btn-primary')}</div>`;
  if(view==='reception-clients')return `<div class="boss-dashboard">${toolbar}<div class="reception-intake-list-head">${action('接待新客户','reception-create-client',selected.id,'btn-primary')}<p class="meta">已有客户先搜索，避免重复建档。</p></div><form class="toolbar" data-form="client-search"><label class="field search-field"><span>查找老客户</span><input name="query" type="search" placeholder="输入姓名或手机号" value="${esc(filters.query||'')}"></label><button class="btn btn-outline" type="submit">查找客户</button></form><div class="client-grid">${clients.map(c=>`<article class="card person-card"><div class="section-head"><h2>${esc(c.name)}</h2><span class="tag tag-green">${esc(packageLabel(c.id,selected.id))}</span></div><p class="meta">${c.age!=null?esc(c.age)+' 岁 · ':''}手机号 ${esc(c.phone||'待补充')}</p><p class="meta">负责人 ${esc(name('therapists',c.ownerId))}</p>${c.problem?`<p class="reception-problem">客户自述：${esc(c.problem)}</p>`:''}<div class="action-row">${action('接待档案','reception-client',c.id)}${action('初访接待表','paper-intake-create',c.id)}${action('安排预约','appointment-create',c.id,'btn-primary')}${action('评估记录','assessment-history',c.id)}</div></article>`).join('')||'<div class="empty">未找到本店客户。第一次到店可从上方“接待新客户”建档。</div>'}</div></div>`;

  const card=a=>`<article class="ease-service-card"><div class="ease-service-head"><div><span class="ease-service-time">${esc(a.time)}</span><h3>${esc(name('clients',a.clientId))}</h3></div><span class="tag ${a.status==='completed'?'tag-green':''}">${a.status==='completed'?'服务已登记':a.status==='pending_reassignment'?'人员待安排':a.status==='reschedule_requested'?'申请改约':a.arrivalAt?'已到店':'待到店'}</span></div><p class="meta">${esc(a.project)} · ${esc(packageLabel(a.clientId,a.storeId))}</p><p class="meta">服务康复师 ${esc(name('therapists',a.principalId))}</p>${a.groupId?'<p class="meta">同行预约 · 每人独立安排</p>':''}<p class="meta">客户手机 ${esc(model.state.clients.find(c=>c.id===a.clientId)?.phone||'待补充')}</p>${a.arrivalAt&&a.status!=='completed'?'<p class="reception-warning">已到店，服务结束后请提醒康复师登记。</p>':''}<div class="action-row">${a.date===model.today&&!a.arrivalAt&&['confirmed','reschedule_requested'].includes(a.status)?action('确认到店','record-arrival',a.id,'btn-primary'):''}${a.status==='reschedule_requested'||a.status==='pending_reassignment'?action(a.status==='reschedule_requested'?'处理改约':'重新安排','appointment-edit',a.id,'btn-primary'):''}${action('记收款','record-receipt','','btn-outline')}</div>${['confirmed','reschedule_requested','pending_reassignment'].includes(a.status)?`<details class="ease-service-options"><summary>预约操作 ${icon('chevron-right',15)}</summary><div class="action-row">${action('调整预约','appointment-edit',a.id,'btn-small btn-outline')}${a.date<=model.today&&!a.arrivalAt&&a.status!=='pending_reassignment'?action('记录未到店','appointment-no-show',a.id,'btn-small btn-outline'):''}${action('取消预约','appointment-cancel',a.id,'btn-small btn-quiet')}</div></details>`:''}</article>`;
  const requests=appointments.filter(a=>['reschedule_requested','pending_reassignment'].includes(a.status)||a.date<model.today&&['confirmed'].includes(a.status));
  const future=appointments.filter(a=>a.date>model.today&&a.status==='confirmed');
  return `<div class="boss-dashboard">${toolbar}<section class="reception-intake-entry" aria-label="接待入口"><div><h2>先接待，再安排</h2><p>第一次到店先建档；已有档案直接查找。</p></div><div class="reception-intake-entry-actions">${action('接待新客户','reception-create-client',selected.id,'btn-primary')}${action('查找老客户','nav','reception-clients','btn-outline')}</div></section><div class="ease-work-stats"><div class="ease-work-stat"><span>待到店</span><strong>${waiting.length}<small> 次</small></strong><small>今天已确认预约</small></div><div class="ease-work-stat"><span>已到店待登记</span><strong>${unrecorded.length}<small> 次</small></strong><small>提醒康复师完成记录</small></div><button class="ease-work-stat reception-cash-stat" data-action="nav" data-id="cash"><span>本店今日实收</span><strong>${ctx.fmt.money(cash.net)}</strong><small>点开记收款 / 核对</small></button></div><div class="reception-head-actions">${action('安排预约','appointment-create','','btn-outline')}${action('一起预约','appointment-batch','','btn-outline')}${action('记一笔收款','record-receipt','','btn-primary')}${action('我的工作记录','frontdesk-work',ctx.role.id,'btn-outline')}</div><section class="ease-work-main"><div class="section-head"><h2>今天的预约</h2><span class="tag">${today.length} 次</span></div><div class="ease-service-list">${today.map(card).join('')||'<div class="empty">今天暂无预约，可先安排服务。</div>'}</div></section><details class="ease-work-notice"><summary><strong>需确认的预约</strong><span class="ease-fold-count">${requests.length} 条</span>${icon('chevron-right',18)}</summary><div class="ease-fold-body">${requests.map(a=>`<p class="meta">${esc(a.date)} · ${esc(name('clients',a.clientId))}</p>${card(a)}`).join('')||'<p class="muted">暂无需确认的预约。</p>'}</div></details><details class="ease-work-notice"><summary><strong>之后的预约</strong><span class="ease-fold-count">${future.length} 条</span>${icon('chevron-right',18)}</summary><div class="ease-fold-body">${future.map(a=>`<div class="row"><span>${esc(a.date)} ${esc(a.time)} · ${esc(name('clients',a.clientId))}</span>${action('调整安排','appointment-edit',a.id,'btn-small btn-outline')}</div>`).join('')||'<p class="muted">暂无后续预约。</p>'}</div></details><p class="meta reception-note">确认到店不扣次数。康复师完成服务并登记照片后，才消课；前台只查看接待所需的信息。</p></div>`;
}
export function receptionDialog(type,id,ctx) {
  if(type!=='record-arrival')return null;
  if(!['boss','frontdesk'].includes(ctx.role.type))throw new Error('到店确认仅老板或前台可操作');
  const row=ctx.role.type==='frontdesk'?assertReceptionAppointment(ctx,id):ctx.model.state.appointments.find(a=>a.id===id);
  if(!row)throw new Error('预约不存在');
  const client=ctx.model.state.clients.find(c=>c.id===row.clientId);
  return {title:'确认客户已到店',html:`<form data-form="record-arrival"><input type="hidden" name="id" value="${ctx.esc(id)}"><div class="note"><strong>${ctx.esc(client?.name)} · ${ctx.esc(row.date)} ${ctx.esc(row.time)}</strong><p>请确认客户实际已到店。此操作不扣次数、不产生消费业绩。</p></div><label class="field"><span>接待备注（选填）</span><textarea name="notes" rows="2" maxlength="500" placeholder="仅记接待事项，请勿填写评估、健康情况或治疗内容"></textarea></label><div class="dialog-footer"><button type="submit" class="btn btn-primary">确认已到店</button><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button></div></form>`};
}

export const receptionIntakeTypes = new Set(['reception-create-client','reception-client']);
function intakeStores(ctx) {
  const ids=ctx.model.receptionStoreIds(ctx.role);
  return ctx.model.state.stores.filter(s=>ids.includes(s.id)&&s.active!==false);
}
function intakeOwners(ctx,storeId) {
  return ctx.model.state.therapists.filter(t=>t.active!==false&&t.storeId===storeId&&(ctx.role.type!=='therapist'||t.id===ctx.role.id));
}
export function clientIntakeButton(ctx) {
  const stores=intakeStores(ctx);
  if(!stores.length)return '<p class="meta">暂无可建档门店，请联系老板安排。</p>';
  const selected=stores.some(s=>s.id===ctx.filters?.storeId)?ctx.filters.storeId:stores[0].id;
  return `<button type="button" class="btn btn-primary" data-action="reception-create-client" data-id="${ctx.esc(selected)}">新客户建档</button>`;
}
function intakeNextActions(client,ctx) {
  const {esc,role}=ctx;
  const action=(label,kind,style='btn-outline')=>`<button type="button" class="btn ${style}" data-action="${kind}" data-id="${esc(client.id)}">${label}</button>`;
  if(role.type==='manager')return `<p class="notice">档案已建立，请前台或负责康复师安排首次评估。</p>${action('查看本店客户档案','manager-client','btn-primary')}`;
  return `${action('为这位客户安排预约','appointment-create','btn-primary')}${action('查看接待档案','reception-client')}`;
}
export function receptionIntakeSuccess(client,ctx) {
  const {model,esc}=ctx;
  const name=(kind,id)=>model.state[kind].find(row=>row.id===id)?.name||'待安排';
  return `<h3>${esc(client.name)} · ${esc(client.age)} 岁</h3><p>${esc(name('stores',client.storeId))} · 负责康复师 ${esc(name('therapists',client.ownerId))}</p><p class="reception-problem">客户自述：${esc(client.problem)}</p><p class="notice">尚未办理套餐。建档未收款、未扣次数，康复师会在后续评估时制定计划。</p><div class="action-row"><button type="button" class="btn btn-primary" data-action="paper-intake-create" data-id="${esc(client.id)}">填写初访接待表</button>${intakeNextActions(client,ctx)}<button type="button" class="btn btn-quiet" data-action="reception-create-client" data-id="${esc(client.storeId)}">继续接待新客户</button></div>`;
}
export function receptionIntakeDialog(type,id,ctx) {
  const stores=intakeStores(ctx),{model,esc,role}=ctx;
  if(!stores.length)throw new Error('暂无可接待的启用门店，请联系老板分配门店');
  const name=(kind,key)=>model.state[kind].find(row=>row.id===key)?.name||'待安排';
  const action=(label,kind,key='',style='btn-outline')=>`<button type="button" class="btn ${style}" data-action="${kind}" data-id="${esc(key)}">${label}</button>`;
  if(type==='reception-client') {
    if(!model.canSeeClient(role,id))throw new Error('您没有该客户的接待档案权限');
    const client=model._client(id),storeId=stores.some(s=>s.id===ctx.filters.storeId)?ctx.filters.storeId:stores.find(s=>s.id===client.storeId)?.id||stores[0]?.id;
    const packages=model.availablePackages(id,storeId),remaining=model.remainingInStore(id,storeId);
    return {title:`${client.name}的接待档案`,html:`<div class="detail-grid"><div class="detail-pair"><span class="muted">客户姓名</span><strong>${esc(client.name)}</strong></div><div class="detail-pair"><span class="muted">年龄</span><strong>${client.age!=null?esc(client.age)+' 岁':'未填写'}</strong></div><div class="detail-pair"><span class="muted">联系电话</span><strong>${esc(client.phone||'待补充')}</strong></div><div class="detail-pair"><span class="muted">负责康复师</span><strong>${esc(name('therapists',client.ownerId))}</strong></div></div><h3>主要问题（客户自述）</h3><p class="reception-problem">${esc(client.problem||'尚未填写接待问题')}</p><p class="notice">${esc(name('stores',storeId))} · ${packages.length?'套餐剩余 '+remaining+' 次':'尚未办理本店套餐'}。预约不扣次、不收款。</p><div class="action-row">${action('填写初访接待表','paper-intake-create',id,'btn-primary')}${intakeNextActions(client,ctx)}${role.type==='manager'?'':action('登记评估','assessment-create',id)+action('评估记录','assessment-history',id)}</div>`};
  }
  if(type!=='reception-create-client')return null;
  const selected=id||(stores.some(s=>s.id===ctx.filters.storeId)?ctx.filters.storeId:stores[0]?.id);
  if(!stores.some(s=>s.id===selected))throw new Error('请选择在职且授权的接待门店');
  const owners=intakeOwners(ctx,selected);
  const field=(label,key,kind='text',attrs='')=>`<label class="field"><span>${label}</span><input name="${key}" type="${kind}" ${attrs}></label>`;
  return {title:role.type==='frontdesk'?'接待新客户':'新客户建档',html:`<form data-form="reception-create-client"><p class="notice">先查手机号，再填写基本资料。只建立客户档案。${role.type==='manager'?'保存后请前台或负责康复师安排首次评估。':'保存后即可预约。'}</p><div class="reception-phone-check">${field('联系电话','phone','tel','required inputmode="tel" autocomplete="tel" pattern="1[0-9]{10}" maxlength="11" placeholder="11位手机号，用于查重和联系"')}<button type="button" class="btn btn-outline" data-action="reception-check-phone">检查已有档案</button></div><div data-intake-duplicates role="status" aria-live="polite"></div><div class="form-grid">${field('客户姓名','name','text','required autocomplete="name" maxlength="80" placeholder="输入客户姓名"')}${field('年龄','age','number','required min="0" max="120" step="1" inputmode="numeric" placeholder="例如 35"')}<label class="field span-all"><span>主要问题（客户自述）</span><textarea name="problem" required maxlength="500" rows="3" placeholder="直接记录客户的话，例如：跑步后膝盖不舒服，想恢复运动"></textarea></label><label class="field"><span>接待门店</span><select name="storeId" required>${stores.map(s=>`<option value="${esc(s.id)}"${s.id===selected?' selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label class="field"><span>负责康复师</span><select name="ownerId" required>${role.type==='therapist'?'':'<option value="">请选择本店康复师</option>'}${owners.map(t=>`<option value="${esc(t.id)}"${role.type==='therapist'?' selected':''}>${esc(t.name)}</option>`).join('')}</select></label></div><p class="meta" data-intake-owner-help>${role.type==='therapist'?'新档案由您负责，后续可直接安排评估和预约。':'选择本店康复师，接收后续预约和评估。'}</p><p class="meta">套餐、收款和康复评估分别记录，建档不会自动产生费用或扣次数。预览请填写虚构资料，刷新后恢复示例。</p><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button><button type="submit" class="btn btn-primary"${owners.length?'':' disabled'}>${role.type==='manager'?'保存客户档案':'保存档案，下一步预约'}</button></div></form>`};
}
export function updateReceptionIntakeChoices(form,ctx) {
  if(form?.dataset.form!=='reception-create-client'||!form.elements.ownerId)return;
  const stores=intakeStores(ctx),storeId=form.elements.storeId.value;
  const owners=stores.some(s=>s.id===storeId)?intakeOwners(ctx,storeId):[];
  const owner=form.elements.ownerId,previous=owner.value;
  owner.innerHTML=(ctx.role.type==='therapist'?'':'<option value="">请选择本店康复师</option>')+owners.map(t=>`<option value="${ctx.esc(t.id)}">${ctx.esc(t.name)}</option>`).join('');
  owner.value=ctx.role.type==='therapist'?(owners[0]?.id||''):owners.some(t=>t.id===previous)?previous:'';
  owner.disabled=!owners.length;
  const submit=form.querySelector('[type="submit"]');
  if(submit)submit.disabled=!owner.value||form.dataset.busy==='true'||form.dataset.duplicate==='true';
  const hint=form.querySelector('[data-intake-owner-help]');
  if(hint)hint.textContent=owners.length?(ctx.role.type==='therapist'?'新档案由您负责，后续可直接安排评估和预约。':'选择本店康复师，接收后续预约和评估。'):'本店暂无在职康复师，请由老板先安排人员后建档。';
}
export function restoreReceptionIntakeDraft(form,saved,ctx) {
  if(form?.dataset.form!=='reception-create-client'||!form.elements.storeId||!form.elements.ownerId||!Array.isArray(saved?.entries))return;
  const stores=intakeStores(ctx);
  const savedValue=key=>saved.entries.find(entry=>Array.isArray(entry)&&entry[0]===key)?.[1];
  const storeValue=savedValue('storeId')??form.elements.storeId.value;
  const ownerValue=savedValue('ownerId')??form.elements.ownerId.value;
  // Generic restoration can lose an owner value while its store's options have
  // not been built yet. Recover from the saved entry only after checking scope.
  form.elements.storeId.value=stores.some(store=>store.id===storeValue)?storeValue:'';
  updateReceptionIntakeChoices(form,ctx);
  const storeId=form.elements.storeId.value;
  form.elements.ownerId.value=intakeOwners(ctx,storeId).some(person=>person.id===ownerValue)?ownerValue:'';
  updateReceptionIntakeChoices(form,ctx);
  if(!storeId) {
    const hint=form.querySelector('[data-intake-owner-help]');
    if(hint)hint.textContent='原接待门店已停用或不在授权范围，请重新选择门店和负责康复师。';
  }
}
export function receptionDuplicateMarkup(result,ctx) {
  const {esc,model}=ctx;
  if(!result.duplicate)return '<p class="intake-check-clear">未找到已有档案，请继续填写新客户资料。</p>';
  if(!result.clients.length)return '<p class="notice">该手机号已有档案。请联系老板核对门店接待权限，避免重复建档。</p>';
  return '<div class="intake-check-found"><strong>已找到客户，请使用原档案</strong>'+result.clients.map(c=>`<div class="row"><div><strong>${esc(c.name)}</strong><p class="meta">${esc(model.state.stores.find(s=>s.id===c.storeId)?.name||'门店待核对')}</p></div><button type="button" class="btn btn-outline" data-action="reception-client" data-id="${esc(c.id)}">打开接待档案</button></div>`).join('')+'</div>';
}
