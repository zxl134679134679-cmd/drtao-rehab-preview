// Boss-only, deterministic guidance over existing records. No writes, AI calls,
// inferred cash, commission calculations or synthetic resolution records.
import { dailyOperationsSummary } from './daily-operations.js?v=20261010-boss-decision-1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => `¥${Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const methods = {wechat:'微信',alipay:'支付宝',cash:'现金',bank:'银行'};
const channels = {direct:'门店收款',douyin:'抖音',meituan:'美团',other_platform:'其他平台'};
const day = (date, offset) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0,10);
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
function validDate(value) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(`${value}T00:00:00Z`))||new Date(`${value}T00:00:00Z`).toISOString().slice(0,10)!==value)throw new Error('今天日期无效，无法生成今日决策');
 return value;
}
function helpers(model) {
 const indexes=new Map();
 const find=(kind,id)=>{if(!indexes.has(kind))indexes.set(kind,new Map((model.state[kind]||[]).map(row=>[row.id,row])));return indexes.get(kind).get(id);};
 const actor=id=>id==='boss'?'老板':find('frontDesks',id)?.name||find('therapists',id)?.name||find('storeManagers',id)?.name||'前台核对 · 老板监督';
 const evidence=(kind,row,label,action,actionId=row.id,amount)=>({kind,id:row.id||`${row.storeId}:${row.date}`,clientId:row.clientId||'',storeId:row.storeId,date:row.date||model.today,time:row.time||'',ownerName:actor(row.assigneeId||row.principalId||row.therapistId||row.ownerId||row.recordedBy||row.submittedBy||row.createdBy),clientName:find('clients',row.clientId)?.name||'',label,action,actionId,...(amount===undefined?{}:{amount})});
 return {find,actor,evidence};
}
// Index ledger rows once; otherwise years of daily closings each rescan the
// complete cash ledger. The fingerprint matches core._cashClosingLedger.
function indexedClosings(model,role,stores,today) {
 model._financeActor(role);
 const key=(storeId,date)=>JSON.stringify([storeId,date]);
 const indexed=new Map([...stores].map(storeId=>[key(storeId,today),{storeId,date:today,latest:null,expectedMinor:Object.fromEntries(Object.keys(methods).map(m=>[m,0])),fingerprints:[]}]));
 for(const row of model.state.cashClosings||[]){
  if(!stores.has(row.storeId)||row.date>today)continue;
  const k=key(row.storeId,row.date);
  if(!indexed.has(k))indexed.set(k,{storeId:row.storeId,date:row.date,latest:null,expectedMinor:Object.fromEntries(Object.keys(methods).map(m=>[m,0])),fingerprints:[]});
  const group=indexed.get(k);if(!group.latest||row.version>group.latest.version)group.latest=row;
 }
 const add=(kind,row)=>{
  const group=indexed.get(key(row.storeId,row.date));if(!group)return;
  group.fingerprints.push([kind,row.id,row.date,row.time,row.status,row.method,row.amountMinor,row.voidedAt||'']);
  if(row.status==='valid'){
   if(!(row.method in group.expectedMinor)||!Number.isSafeInteger(row.amountMinor))throw new Error('对账记录的方式或金额无效，请核对原记录');
   const next=group.expectedMinor[row.method]+(kind==='receipt'?row.amountMinor:-row.amountMinor);
   if(!Number.isSafeInteger(next))throw new Error('对账金额超出安全范围，请核对原记录');group.expectedMinor[row.method]=next;
  }
 };
 for(const row of model.state.receipts)if(row.settlementStatus==='received')add('receipt',row);
 for(const row of model.state.refunds)add('refund',row);
 for(const group of indexed.values()){
  const fingerprint=JSON.stringify(group.fingerprints.sort((a,b)=>a[1].localeCompare(b[1])));
  group.record=model._cashClosingRecord(group.latest,fingerprint);group.status=group.record?.status||'missing';
  const total=Object.values(group.expectedMinor).reduce((n,v)=>n+v,0);if(!Number.isSafeInteger(total))throw new Error('对账合计超出安全范围，请核对原记录');group.expectedTotal=total/100;
 }
 return {rows:[...indexed.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.storeId.localeCompare(b.storeId)),today:storeId=>indexed.get(key(storeId,today))};
}
function cashPriority(model,role,stores,today,x) {
 const within=row=>stores.has(row.storeId),rows=[];
 const closings=indexedClosings(model,role,stores,today);
 for(const closing of closings.rows){
  const {storeId,date}=closing;
  const record=closing.record;
  if(record){
   const differences=Object.keys(methods).map(method=>({method,minor:Math.round(record.actual[method]*100)-closing.expectedMinor[method]}));
   const nonzero=differences.filter(r=>r.minor!==0);
   if(nonzero.length||closing.status==='stale'||(date<today&&closing.status==='submitted'))rows.push(x.evidence('closing',{...record,storeId,date},`${closing.status==='stale'?'账目已变化，原日结需重新核对':!nonzero.length?'历史日结待老板确认':'各收款方式逐项差额待核对'}${nonzero.length?'：'+nonzero.map(r=>`${methods[r.method]} ${money(r.minor/100)}`).join('、'):''}`,'cash-closing',JSON.stringify({storeId,date}),round(differences.reduce((n,r)=>n+r.minor,0)/100)));
  }
 }
 // New card/renewal linkage only. Opening paper balances are not new receipts.
 for(const pack of model.state.packages){
  if(!within(pack)||pack.closed||!['current','historical'].includes(pack.status))continue;
  const finance=model.packageFinance(pack.id,role);
  if(finance.status==='opening')continue;
  if(finance.status==='unlinked'||round(finance.amount-finance.netReceived)!==0)rows.push(x.evidence('package',{...pack,date:pack.createdAt?.slice(0,10)||pack.renewedAt?.slice(0,10)||today,ownerId:x.find('clients',pack.clientId)?.ownerId},finance.status==='unlinked'?'套餐与收款尚未关联，核对后关联原收款，避免重复录入':`套餐金额与关联净收款差额 ${money(round(finance.amount-finance.netReceived))}，请核对实际到账与退款`,'package-history',pack.id,round(finance.amount-finance.netReceived)));
 }
 for(const receipt of model.state.receipts){
  if(!within(receipt)||receipt.date>today)continue;
  if(receipt.status==='valid'&&!receipt.packageId&&!receipt.parentId&&['package','renewal'].includes(receipt.purpose))rows.push(x.evidence('receipt-link',receipt,'已登记套餐收款，尚未关联套餐；从原收款核对后关联','receipt-detail',receipt.id,receipt.amount));
  if(receipt.status==='pending_settlement')rows.push(x.evidence('platform-pending',receipt,`${channels[receipt.channel]||'平台'}待到账，核对结算账单后再登记实际到账`,'receipt-detail',receipt.id,receipt.amount));
 }
 for(const storeId of stores){
  const s=closings.today(storeId);
  if(['missing','submitted'].includes(s.status)&&!rows.some(r=>r.kind==='closing'&&r.storeId===storeId&&r.date===today))rows.push(x.evidence('closing-check',{storeId,date:today,submittedBy:s.record?.submittedBy},s.status==='missing'?'今日尚未填写营业日结，营业结束时核对真实流水':'前台已提交，待老板核对并确认','cash-closing',JSON.stringify({storeId,date:today}),s.expectedTotal));
 }
 const critical=rows.some(r=>['closing','package','receipt-link','platform-pending'].includes(r.kind));
 return {id:'cash',title:'把收款录入核对清楚',status:critical?'attention':rows.length?'check':'normal',count:rows.length,summary:critical?`${rows.length} 条记录需核对，先查差额与套餐关联` : rows.length?`${rows.length} 家门店日结待核对或确认`:'当前已登记的今日与历史日结均已确认',nextStep:'前台对照微信、支付宝、现金和银行真实流水；老板核对差异。这里只能发现记录差异，无法判断是否漏收或漏录，不自动补钱。',evidence:rows};
}
function flowPriority(model,stores,today,x) {
 const rows=[],seen=new Set();const add=(kind,row,label,action,actionId)=>{const key=`${kind}:${row.id}`;if(!seen.has(key)){seen.add(key);rows.push(x.evidence(kind,row,label,action,actionId));}};
 for(const a of model.state.appointments){
  if(!stores.has(a.storeId)||!['confirmed','reschedule_requested','pending_reassignment'].includes(a.status))continue;
  if(a.arrivalAt&&a.date<=today&&!a.serviceId){add('arrival',a,'已到店待登记：先核实服务完成，再由康复师登记服务与照片','appointment-history',a.clientId);Object.assign(rows.at(-1),{followAction:'register-appointment',followActionId:a.id,followLabel:'核实完成后登记服务'});}
  else if(a.date<today||a.status==='pending_reassignment'||a.status==='reschedule_requested'||a.cancellationRequest?.status==='pending'){add('appointment',a,a.status==='pending_reassignment'?'服务人员待重新安排':a.status==='reschedule_requested'?'客户改约申请待处理':a.cancellationRequest?.status==='pending'?'客户取消申请待处理':'预约已过日期，到店与服务情况待核实','appointment-history',a.clientId);if(rows.at(-1)?.id===a.id)Object.assign(rows.at(-1),{followAction:a.cancellationRequest?.status==='pending'?'appointment-cancel-handle':'appointment-edit',followActionId:a.id,followLabel:a.cancellationRequest?.status==='pending'?'处理取消申请':'核对与调整安排'});}
 }
 for(const r of model.state.bookingRequests||[])if(stores.has(r.storeId)&&r.status==='pending')add('booking',r,'客户预约申请待门店确认；申请本身不占时段','customer-booking-detail',r.id);
 for(const r of model.state.paperIntakes||[])if(stores.has(r.storeId)&&r.status==='pending')add('intake',r,'接待确认表待负责康复师专业复核','paper-intake-detail',r.id);
 for(const r of model.state.assessments||[])if(stores.has(r.storeId)&&r.status==='pending')add('assessment',r,'前台代录评估待康复师核对确认','assessment-detail',r.id);
 for(const t of model.state.tasks||[]){
  const storeId=t.storeId||x.find('appointments',t.appointmentId)?.storeId||x.find('services',t.serviceId)?.storeId||x.find('clients',t.clientId)?.storeId;
  if(!stores.has(storeId)||t.status!=='pending'||!t.dueDate||t.dueDate>=today)continue;
  if(t.appointmentId&&rows.some(r=>r.kind==='appointment'&&r.id===t.appointmentId||r.kind==='arrival'&&r.id===t.appointmentId))continue;
  add('task',{...t,storeId,date:t.dueDate},`待办已逾期：${t.title}`,'task-detail',t.id);
 }
 const priority={arrival:0,appointment:1,booking:2,intake:3,assessment:4,task:5};rows.sort((a,b)=>priority[a.kind]-priority[b.kind]||`${a.date}${a.time}${a.id}`.localeCompare(`${b.date}${b.time}${b.id}`));
 return {id:'flow',title:'让到店与服务流程闭环',status:rows.length?'attention':'normal',count:rows.length,summary:rows.length?`${rows.length} 条流程记录待处理，优先核实已到店客户`:'当前没有待处理的流程记录',nextStep:rows.length?'点开记录，明确交给谁、什么时候完成；处理原业务后提醒自动更新。到店不等于完成服务，确认预约也不扣课。':'保持前台接待、康复师服务登记和照片留底同步；营业结束前再检查一次。',evidence:rows};
}
function cashEvidence(cash,x,label){return [...cash.receipts.map(r=>x.evidence('receipt',r,`${label} · ${channels[r.channel]||'门店'}已到账收款`,'receipt-detail',r.id,r.amount)),...cash.refunds.map(r=>x.evidence('refund',r,`${label} · 已实际退款`,'refund-detail',r.id,-r.amount))];}
export function bossDecisionSummary(model,role,options={}) {
 model._boss(role);
 if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('请选择有效的门店范围');
 const today=validDate(model.today),storeId=options.storeId||'';
 if(typeof storeId!=='string')throw new Error('请选择有效门店');
 if(storeId)model._store(storeId);
 const storeIds=storeId?[storeId]:model.state.stores.map(s=>s.id),stores=new Set(storeIds),x=helpers(model);
 // Authoritative valid cash rows are loaded once, then indexed by actual day.
 const cashPeriod=model.cashSummary({storeId,from:day(today,-7),to:today},role);
 const byDate=new Map(Array.from({length:8},(_,i)=>[day(today,-i),{receipts:[],refunds:[]}])) ;
 for(const row of cashPeriod.receipts)byDate.get(row.date)?.receipts.push(row);
 for(const row of cashPeriod.refunds)byDate.get(row.date)?.refunds.push(row);
 const sum=rows=>rows.reduce((n,r)=>{const value=n+r.amountMinor;if(!Number.isSafeInteger(value))throw new Error('每日收支超出安全范围，请核对原记录');return value;},0);
 const cash=at=>{const rows=byDate.get(at),receivedMinor=sum(rows.receipts),refundedMinor=sum(rows.refunds),netMinor=receivedMinor-refundedMinor;if(!Number.isSafeInteger(netMinor))throw new Error('每日净收超出安全范围，请核对原记录');return {...rows,receivedMinor,refundedMinor,netMinor,received:receivedMinor/100,refunded:refundedMinor/100,net:netMinor/100,channels:Object.keys(channels).map(channel=>{const received=sum(rows.receipts.filter(r=>r.channel===channel))/100,refunded=sum(rows.refunds.filter(r=>r.channel===channel))/100;return {channel,received,refunded,net:round(received-refunded)};})};};
 const current=cash(today),yesterday=cash(day(today,-1));
 const past=Array.from({length:7},(_,i)=>({date:day(today,-i-1),cash:cash(day(today,-i-1))}));
 const total=past.reduce((n,r)=>n+r.cash.netMinor,0);if(!Number.isSafeInteger(total))throw new Error('历史金额超出安全范围，请分日期核对');
 const daily=dailyOperationsSummary(model,role,{storeId,date:today});
 const comparison={today:{date:today,net:current.net,netMinor:current.netMinor,received:current.received,receivedMinor:current.receivedMinor,refunded:current.refunded,refundedMinor:current.refundedMinor},yesterday:{date:day(today,-1),net:yesterday.net,netMinor:yesterday.netMinor},sevenDayAverage:{from:day(today,-7),to:day(today,-1),dayCount:7,net:round(total/700),netMinor:Math.round(total/7),recordedDayCount:past.filter(r=>r.cash.receipts.length||r.cash.refunds.length).length},percent:null,serviceCount:daily.serviceCount,receptionCount:daily.receptionCount,channels:current.channels.map(r=>({channel:r.channel,label:channels[r.channel],net:r.net,received:r.received,refunded:r.refunded})),completeToday:false};
 const revenue={id:'revenue',title:'看营业额，先看原因再行动',status:'check',count:current.receipts.length+current.refunds.length,summary:`今日截至当前已登记净实收 ${money(current.net)} · 昨日全天 ${money(yesterday.net)}`,nextStep:'今日尚未结束，不直接判断涨跌。先核对渠道到账、套餐收款和退款，再对照实际服务与前台接待；营业结束后按完整一天比较。',evidence:[...cashEvidence(current,x,'今日'),...cashEvidence(yesterday,x,'昨日'),...past.slice(1).flatMap(r=>cashEvidence(r.cash,x,r.date))]};
 const cashItem=cashPriority(model,role,stores,today,x),flow=flowPriority(model,stores,today,x);
 return {date:today,storeId,storeIds,scopeLabel:storeId?x.find('stores',storeId).name:'全部门店',items:[cashItem,flow,revenue],comparison,encouragement:cashItem.status==='attention'||flow.status==='attention'?'先把最关键的一件处理好，再完成下一件。每天把账和流程理清，门店就更稳。':'每天核清一笔账、跟进一次服务，踏实的管理会慢慢积累。'};
}
const button=(label,action,id='',style='btn-outline')=>`<button type="button" class="btn ${style}" data-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`;
export function renderBossDecision(ctx) {
 if(ctx.role?.type!=='boss')return '';
 const s=bossDecisionSummary(ctx.model,ctx.role,{storeId:ctx.filters?.storeId||''});
 return `<section class="boss-decision" aria-label="老板今日决策"><div class="boss-decision-heading"><div><span class="eyebrow">今日经营提醒</span><h2>今天，先把这 3 件事做好</h2></div><span class="boss-decision-rule">按已录入记录生成</span></div><p class="boss-decision-scope">${esc(s.date)} · ${esc(s.scopeLabel)} · 固定今天，不受下方业绩日期或康复师筛选影响</p><div class="boss-decision-list">${s.items.map((r,i)=>`<button type="button" class="boss-decision-card" data-action="boss-decision-detail" data-id="${r.id}" aria-label="${esc(r.title)}"><span class="boss-decision-number">0${i+1}</span><span class="boss-decision-text"><span class="boss-decision-title">${esc(r.title)}</span><span class="boss-decision-summary">${esc(r.summary)}</span><span class="boss-decision-status ${r.status==='attention'?'is-attention':''}">${r.status==='attention'?'优先处理':r.status==='normal'?'保持检查':r.id==='revenue'?'查看对比与建议':'营业结束前核对'}<span class="boss-decision-open">查看记录与下一步 →</span></span></span></button>`).join('')}</div><p class="boss-decision-encouragement">${esc(s.encouragement)}</p></section>`;
}
export function bossDecisionDialog(id,ctx) {
 const s=bossDecisionSummary(ctx.model,ctx.role,{storeId:ctx.filters?.storeId||''}),item=s.items.find(r=>r.id===id);
 if(!item)throw new Error('请选择有效的今日决策事项');
 const storeName=store=>ctx.model.state.stores.find(r=>r.id===store)?.name||'所选门店';
 const evidence=item.evidence.slice(0,30).map(r=>`<article class="boss-decision-evidence"><strong>${esc(r.clientName?r.clientName+' · ':'')}${esc(r.label)}</strong><p class="meta">${esc(storeName(r.storeId))} · ${esc(r.date)} ${esc(r.time)} · 跟进：${esc(r.ownerName)}</p>${r.amount!==undefined?`<p class="boss-decision-amount">${r.kind==='closing'?'各方式差额合计':r.kind==='closing-check'?'已登记净收':r.kind==='package'?'待核对差额':'记录金额'} ${esc(money(r.amount))}</p>`:''}<div class="action-row">${button('打开原记录',r.action,r.actionId,'btn-outline')}${r.followAction?button(r.followLabel,r.followAction,r.followActionId,'btn-primary'):''}</div></article>`).join('');
 const c=s.comparison;
 const comparison=id==='revenue'?`<div class="boss-decision-comparison"><div><span>今日截至当前</span><strong>${money(c.today.net)}</strong><small>收款 ${money(c.today.received)} − 退款 ${money(c.today.refunded)}</small></div><div><span>昨日全天</span><strong>${money(c.yesterday.net)}</strong><small>${esc(c.yesterday.date)}</small></div><div><span>过去 7 天已登记日均</span><strong>${money(c.sevenDayAverage.net)}</strong><small>${esc(c.sevenDayAverage.from)}—${esc(c.sevenDayAverage.to)}</small></div></div><p class="notice">今日未结束，与昨日全天不直接计算涨跌率。7 天中 ${c.sevenDayAverage.recordedDayCount} 天有收退款记录；无登记日按 0 纳入登记日均，不代表当天真实营业额为 0。请先确认历史录入完整。</p><h3>建议关注这几处</h3><ul class="boss-decision-advice"><li>渠道：${c.channels.map(r=>`${esc(r.label)}净实收 ${money(r.net)}`).join('；')}。平台待结算尚未到账，到账后再记实收。</li><li>收款结构：套餐、续费与单次款是否和客户、门店、套餐对应；客单金额变化先查成交结构。</li><li>履约与接待：今日登记完成服务 ${c.serviceCount} 次、实际接待 ${c.receptionCount} 人次。核实是否及时登记，接待不等于成交。</li><li>退款：今日登记退款 ${money(c.today.refunded)}，按实际退款日扣除；点开原记录核对原因。</li><li>明日安排：查看预约和已确认排班，检查空闲时段与待确认申请，再决定是否联系有需求的客户。</li></ul><div class="action-row">${button('收支明细（当前筛选）','cash-ledger')}${button('查看排班','nav','schedules')}</div>`:'';
 return {title:item.title,html:`<p class="meta">${esc(s.date)} · ${esc(s.scopeLabel)} · 根据现有录入记录生成</p><div class="note"><strong>${esc(item.summary)}</strong><p>${esc(item.nextStep)}</p></div>${comparison}<h3>${id==='revenue'?'对比依据 · 原收退款记录':'待核对记录与负责人'}</h3><div class="boss-decision-evidence-list">${evidence||'<p class="empty">当前没有相关待处理记录，保持每日核对即可。</p>'}${item.evidence.length>30?`<p class="meta">共 ${item.evidence.length} 条依据，先显示按优先级排列的前 30 条。处理原记录后再检查其余提醒；总数与汇总按全部记录计算。</p>`:''}</div>${id==='cash'?`<div class="action-row">${button('录入实际已收款','record-receipt','','btn-primary')}${button('收支明细（当前筛选）','cash-ledger')}</div>`:''}<p class="boss-decision-boundary">提醒只读，不自动收款、扣次数或发放提成。处理原业务后回到看板，提醒会更新；本预览仍是虚构页面内存数据。</p>`};
}
