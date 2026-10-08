import { cashOverview } from './cash.js?v=20261008-frontdesk';

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
  const clients=model.visibleClients(ctx.role);
  const name=(kind,id)=>model.state[kind].find(r=>r.id===id)?.name || '待安排';
  const action=(label,type,id='',style='btn-outline')=>`<button type="button" class="btn ${style}" data-action="${type}" data-id="${esc(id)}">${label}</button>`;
  const appointments=model.state.appointments.filter(a=>a.storeId===selected.id).sort((a,b)=>`${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const today=appointments.filter(a=>a.date===model.today&&!['cancelled','no_show'].includes(a.status));
  const waiting=today.filter(a=>!a.arrivalAt&&['confirmed','reschedule_requested'].includes(a.status));
  const unrecorded=today.filter(a=>a.arrivalAt&&['confirmed','reschedule_requested'].includes(a.status));
  const cash=model.cashSummary(scoped.filters,ctx.role);
  const toolbar=`<div class="page-head"><div><span class="eyebrow">${esc(model.today)} · 前台 · 示例数据</span><h1>今天的接待</h1><p class="muted">接待、预约和收款，各做一步就清楚。</p></div><label class="boss-store"><span class="sr-only">前台门店</span><select data-reception-store aria-label="前台门店">${stores.map(s=>`<option value="${esc(s.id)}" ${s.id===selected.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label></div>`;
  if(view==='cash')return `<div class="boss-dashboard">${toolbar}${cashOverview(scoped,'今天')}<p class="meta">可登记收款与平台到账。退款、撤销错误记录请交给老板。</p>${action('查看本店收支记录','cash-ledger','','btn-primary')}</div>`;
  if(view==='reception-clients')return `<div class="boss-dashboard">${toolbar}<p class="meta">显示授权门店客户的接待信息。新跨店客户请由老板先安排到本店。</p><div class="client-grid">${clients.map(c=>`<article class="card person-card"><div class="section-head"><h2>${esc(c.name)}</h2><span class="tag tag-green">剩余 ${model.remaining(c.id)} 次</span></div><p class="meta">手机号 ${esc(c.phone||'待补充')}</p><p class="meta">负责人 ${esc(name('therapists',c.ownerId))}</p><div class="action-row">${action('安排服务','appointment-create',c.id)}${action('记收款','record-receipt','','btn-primary')}</div></article>`).join('')||'<div class="empty">暂无授权门店客户。</div>'}</div></div>`;
  const card=a=>`<article class="ease-service-card"><div class="ease-service-head"><div><span class="ease-service-time">${esc(a.time)}</span><h3>${esc(name('clients',a.clientId))}</h3></div><span class="tag ${a.status==='completed'?'tag-green':''}">${a.status==='completed'?'服务已登记':a.status==='pending_reassignment'?'人员待安排':a.status==='reschedule_requested'?'申请改约':a.arrivalAt?'已到店':'待到店'}</span></div><p class="meta">服务康复师 ${esc(name('therapists',a.principalId))} · 剩余 ${model.remaining(a.clientId)} 次</p><p class="meta">客户手机 ${esc(model.state.clients.find(c=>c.id===a.clientId)?.phone||'待补充')}</p>${a.arrivalAt&&a.status!=='completed'?'<p class="reception-warning">已到店，服务结束后请提醒康复师登记。</p>':''}<div class="action-row">${a.date===model.today&&!a.arrivalAt&&['confirmed','reschedule_requested'].includes(a.status)?action('确认到店','record-arrival',a.id,'btn-primary'):''}${a.status==='reschedule_requested'||a.status==='pending_reassignment'?action(a.status==='reschedule_requested'?'处理改约':'重新安排','appointment-edit',a.id,'btn-primary'):''}${action('记收款','record-receipt','','btn-outline')}</div>${['confirmed','reschedule_requested','pending_reassignment'].includes(a.status)?`<details class="ease-service-options"><summary>预约操作 ${icon('chevron-right',15)}</summary><div class="action-row">${action('调整预约','appointment-edit',a.id,'btn-small btn-outline')}${a.date<=model.today&&!a.arrivalAt&&a.status!=='pending_reassignment'?action('记录未到店','appointment-no-show',a.id,'btn-small btn-outline'):''}${action('取消预约','appointment-cancel',a.id,'btn-small btn-quiet')}</div></details>`:''}</article>`;
  const requests=appointments.filter(a=>['reschedule_requested','pending_reassignment'].includes(a.status)||a.date<model.today&&['confirmed'].includes(a.status));
  const future=appointments.filter(a=>a.date>model.today&&a.status==='confirmed');
  return `<div class="boss-dashboard">${toolbar}<div class="ease-work-stats"><div class="ease-work-stat"><span>待到店</span><strong>${waiting.length}<small> 位</small></strong><small>今天已确认预约</small></div><div class="ease-work-stat"><span>已到店待登记</span><strong>${unrecorded.length}<small> 位</small></strong><small>提醒康复师完成记录</small></div><button class="ease-work-stat reception-cash-stat" data-action="nav" data-id="cash"><span>本店今日实收</span><strong>${ctx.fmt.money(cash.net)}</strong><small>点开记收款 / 核对</small></button></div><div class="reception-head-actions">${action('安排预约','appointment-create','','btn-outline')}${action('记一笔收款','record-receipt','','btn-primary')}</div><section class="ease-work-main"><div class="section-head"><h2>今天的预约</h2><span class="tag">${today.length} 位</span></div><div class="ease-service-list">${today.map(card).join('')||'<div class="empty">今天暂无预约，可先安排服务。</div>'}</div></section><details class="ease-work-notice"><summary><strong>需确认的预约</strong><span class="ease-fold-count">${requests.length} 条</span>${icon('chevron-right',18)}</summary><div class="ease-fold-body">${requests.map(a=>`<p class="meta">${esc(a.date)} · ${esc(name('clients',a.clientId))}</p>${card(a)}`).join('')||'<p class="muted">暂无需确认的预约。</p>'}</div></details><details class="ease-work-notice"><summary><strong>之后的预约</strong><span class="ease-fold-count">${future.length} 条</span>${icon('chevron-right',18)}</summary><div class="ease-fold-body">${future.map(a=>`<div class="row"><span>${esc(a.date)} ${esc(a.time)} · ${esc(name('clients',a.clientId))}</span>${action('调整安排','appointment-edit',a.id,'btn-small btn-outline')}</div>`).join('')||'<p class="muted">暂无后续预约。</p>'}</div></details><p class="meta reception-note">确认到店不扣次数。康复师完成服务并登记照片后，才消课；前台只查看接待所需的信息。</p></div>`;
}
export function receptionDialog(type,id,ctx) {
  if(type!=='record-arrival')return null;
  if(!['boss','frontdesk'].includes(ctx.role.type))throw new Error('到店确认仅老板或前台可操作');
  const row=ctx.role.type==='frontdesk'?assertReceptionAppointment(ctx,id):ctx.model.state.appointments.find(a=>a.id===id);
  if(!row)throw new Error('预约不存在');
  const client=ctx.model.state.clients.find(c=>c.id===row.clientId);
  return {title:'确认客户已到店',html:`<form data-form="record-arrival"><input type="hidden" name="id" value="${ctx.esc(id)}"><div class="note"><strong>${ctx.esc(client?.name)} · ${ctx.esc(row.date)} ${ctx.esc(row.time)}</strong><p>请确认客户实际已到店。此操作不扣次数、不产生消费业绩。</p></div><label class="field"><span>接待备注（选填）</span><textarea name="notes" rows="2" maxlength="500" placeholder="仅记接待事项，请勿填写评估、健康情况或治疗内容"></textarea></label><div class="dialog-footer"><button type="submit" class="btn btn-primary">确认已到店</button><button type="button" class="btn btn-quiet" data-action="close-dialog">返回</button></div></form>`};
}
