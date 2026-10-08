// Manual cash ledger for the review prototype. Platform orders are not cash
// until an actual settlement is recorded; this module never executes payments.
export const CASH_CHANNELS = {direct:'门店收款',douyin:'抖音',meituan:'美团',other_platform:'其他平台'};
const METHODS = {wechat:'微信',alipay:'支付宝',cash:'现金',bank:'银行转账'};
const PURPOSES = {package:'套餐',renewal:'续费',single:'单次服务',other:'其他',platform_settlement:'平台结算'};
const STATUS = {valid:'已到账',pending_settlement:'待结算',settled:'已结算',revoked:'已撤销'};
export function cashStores(ctx) {
  if(ctx.role.type==='boss')return ctx.model.state.stores;
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
  const select = (label,name,items,extra='') => `<label class="field"><span>${label}</span><select name="${name}" ${extra}>${items.map(([value,label])=>`<option value="${esc(value)}">${esc(label)}</option>`).join('')}</select></label>`;
  const notes = (label,name='notes',required=false) => `<label class="field span-all"><span>${label}</span><textarea name="${name}" rows="2" maxlength="500" ${required?'required':''}></textarea></label>`;
  const form = (type,body,label) => `<form data-form="${type}">${body}<div class="dialog-footer"><button class="btn btn-primary" type="submit">${label}</button>${action('返回','close-dialog','','btn-quiet')}</div></form>`;
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
  return `<section class="cash-hero" aria-label="营业收入"><div class="cash-hero-head"><span>${label}</span><span>${x.esc(f.storeId?x.name('stores',f.storeId):'全部门店')}</span></div><strong class="cash-total">${x.money(c.net)}</strong><p class="cash-formula">收款 ${x.money(c.received)} <span>−</span> 退款 ${x.money(c.refunded)}</p><div class="cash-hero-actions">${x.action('记一笔收款','record-receipt','','btn-lime')}${x.action('收支明细','cash-ledger','','btn-cash-light')}</div><div class="cash-channels">${c.channels.map(row=>`<div><span>${CASH_CHANNELS[row.channel]}</span><strong>${x.money(row.net)}</strong></div>`).join('')}</div><p class="cash-hero-note">${c.receipts.length || c.refunds.length?'按实际收款和退款日期统计，已扣除退款。':'尚未录入收款，请先记一笔；消课不会自动产生收款。'}${f.therapistId?' 收款按门店汇总，不按康复师筛选。':''}</p></section><button type="button" class="cash-pending-bar" data-action="cash-ledger" data-id="pending"><span>平台待结算 <small>尚未到账，不计入实收</small></span><strong>${x.money(outstanding.pending)}</strong>${x.icon('chevron-right',18)}</button>`;
}
export function cashDialog(type,id,ctx) {
  const stores=cashStores(ctx);
  if(ctx.role.type==='frontdesk'&&['refund-receipt','void-receipt','void-refund'].includes(type))throw new Error('退款和错误更正请交给老板');
  const x=helpers(ctx),original=x.model.state;
  const state=ctx.role.type==='boss'?original:{...original,stores,clients:x.model.visibleClients(ctx.role),receipts:original.receipts.filter(r=>stores.some(s=>s.id===r.storeId)),refunds:original.refunds.filter(r=>stores.some(s=>s.id===r.storeId))};
  const receipt=state.receipts.find(r=>r.id===id);
  const refund=state.refunds.find(r=>r.id===id);
  if(id&&!['cash-ledger','record-receipt'].includes(type)&&!receipt&&!refund)throw new Error('记录不存在或不在您的门店权限内');
  if(type==='record-receipt') {
    return {title:'记一笔收款',html:x.form(type,`<p class="muted">记录已经收到的钱。抖音、美团未到账的订单，可先记为待结算。</p><div class="form-grid">${x.select('收款渠道','channel',Object.entries(CASH_CHANNELS),'data-cash-channel')}${x.select('收款门店','storeId',[['','请选择门店'],...state.stores.map(s=>[s.id,s.name])],'required')}${x.select('客户','clientId',[['','请选择客户'],...state.clients.map(c=>[c.id,c.name])],'required data-cash-client')}${x.select('款项用途','purpose',Object.entries(PURPOSES),'required data-cash-purpose')}<label class="field" data-cash-platform hidden><span>到账状态</span><select name="settlementStatus" data-cash-status><option value="received">已经到账</option><option value="pending">等待平台结算</option></select></label>${x.select('收款方式','method',Object.entries(METHODS),'required')}<label class="field span-all" data-cash-platform hidden><span>平台订单号 / 结算账单号</span><input name="reference" maxlength="120" data-cash-reference placeholder="同一笔订单或账单只登记一次"></label><label class="field"><span data-cash-amount-label>实际收款金额（元）</span><input name="amount" type="number" min="0.01" step="0.01" required placeholder="0.00"></label>${x.when()}${x.notes('备注（选填）')}</div><p class="cash-entry-note" data-cash-help>填写实际收到的钱，套餐次数和康复师消费业绩单独记录。</p>`,'保存收款记录')};
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
    return {title:'收款记录',html:`<div class="detail-grid">${details.map(([k,v])=>x.pair(k,v)).join('')}</div>${receipt.notes?`<p>${x.esc(receipt.notes)}</p>`:''}${receipt.parentId?`<p class="meta">此笔为实际到账的结算款。</p>${x.action('查看原待结算单','receipt-detail',receipt.parentId)}`:''}${receipt.status==='settled'?`${x.action('查看到账记录','receipt-detail',receipt.settlementReceiptId)}<p class="meta">原单保留，原金额不重复计入实收。</p>`:''}${receipt.status==='revoked'?`<div class="note">撤销原因：${x.esc(receipt.voidReason)}</div>`:''}<div class="action-row">${receipt.status==='pending_settlement'?x.action('登记平台到账','settle-receipt',receipt.id,'btn-primary'):''}${ctx.role.type==='boss'&&receipt.status==='valid'&&refunded<receipt.amountMinor?x.action('记录退款','refund-receipt',receipt.id):''}${ctx.role.type==='boss'&&['valid','pending_settlement'].includes(receipt.status)&&!refunded?x.action('撤销错误记录','void-receipt',receipt.id,'btn-quiet'):''}</div>${refunds.length?`<h3>关联退款</h3>${refunds.map(r=>`<div class="row"><span>${x.esc(r.date)} · ${x.money(r.amount)} · ${r.status==='valid'?'有效':'已撤销'}</span>${x.action('查看','refund-detail',r.id,'btn-small btn-outline')}</div>`).join('')}`:''}`};
  }
  if(type==='settle-receipt'&&receipt?.status==='pending_settlement') return {title:'登记平台到账',html:x.form(type,`${x.hidden('id',id)}<div class="note"><strong>${CASH_CHANNELS[receipt.channel]} · ${x.esc(x.name('stores',receipt.storeId))}</strong><p>原待结算金额 ${x.money(receipt.amount)} · ${x.esc(receipt.reference)}</p></div><p class="muted">核对平台账单后，填写实际到账金额。此入口用于整笔结清；分批到账请分别按结算账单记收款。</p><div class="form-grid">${x.amount('实际到账金额（元）')}${x.when('实际到账日期')}${x.field('结算账单号','reference','','text','required maxlength="120"')}${x.notes('账单说明（选填）')}</div><p class="cash-entry-note">已在净到账金额中扣除的手续费或退款，不要再次录成退款。原单保留，计入实收的是实际到账款。</p>`,'确认到账')};
  if(type==='refund-receipt'&&receipt?.status==='valid') {
    const refunded=state.refunds.filter(r=>r.receiptId===id&&r.status==='valid').reduce((s,r)=>s+r.amountMinor,0);
    const remaining=(receipt.amountMinor-refunded)/100;
    return {title:'记录已退的钱',html:x.form(type,`${x.hidden('receiptId',id)}<div class="note">原收款 ${x.money(receipt.amount)} · 尚可记录退款 ${x.money(remaining)}</div><div class="form-grid">${x.amount('本次实际退款（元）',remaining)}${x.when('实际退款日期')}${x.notes('退款原因','reason',true)}</div><p class="meta">此处只保存退款记录。请先完成实际退款；套餐余额另行核对。</p>`,'保存退款记录')};
  }
  if(type==='refund-detail'&&refund) return {title:'退款记录',html:`<div class="detail-grid">${x.pair('金额',x.money(refund.amount))}${x.pair('状态',refund.status==='valid'?'已退款':'已撤销')}${x.pair('日期',`${refund.date} ${refund.time}`)}${x.pair('渠道',CASH_CHANNELS[refund.channel])}${x.pair('门店',x.name('stores',refund.storeId))}</div><p>${x.esc(refund.reason)}</p>${refund.voidReason?`<div class="note">撤销原因：${x.esc(refund.voidReason)}</div>`:''}<div class="action-row">${x.action('查看原收款','receipt-detail',refund.receiptId)}${ctx.role.type==='boss'&&refund.status==='valid'?x.action('撤销错误退款记录','void-refund',refund.id,'btn-quiet'):''}</div>`};
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
  if(platform&&purpose.value==='package') purpose.value='platform_settlement';
  if(!platform) {form.elements.settlementStatus.value='received';if(purpose.value==='platform_settlement')purpose.value='package';}
  const pending=platform&&form.elements.settlementStatus.value==='pending';
  form.elements.notes.required=form.elements.purpose.value==='other';
  form.elements.notes.placeholder=form.elements.notes.required?'请说明这笔款的用途':'';
  form.elements.date.closest('label').querySelector('span').textContent=pending?'待结算记录日期':'实际到账日期';
  form.querySelector('[data-cash-amount-label]').textContent=pending?'平台待结算金额（元）':'实际到账金额（元）';
  form.querySelector('[data-cash-help]').textContent=pending?'待结算不计入实收。平台打款后，从待结算记录登记到账。':platform?'按实际到账净额填写。跨店汇总账单先按门店拆分，不要各店重复记总额；已扣的退款不再单独录入。':'填写实际收到的钱，套餐次数和康复师消费业绩单独记录。';
}
