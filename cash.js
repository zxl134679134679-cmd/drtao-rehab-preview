// Manual cash ledger for the review prototype. Platform orders are not cash
// until an actual settlement is recorded; this module never executes payments.
export const CASH_CHANNELS = {direct:'门店收款',douyin:'抖音',meituan:'美团',other_platform:'其他平台'};
const METHODS = {wechat:'微信',alipay:'支付宝',cash:'现金',bank:'银行转账'};
const PURPOSES = {package:'套餐',renewal:'续费',single:'单次服务',other:'其他',platform_settlement:'平台结算'};
const STATUS = {valid:'已到账',pending_settlement:'待结算',settled:'已结算',revoked:'已撤销'};
export function cashStores(ctx) {
  if(ctx.role.type==='boss'){if(ctx.role.id!=='boss')throw new Error('您没有老板权限');return ctx.model.state.stores;}
  const account=ctx.model.state.frontDesks?.find(r=>r.id===ctx.role.id&&r.active!==false);
  if(ctx.role.type!=='frontdesk'||!account)throw new Error('您没有查看收支记录的权限');
  return ctx.model.state.stores.filter(s=>account.storeIds.includes(s.id));
}
function helpers(ctx) {
  const {model,esc,icon} = ctx;
  const name = (kind,id) => model.state[kind].find(r=>r.id===id)?.name || '未关联客户';
  const money = amount => `¥${Number(amount || 0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const action = (label,type,id='',style='btn-outline') => `<button type="button" class="btn ${style}" data-action="${type}" data-id="${esc(id)}">${label}</button>`;
  const field = (label,name,value='',type='text',extra='') => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
  const select = (label,name,items,extra='',selected='') => `<label class="field"><span>${label}</span><select name="${name}" ${extra}>${items.map(([value,label])=>`<option value="${esc(value)}"${value===selected?' selected':''}>${esc(label)}</option>`).join('')}</select></label>`;
  const notes = (label,name='notes',required=false,value='') => `<label class="field span-all"><span>${label}</span><textarea name="${name}" rows="2" maxlength="500" ${required?'required':''}>${esc(value)}</textarea></label>`;
  const form = (type,body,label,disabled=false) => `<form data-form="${type}">${body}<div class="dialog-footer"><button class="btn btn-primary" type="submit"${disabled?' disabled':''}>${label}</button>${action('返回','close-dialog','','btn-quiet')}</div></form>`;
  const hidden = (name,value) => `<input type="hidden" name="${name}" value="${esc(value)}">`;
  const clock = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  const when = (dateLabel='收款日期') => `${field(dateLabel,'date',model.today,'date','required')}${field('时间','time',clock,'time','required')}`;
  const amount = (label,max='') => field(label,'amount','','number',`required min="0.01" step="0.01" ${max?`max="${max}"`:''} placeholder="请按实际账单填写"`);
  const pair = (label,value) => `<div class="detail-pair"><span>${label}</span><strong>${esc(value)}</strong></div>`;
  return {model,esc,icon,name,money,action,field,select,notes,form,hidden,when,amount,pair};
}
export function cashOverview(ctx,period) {
  const x=helpers(ctx),f=ctx.filters || {};
  if(ctx.role.type==='frontdesk'&&!cashStores(ctx).some(s=>s.id===f.storeId))throw new Error('请先选择授权门店');
  const c=ctx.model.cashSummary({storeId:f.storeId,from:f.from,to:f.to},ctx.role);
  const outstanding=ctx.model.cashSummary({storeId:f.storeId},ctx.role);
  const label=period==='今天'?'今日实收':period==='本月'?'本月实收':period==='全部时间'?'累计实收':'所选日期实收';
  const channelRows=`<div class="cash-channels">${c.channels.map(row=>`<div><span>${CASH_CHANNELS[row.channel]}</span><strong>${x.money(row.net)}</strong></div>`).join('')}</div>`;
  const compact=ctx.role.type==='boss',channels=compact?`<details class="cash-channel-details"><summary>查看各渠道收入 ${x.icon('chevron-right',16)}</summary>${channelRows}</details>`:channelRows;
  return `<section class="cash-hero${compact?' cash-hero-compact':''}" aria-label="营业收入"><div class="cash-hero-head"><span>${label}</span><span>${x.esc(f.storeId?x.name('stores',f.storeId):'全部门店')}</span></div><strong class="cash-total">${x.money(c.net)}</strong><p class="cash-formula">收款 ${x.money(c.received)} <span>−</span> 退款 ${x.money(c.refunded)}</p><div class="cash-hero-actions">${x.action('记一笔收款','record-receipt','','btn-lime')}${x.action('收支明细','cash-ledger','','btn-cash-light')}</div>${channels}<p class="cash-hero-note">${c.receipts.length || c.refunds.length?'按实际收款和退款日期统计，已扣除退款。':'尚未录入收款，请先记一笔；消课不会自动产生收款。'}${f.therapistId?' 收款按门店汇总，不按康复师筛选。':''}</p></section><button type="button" class="cash-pending-bar" data-action="cash-ledger" data-id="pending"><span>平台待结算 <small>尚未到账，不计入实收</small></span><strong>${x.money(outstanding.pending)}</strong>${x.icon('chevron-right',18)}</button>`;
}
export function cashDialog(type,id,ctx) {
  if(type==='cash-closing'||type==='cash-closing-confirm')return cashClosingDialog(type,id,ctx);
  const stores=cashStores(ctx);
  if(ctx.role.type==='frontdesk'&&['refund-receipt','void-receipt','void-refund','link-receipt-package'].includes(type))throw new Error('退款和错误更正请交给老板');
  const x=helpers(ctx),original=x.model.state;
  const state=ctx.role.type==='boss'?original:{...original,stores,clients:x.model.visibleClients(ctx.role),receipts:original.receipts.filter(r=>stores.some(s=>s.id===r.storeId)),refunds:original.refunds.filter(r=>stores.some(s=>s.id===r.storeId))};
  const receipt=state.receipts.find(r=>r.id===id);
  const refund=state.refunds.find(r=>r.id===id);
  if(id&&!['cash-ledger','record-receipt'].includes(type)&&!receipt&&!refund)throw new Error('记录不存在或不在您的门店权限内');
  if(type==='record-receipt') {
    const fromAppointment=typeof id==='string'&&id.startsWith('appointment:');
    const appointment=fromAppointment?original.appointments.find(a=>a.id===id.slice('appointment:'.length)):null;
    if(fromAppointment&&(!appointment||!stores.some(s=>s.id===appointment.storeId)||!state.clients.some(c=>c.id===appointment.clientId)))throw new Error('预约不存在或不在您的门店和客户权限内');
    const prefill=id&&!fromAppointment?state.packages.find(p=>p.id===id):null;
    if(id&&!fromAppointment&&(!prefill||!state.clients.some(c=>c.id===prefill.clientId)||!stores.some(s=>s.id===prefill.storeId)||prefill.closed||!['current','historical'].includes(prefill.status)))throw new Error('套餐不存在或不在您的门店权限内');
    const clientId=appointment?.clientId||prefill?.clientId||'',storeId=appointment?.storeId||prefill?.storeId||'';
    const contextNote=appointment?`${x.hidden('appointmentId',appointment.id)}<div class="note cash-appointment-context"><strong>${x.esc(x.name('clients',appointment.clientId))} · ${x.esc(appointment.date)} ${x.esc(appointment.time)}</strong><p>${x.esc(x.name('stores',appointment.storeId))} · ${x.esc(appointment.project)}</p><p class="meta">已带入此预约的客户和门店，请核对收款用途与实际到账金额。预约不代表需要再次付费。</p></div>`:'';
    const packs=matchingPackages(ctx,clientId,storeId);
    return {title:'手动记一笔收款',html:x.form(type,`${contextNote}<p class="muted">填写已经实际收到的钱；本页面只登记账目，不会转账或自动扣客户的钱。抖音、美团未到账的订单，可先记为待结算。</p><div class="form-grid">${x.select('收款渠道','channel',Object.entries(CASH_CHANNELS),'data-cash-channel')}${x.select('收款门店','storeId',[['','请选择门店'],...state.stores.map(s=>[s.id,s.name])],'required',storeId)}${x.select('客户','clientId',[['','请选择客户'],...state.clients.map(c=>[c.id,c.name])],'required data-cash-client',clientId)}${x.select('款项用途','purpose',Object.entries(PURPOSES),'required data-cash-purpose')}<div class="field span-all" data-cash-package><label class="field"><span>本笔收款对应哪个套餐</span><select name="packageId" data-cash-package-select><option value="">暂未办卡，待老板关联</option>${packageOptions(packs,x,prefill?.id||'')}</select></label><div class="finance-package-hint" data-cash-package-hint>${packageChoiceHint(ctx,prefill?.id||'')}</div></div><label class="field" data-cash-platform hidden><span>到账状态</span><select name="settlementStatus" data-cash-status><option value="received">已经到账</option><option value="pending">等待平台结算</option></select></label>${x.select('收款方式','method',Object.entries(METHODS),'required')}<label class="field span-all" data-cash-platform hidden><span>平台订单号 / 结算账单号</span><input name="reference" maxlength="120" data-cash-reference placeholder="同一笔订单或账单只登记一次"></label><label class="field"><span data-cash-amount-label>实际收款金额（元）</span><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>${x.when()}${x.notes('备注（选填）')}</div><p class="cash-entry-note" data-cash-help>手动录入实际收款。关联套餐后能核对成交金额与已收款；不会改变套餐次数或消费业绩。</p>`,'保存收款记录')};
  }
  if(type==='cash-ledger') {
    const f=ctx.filters || {};
    const inDate=row=>(!f.from||row.date>=f.from)&&(!f.to||row.date<=f.to);
    const inStore=row=>!f.storeId||row.storeId===f.storeId;
    const pending=state.receipts.filter(r=>r.status==='pending_settlement'&&inStore(r));
    const rows=[...state.receipts.filter(r=>r.status!=='pending_settlement'&&inStore(r)&&inDate(r)).map(r=>({...r,kind:'receipt'})),...state.refunds.filter(r=>inStore(r)&&inDate(r)).map(r=>({...r,kind:'refund'}))].sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
    const list=items=>items.map(r=>`<button class="cash-ledger-row" type="button" data-action="${r.kind==='refund'?'refund-detail':'receipt-detail'}" data-id="${x.esc(r.id)}"><span><strong>${r.kind==='refund'?'退款':CASH_CHANNELS[r.channel] || '门店收款'} · ${x.esc(r.clientId?x.name('clients',r.clientId):'平台汇总')}</strong><small>${x.esc(r.date)} ${x.esc(r.time)} · ${x.esc(x.name('stores',r.storeId))}</small><small>${r.status==='revoked'?'已撤销':r.kind==='refund'?'已退款':r.status==='settled'?'原单已结算 · 不重复计入':STATUS[r.status]}${r.reference?` · ${x.esc(r.reference)}`:''}</small></span><strong class="${r.status==='revoked'?'revoked-amount':r.kind==='refund'?'cash-refund':'amount'}">${r.kind==='refund'?'−':''}${x.money(r.amount)}</strong>${x.icon('chevron-right',17)}</button>`).join('');
    return {title:'收支明细',html:`${x.action('记一笔收款','record-receipt','','btn-primary')}<h3>当前平台待结算 · ${pending.length} 笔</h3><p class="meta">显示当前门店全部待结算记录，不受下方日期范围影响。到账后点开登记结算。</p>${list(pending)}${!pending.length?'<p class="muted">当前没有待结算款项。</p>':''}<h3>所选日期的收支记录</h3><p class="meta">${x.esc(f.from||'不限开始')} 至 ${x.esc(f.to||'不限结束')} · ${x.esc(f.storeId?x.name('stores',f.storeId):'全部门店')}</p>${list(rows)}${!rows.length?'<div class="empty">还没有收支记录，点击上方记一笔收款。</div>':''}<p class="meta">待结算、已结算原单与已撤销记录保留备查，只有有效到账收款和退款计入总额。</p>`};
  }
  if(type==='receipt-detail'&&receipt) {
    const refunds=state.refunds.filter(r=>r.receiptId===receipt.id);
    const refunded=refunds.filter(r=>r.status==='valid').reduce((sum,r)=>sum+r.amountMinor,0);
    const details=[['金额',x.money(receipt.amount)],['状态',STATUS[receipt.status]],['渠道',CASH_CHANNELS[receipt.channel]],['门店',x.name('stores',receipt.storeId)],['客户',receipt.clientId?x.name('clients',receipt.clientId):'平台汇总'],['日期',`${receipt.date} ${receipt.time}`],['用途',PURPOSES[receipt.purpose]],['收款方式',METHODS[receipt.method]],['订单 / 账单',receipt.reference||'未填写']];
    const recorder=receipt.recordedBy==='boss'?'老板':original.frontDesks?.find(r=>r.id===receipt.recordedBy)?.name || original.therapists.find(r=>r.id===receipt.recordedBy)?.name || '工作人员';
    details.push(['登记人',recorder],['登记时间',new Date(receipt.recordedAt||receipt.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})]);
    return {title:'收款记录',html:`<div class="detail-grid">${details.map(([k,v])=>x.pair(k,v)).join('')}</div>${packageReceiptSummary(receipt,ctx,x)}${receipt.notes?`<p>${x.esc(receipt.notes)}</p>`:''}${receipt.parentId?`<p class="meta">此笔为实际到账的结算款。</p>${x.action('查看原待结算单','receipt-detail',receipt.parentId)}`:''}${receipt.status==='settled'?`${x.action('查看到账记录','receipt-detail',receipt.settlementReceiptId)}<p class="meta">原单保留，原金额不重复计入实收。</p>`:''}${receipt.status==='revoked'?`<div class="note">撤销原因：${x.esc(receipt.voidReason)}</div>`:''}<div class="action-row">${ctx.role.type==='boss'&&!receipt.packageId&&['package','renewal'].includes(receipt.purpose)&&['valid','pending_settlement','settled'].includes(receipt.status)?x.action('关联套餐','link-receipt-package',receipt.id):''}${receipt.status==='pending_settlement'?x.action('登记平台到账','settle-receipt',receipt.id,'btn-primary'):''}${ctx.role.type==='boss'&&receipt.status==='valid'&&refunded<receipt.amountMinor?x.action('记录退款','refund-receipt',receipt.id):''}${ctx.role.type==='boss'&&['valid','pending_settlement'].includes(receipt.status)&&!refunded?x.action('撤销错误记录','void-receipt',receipt.id,'btn-quiet'):''}</div>${refunds.length?`<h3>关联退款</h3>${refunds.map(r=>`<div class="row"><span>${x.esc(r.date)} · ${x.money(r.amount)} · ${r.status==='valid'?'有效':'已撤销'}</span>${x.action('查看','refund-detail',r.id,'btn-small btn-outline')}</div>`).join('')}`:''}`};
  }
  if(type==='settle-receipt'&&receipt?.status==='pending_settlement') return {title:'登记平台到账',html:x.form(type,`${x.hidden('id',id)}<div class="note"><strong>${CASH_CHANNELS[receipt.channel]} · ${x.esc(x.name('stores',receipt.storeId))}</strong><p>原待结算金额 ${x.money(receipt.amount)} · ${x.esc(receipt.reference)}</p></div><p class="muted">核对平台账单后，填写实际到账金额。此入口用于整笔结清；分批到账请分别按结算账单记收款。</p><div class="form-grid">${x.amount('实际到账金额（元）')}${x.when('实际到账日期')}${x.field('结算账单号','reference','','text','required maxlength="120"')}${x.notes('账单说明（选填）')}</div><p class="cash-entry-note">已在净到账金额中扣除的手续费或退款，不要再次录成退款。原单保留，计入实收的是实际到账款。</p>`,'确认到账')};
  if(type==='link-receipt-package'&&receipt) {
    if(ctx.role.type!=='boss'||ctx.role.id!=='boss')throw new Error('套餐关联只能由老板处理');
    if(receipt.packageId||!['package','renewal'].includes(receipt.purpose)||!['valid','pending_settlement','settled'].includes(receipt.status))throw new Error('此收款无需关联或当前状态不能关联套餐');
    const packs=matchingPackages(ctx,receipt.clientId,receipt.storeId);
    return {title:'关联已有套餐',html:x.form(type,`${x.hidden('receiptId',receipt.id)}<div class="note"><strong>${x.esc(x.name('clients',receipt.clientId))} · ${x.esc(x.name('stores',receipt.storeId))}</strong><p>本笔收款 ${x.money(receipt.amount)}。这里只建立对应关系，不重复记收入，不改变套餐次数。</p></div>${packs.length?x.select('对应套餐','packageId',[['','请选择套餐'],...packs.map(p=>[p.id,packageLabel(p,x)])],'required'):'<div class="empty">此客户在收款门店还没有可关联套餐，请先由老板办卡，再关联这笔收款。</div>'}${x.notes('关联原因','reason',true)}`, '确认关联',!packs.length)};
  }
  if(type==='refund-receipt'&&receipt?.status==='valid') {
    const refunded=state.refunds.filter(r=>r.receiptId===id&&r.status==='valid').reduce((s,r)=>s+r.amountMinor,0);
    const remaining=(receipt.amountMinor-refunded)/100;
    const pack=receipt.packageId&&state.packages.find(p=>p.id===receipt.packageId);
    const treatment=pack?`<div class="finance-refund-package span-all"><h3>退款后，这个套餐怎么办？</h3><p class="meta">${x.esc(pack.name)} · ${x.esc(x.name('stores',pack.storeId))}。历史服务和消费业绩保留；错误消课需另行撤销。</p>${x.select('套餐处理方式','packageAction',[['','请选择处理方式'],['keep',pack.closed?'保持结束状态，不恢复次数':'继续使用：保留现有剩余次数'],...(!pack.closed?[['close','结束套餐：停止使用剩余次数']]:[])],'required')}${x.notes('套餐处理原因','packageReason',true)}<p class="meta">如需调整次数，请另行核对处理；退款金额不会自动换算成扣次。</p></div>`:'';
    return {title:'记录已退的钱',html:x.form(type,`${x.hidden('receiptId',id)}<div class="note">原收款 ${x.money(receipt.amount)} · 尚可记录退款 ${x.money(remaining)}</div>${packageReceiptSummary(receipt,ctx,x)}<div class="form-grid">${x.amount('本次实际退款（元）',remaining)}${x.when('实际退款日期')}${x.notes('退款原因','reason',true)}${treatment}</div><p class="meta">请先完成实际退款，再手动登记。本页面不会执行转账。${pack?'套餐按上面选定的方式处理。':'此收款尚未关联套餐，退款后请另行核对套餐次数。'}</p>`,'保存退款记录')};
  }
  if(type==='refund-detail'&&refund) return {title:'退款记录',html:`<div class="detail-grid">${x.pair('金额',x.money(refund.amount))}${x.pair('状态',refund.status==='valid'?'已退款':'已撤销')}${x.pair('日期',`${refund.date} ${refund.time}`)}${x.pair('渠道',CASH_CHANNELS[refund.channel])}${x.pair('门店',x.name('stores',refund.storeId))}${refund.packageId?x.pair('套餐处理',refund.packageAction==='close'?'结束套餐，停止使用剩余次数':'保留套餐原有状态和次数'):''}</div>${refund.packageReason?`<div class="note">套餐处理原因：${x.esc(refund.packageReason)}</div>`:''}<p>${x.esc(refund.reason)}</p>${refund.voidReason?`<div class="note">撤销原因：${x.esc(refund.voidReason)}</div>`:''}<div class="action-row">${x.action('查看原收款','receipt-detail',refund.receiptId)}${ctx.role.type==='boss'&&refund.status==='valid'?x.action('撤销错误退款记录','void-refund',refund.id,'btn-quiet'):''}</div>`};
  if((type==='void-receipt'&&receipt)||(type==='void-refund'&&refund)) {
    const row=receipt||refund;
    return {title:'撤销错误记录',html:x.form(type,`${x.hidden('id',id)}<div class="note">${x.money(row.amount)} · ${x.esc(row.date)}<p>只纠正录入错误，原记录和原因保留。本操作不会转账或退款。</p>${receipt?.parentId?'<p>撤销到账记录后，原平台单恢复待结算。</p>':''}</div>${x.notes('撤销原因','reason',true)}`,'确认撤销记录')};
  }
  return null;
}
export function updateCashFields(form,changed='') {
  if(!form || form.dataset.form!=='record-receipt') return;
  const platform=form.elements.channel.value!=='direct';
  if(changed==='channel'&&platform&&form.elements.method.value==='wechat')form.elements.method.value='bank';
  if(form.elements.storeId.options.length===2&&!form.elements.storeId.value)form.elements.storeId.selectedIndex=1;
  form.querySelectorAll('[data-cash-platform]').forEach(el=>{el.hidden=!platform;});
  form.elements.reference.required=platform;
  form.elements.reference.disabled=!platform;
  form.elements.clientId.required=!platform;
  form.elements.clientId.options[0].textContent=platform?'平台汇总（可不关联客户）':'请选择客户';
  const purpose=form.elements.purpose;
  const option=purpose.querySelector('[value="platform_settlement"]');
  option.hidden=!platform; option.disabled=!platform;
  if(platform&&purpose.value==='package'&&changed==='channel') purpose.value='platform_settlement';
  if(!platform) {form.elements.settlementStatus.value='received';if(purpose.value==='platform_settlement')purpose.value='package';}
  const pending=platform&&form.elements.settlementStatus.value==='pending';
  form.elements.notes.required=form.elements.purpose.value==='other';
  form.elements.notes.placeholder=form.elements.notes.required?'请说明这笔款的用途':'';
  form.elements.date.closest('label').querySelector('span').textContent=pending?'待结算记录日期':'实际到账日期';
  form.querySelector('[data-cash-amount-label]').textContent=pending?'平台待结算金额（元）':'实际到账金额（元）';
  form.querySelector('[data-cash-help]').textContent=pending?'待结算不计入实收。平台打款后，从待结算记录登记到账。':platform?'按实际到账净额填写。跨店汇总账单先按门店拆分，不要各店重复记总额；已扣的退款不再单独录入。':'手动录入实际收款。关联套餐后能核对成交金额与已收款；不会改变套餐次数或消费业绩。';
}

export const financeTypes = new Set(['link-receipt-package','cash-closing','cash-closing-confirm']);
const CLOSING_STATUS = {missing:'尚未对账',submitted:'待老板确认',confirmed:'已核对确认',stale:'账目已变化，需重新核对'};
function matchingPackages(ctx,clientId,storeId) {
  if(!clientId||!storeId)return [];
  const stores=cashStores(ctx);
  if(!stores.some(s=>s.id===storeId)||!ctx.model.canSeeClient(ctx.role,clientId))return [];
  return ctx.model.state.packages.filter(p=>p.clientId===clientId&&p.storeId===storeId&&['current','historical'].includes(p.status)&&!p.closed);
}
function packageLabel(pack,x) {
  return `${pack.name} · ${x.name('stores',pack.storeId)} · 总 ${pack.total} 次 · 成交 ${x.money(pack.amount)}`;
}
function packageOptions(packs,x,selected='') {
  return packs.map(p=>`<option value="${x.esc(p.id)}"${p.id===selected?' selected':''}>${x.esc(packageLabel(p,x))}</option>`).join('');
}
function packageChoiceHint(ctx,packageId) {
  const x=helpers(ctx);
  if(!packageId)return '<p class="meta">先选择客户和收款门店，再选匹配的套餐；暂未办卡可先记录收款，之后由老板关联。</p>';
  const p=ctx.model.state.packages.find(p=>p.id===packageId),f=ctx.model.packageFinance(packageId,ctx.role);
  if(!p)return '';
  return `<p class="meta">${x.esc(x.name('stores',p.storeId))} · 总 ${p.total} 次 · 剩余 ${f.remaining} 次 · 成交 ${x.money(f.amount)}。关联只用于核对收款，不重复办卡或加次数。</p>`;
}
function packageReceiptSummary(receipt,ctx,x=helpers(ctx)) {
  if(!receipt.packageId) {
    if(!['package','renewal'].includes(receipt.purpose))return '';
    return '<div class="finance-package-note"><strong>套餐待关联</strong><p>此收款已留底，尚未与套餐对应。由老板关联后，可核对成交金额和次数。</p></div>';
  }
  const p=ctx.model.state.packages.find(p=>p.id===receipt.packageId);
  const f=ctx.model.packageFinance(receipt.packageId,ctx.role);
  if(!p)return '';
  return `<section class="finance-package-panel" aria-label="关联套餐"><div class="finance-panel-heading"><h3>关联套餐</h3><span class="tag ${f.closed?'tag-warn':'tag-green'}">${f.closed?'套餐已结束':'按办卡门店使用'}</span></div><p class="meta">${x.esc(p.name)} · ${x.esc(x.name('stores',p.storeId))}</p><div class="detail-grid">${x.pair('成交金额',x.money(f.amount))}${x.pair('净收款',x.money(f.netReceived))}${x.pair('套餐与收款差额',x.money(f.amount-f.netReceived))}${x.pair('平台待到账',x.money(f.pending))}${x.pair('已退款',x.money(f.refunded))}${x.pair('总次数',`${p.total} 次`)}${x.pair('可用次数',`${f.remaining} 次`)}</div><p class="meta">收款按实际到账统计；差额用于核对，不能直接当作欠款。套餐次数根据实际服务扣除。${f.status==='opening'?'旧套餐迁入不自动产生收入，收款情况待核对。':''}</p></section>`;
}
export function updateCashPackageChoices(form,ctx) {
  if(!form||form.dataset.form!=='record-receipt'||!form.elements.packageId)return;
  const {clientId,storeId,purpose,packageId}=form.elements;
  const enabled=['package','renewal'].includes(purpose.value);
  const row=form.querySelector('[data-cash-package]'),hint=form.querySelector('[data-cash-package-hint]');
  if(row)row.hidden=!enabled;
  packageId.disabled=!enabled;
  if(!enabled){packageId.value='';if(hint)hint.innerHTML='';return;}
  const previous=packageId.value,packs=matchingPackages(ctx,clientId.value,storeId.value),x=helpers(ctx);
  packageId.innerHTML=`<option value="">暂未办卡，待老板关联</option>${packageOptions(packs,x)}`;
  packageId.value=packs.some(p=>p.id===previous)?previous:'';
  if(hint)hint.innerHTML=packageChoiceHint(ctx,packageId.value);
}
function closingStores(ctx) {
  if(ctx.role.type==='manager') {
    const id=ctx.model.managerStoreId(ctx.role);
    return ctx.model.state.stores.filter(s=>s.id===id);
  }
  return cashStores(ctx);
}
function cashClosingSelection(id,ctx,stores) {
  let requested={};
  if(id){try{requested=JSON.parse(id);}catch{throw new Error('请重新选择对账门店和日期');}}
  const storeId=requested.storeId||(stores.some(s=>s.id===ctx.filters?.storeId)?ctx.filters.storeId:stores[0]?.id);
  if(!stores.some(s=>s.id===storeId))throw new Error('您没有该门店的对账权限');
  return {storeId,date:requested.date||ctx.model.today};
}
function actorName(ctx,id) {
  if(!id)return '待处理';if(id==='boss')return '老板';
  return [...(ctx.model.state.frontDesks||[]),...(ctx.model.state.storeManagers||[])].find(p=>p.id===id)?.name||'历史人员';
}
function stampLabel(value) {
  if(!value)return '';
  return new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
}
// Saved snapshots keep their original comparison for audit. The page compares
// the last submitted actual amounts with the current ledger after any change.
function currentClosingDifference(summary) {
  if(!summary.record)return null;
  const minor=Object.fromEntries(Object.keys(METHODS).map(method=>[
    method,Math.round(summary.record.actual[method]*100)-summary.expectedMinor[method]
  ]));
  const totalMinor=Object.values(minor).reduce((sum,value)=>sum+value,0);
  if(!Object.values(minor).every(Number.isSafeInteger)||!Number.isSafeInteger(totalMinor))throw new Error('核对差额超出可显示范围，请先核对账目');
  return {methods:Object.fromEntries(Object.entries(minor).map(([method,value])=>[method,value/100])),total:totalMinor/100};
}
export function renderCashClosingSummary(ctx) {
  if(!['boss','frontdesk','manager'].includes(ctx.role.type))return '';
  const x=helpers(ctx),rows=ctx.model.cashClosingRows(ctx.role,{date:ctx.model.today});
  if(!rows.length)return '';
  return `<section class="finance-closing-overview" aria-label="今日对账"><div class="finance-panel-heading"><h2>今日对账</h2><span class="meta">手动核对实际到账</span></div><div class="finance-closing-cards">${rows.map(s=>`<button type="button" class="finance-closing-card" data-action="cash-closing" data-id="${x.esc(JSON.stringify({storeId:s.storeId,date:s.date}))}"><span><strong>${x.esc(x.name('stores',s.storeId))}</strong><small class="${s.status==='stale'?'finance-warn':''}">${CLOSING_STATUS[s.status]}</small></span><span><strong>${x.money(s.expectedTotal)}</strong><small>${s.record?`核对差额 ${x.money(currentClosingDifference(s).total)}`:'登记净收'}</small></span>${x.icon('chevron-right',18)}</button>`).join('')}</div><p class="meta">核对微信、支付宝、现金与银行到账，差额需逐项处理后由老板确认。</p></section>`;
}
function cashClosingDialog(type,id,ctx) {
  const stores=closingStores(ctx),x=helpers(ctx);
  if(type==='cash-closing-confirm') {
    if(ctx.role.type!=='boss')throw new Error('对账确认仅由老板处理，店长只查看');
    const record=ctx.model.state.cashClosings?.find(r=>r.id===id);
    if(!record)throw new Error('对账记录不存在');
    const s=ctx.model.cashClosingSummary(ctx.role,{storeId:record.storeId,date:record.date});
    if(!s.record||s.record.status!=='submitted'||Object.values(currentClosingDifference(s).methods).some(n=>n!==0))throw new Error('请先逐项核平差额；账目变化后需重新核对');
    return {title:'确认本店对账',html:x.form(type,`${x.hidden('id',record.id)}${x.hidden('version',record.version)}<div class="note"><strong>${x.esc(x.name('stores',s.storeId))} · ${x.esc(s.date)}</strong><p>登记净收 ${x.money(s.expectedTotal)} · 实际核对 ${x.money(s.record.actualTotal)}</p><p>微信、支付宝、现金、银行四项差额均为 0。</p></div><p class="meta">提交人：${x.esc(actorName(ctx,s.record.submittedBy))} · ${x.esc(stampLabel(s.record.submittedAt))}。确认只保存核对结果，不转账、不重复记收入。</p>`, '确认账目已核对')};
  }
  const selection=cashClosingSelection(id,ctx,stores),s=ctx.model.cashClosingSummary(ctx.role,selection),record=s.record,difference=currentClosingDifference(s);
  const canWrite=['boss','frontdesk'].includes(ctx.role.type),balanced=record&&Object.values(difference.methods).every(n=>n===0);
  const canConfirm=ctx.role.type==='boss'&&record?.status==='submitted'&&balanced;
  const filter=`<form data-form="cash-closing-select" class="finance-closing-filter">${x.select('对账门店','storeId',stores.map(t=>[t.id,t.name]),'required',s.storeId)}${x.field('营业日期','date',s.date,'date',`required max="${x.esc(ctx.model.today)}"`)}<button type="submit" class="btn btn-outline">查看这天</button></form>`;
  const columns=Object.keys(METHODS).map(method=>`<div class="finance-closing-method"><strong>${METHODS[method]}</strong>${x.pair('登记净收',x.money(s.expected[method]))}${record?`${x.pair('实际核对',x.money(record.actual[method]))}${x.pair('差额',x.money(difference.methods[method]))}`:''}</div>`).join('');
  const notice=s.status==='stale'?'<div class="note finance-warn">账目已变化，请前台或老板重新核对并提交；之前的确认保留留底，此次需要重新确认。</div>':record&&!balanced?'<div class="note finance-warn">存在差额，请核对漏记、重复记录或退款。每项差额归零后，老板才可确认。</div>':`<div class="note"><strong>${CLOSING_STATUS[s.status]}</strong><p>${record?'登记金额与实际核对金额按付款方式分别比对。':'先核对实际到账，再填下面四项金额；没有到账的项目填 0。'}</p></div>`;
  const attribution=record?`<p class="meta">提交：${x.esc(actorName(ctx,record.submittedBy))} · ${x.esc(stampLabel(record.submittedAt))}${record.confirmedAt?`<br>上次确认：${x.esc(actorName(ctx,record.confirmedBy))} · ${x.esc(stampLabel(record.confirmedAt))}`:''}</p>${record.notes?`<div class="finance-package-note">备注：${x.esc(record.notes)}</div>`:''}`:'';
  const edit=canWrite?x.form('cash-closing',`${x.hidden('storeId',s.storeId)}${x.hidden('date',s.date)}${x.hidden('version',record?.version||0)}<h3>填写实际核对金额</h3><p class="meta">按所选营业日各渠道实际收款减去实际退款填写，可为负数。请核对流水，不要填个人账户的总余额。</p><div class="form-grid">${Object.keys(METHODS).map(method=>x.field(`${METHODS[method]}实际净到账（元）`,`actual${method[0].toUpperCase()+method.slice(1)}`,record?.actual[method]??'','number','required step="0.01" placeholder="没有收款填 0"')).join('')}${x.notes('差额说明或核对备注（选填）','notes',false,record?.notes||'')}</div><p class="meta">提交后由老板确认；新增、退款或更正当天账目后需重新核对。</p>`,record?'重新提交对账':'提交对账'):'';
  return {title:'每日营业对账',html:`${filter}<div class="finance-closing-total"><span>这天登记净收</span><strong>${x.money(s.expectedTotal)}</strong>${record?`<small>实际核对 ${x.money(record.actualTotal)} · 差额 ${x.money(difference.total)}</small>`:''}</div>${notice}<div class="finance-closing-methods">${columns}</div>${attribution}${canConfirm?`<div class="action-row">${x.action('确认账目已核对','cash-closing-confirm',record.id,'btn-primary')}</div>`:''}${edit}${ctx.role.type==='manager'?'<p class="notice">店长仅查看本店对账；录入由前台或老板处理，确认由老板处理。</p>':''}${ctx.role.type==='manager'&&!record?'<div class="empty">请前台先填写并提交实际核对金额，再由老板确认。</div>':''}<p class="meta">平台待结算不计入当天实收；已到账平台款归实际收款方式核对，原待结算单不会重复统计。</p>`};
}
