import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel, ensureStorePackageExamples } from './core.js';
import * as cash from './cash.js';
const boss={type:'boss',id:'boss'},front={type:'frontdesk',id:'f1'},manager={type:'manager',id:'m1'};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx=(model,role=boss)=>({model,role,esc,icon:()=>'',filters:{}});
function fixture(){const model=ensureStorePackageExamples(new DemoModel({today:'2026-10-09',now:()=> '2026-10-09T08:00:00.000Z'}));return model;}
function selectHtml(html,name){return new RegExp(`<select\\b[^>]*name="${name}"[^>]*>[\\s\\S]*?<\\/select>`).exec(html)?.[0]||'';}
function receipt(model,packageId=''){return model.recordReceipt({clientId:'c1',storeId:'a',purpose:'package',method:'wechat',channel:'direct',settlementStatus:'received',amount:'3000',date:model.today,time:'09:00',requestId:'ui-receipt',packageId},front);}
function packageBoundary({clientId='c1',storeId='a',purpose='package',packageId=''}={}){
 const select={value:packageId,innerHTML:'',disabled:false},row={hidden:false},hint={innerHTML:''};
 const form={dataset:{form:'record-receipt'},elements:{clientId:{value:clientId},storeId:{value:storeId},purpose:{value:purpose},packageId:select},querySelector(s){return s==='[data-cash-package]'?row:s==='[data-cash-package-hint]'?hint:null;}};
 return {form,select,row,hint};
}
test('manual receipt exposes a clear package link and validated package prefill',()=>{
 const m=fixture(),html=cash.cashDialog('record-receipt','p7',ctx(m,front)).html;
 assert.match(html,/name="packageId"/);assert.match(html,/name="clientId"[\s\S]*value="c1" selected/);assert.match(html,/name="storeId"[\s\S]*value="a" selected/);
 assert.match(html,/暂未办卡，待老板关联/);assert.match(html,/手动|实际收到/);assert.match(html,/不会.*转账|不.*转账/);
 assert.throws(()=>cash.cashDialog('record-receipt','p1',ctx(m,front)),/门店|权限/);
});
test('package choices follow matching customer and store, clear foreign choice and hide non-package linkage',()=>{
 const m=fixture(),b=packageBoundary({packageId:'p1'});assert.equal(typeof cash.updateCashPackageChoices,'function');cash.updateCashPackageChoices(b.form,ctx(m,front));
 assert.match(b.select.innerHTML,/value="p7"/);assert.ok(!b.select.innerHTML.includes('value="p1"'));assert.equal(b.select.value,'');assert.match(b.hint.innerHTML,/先.*客户|匹配|门店/);
 b.select.value='p7';cash.updateCashPackageChoices(b.form,ctx(m,front));assert.match(b.hint.innerHTML,/10 次/);assert.match(b.hint.innerHTML,/3,000/);
 b.form.elements.purpose.value='single';cash.updateCashPackageChoices(b.form,ctx(m,front));assert.equal(b.row.hidden,true);assert.equal(b.select.value,'');assert.equal(b.select.disabled,true);
});
test('linked receipt shows payment versus package counts and refund must decide package treatment',()=>{
 const m=fixture(),r=receipt(m,'p7'),detail=cash.cashDialog('receipt-detail',r.id,ctx(m)).html,refund=cash.cashDialog('refund-receipt',r.id,ctx(m)).html;
 assert.match(detail,/关联套餐/);assert.match(detail,/总次数/);assert.match(detail,/10 次/);assert.match(detail,/已收款|净收款/);assert.match(detail,/套餐与收款差额/);
 assert.match(refund,/name="packageAction"/);assert.match(refund,/value="keep"/);assert.match(refund,/value="close"/);assert.match(refund,/name="packageReason"[^>]*required/);assert.match(refund,/历史.*服务|消费业绩/);
 assert.throws(()=>cash.cashDialog('refund-receipt',r.id,ctx(m,front)),/老板/);
});
test('boss can link an eligible unlinked receipt while front desk cannot',()=>{
 const m=fixture(),r=receipt(m),detail=cash.cashDialog('receipt-detail',r.id,ctx(m)).html;
 assert.match(detail,/data-action="link-receipt-package"/);
 const form=cash.cashDialog('link-receipt-package',r.id,ctx(m)).html;
 assert.match(form,/data-form="link-receipt-package"/);assert.match(selectHtml(form,'packageId'),/p7/);assert.ok(!selectHtml(form,'packageId').includes('p1'));
 assert.match(form,/name="reason"[^>]*required/);assert.throws(()=>cash.cashDialog('link-receipt-package',r.id,ctx(m,front)),/老板/);
});
test('daily closing is local, clearly separates actual totals from registered amounts, and confirms only balanced data',()=>{
 const m=fixture();receipt(m);
 const frontHtml=cash.cashDialog('cash-closing',JSON.stringify({storeId:'a',date:m.today}),ctx(m,front)).html;
 assert.match(frontHtml,/3,000/);assert.match(frontHtml,/实际核对金额/);for(const name of ['actualWechat','actualAlipay','actualCash','actualBank'])assert.match(frontHtml,new RegExp(`name="${name}"`));
 assert.ok(!frontHtml.includes('data-form="cash-closing-confirm"'));assert.throws(()=>cash.cashDialog('cash-closing',JSON.stringify({storeId:'b',date:m.today}),ctx(m,front)),/门店|权限/);
 const record=m.saveCashClosing({storeId:'a',date:m.today,actualWechat:'3000',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'已核对',version:0,requestId:'closing-ui'},front);
 const managerHtml=cash.cashDialog('cash-closing',JSON.stringify({storeId:'a',date:m.today}),ctx(m,manager)).html;
 assert.ok(!managerHtml.includes('data-action="cash-closing-confirm"'));assert.ok(!managerHtml.includes('name="actualWechat"'));assert.match(managerHtml,/已核对/);
 assert.throws(()=>cash.cashDialog('cash-closing-confirm',record.id,ctx(m,manager)),/老板|查看/);
 assert.match(cash.cashDialog('cash-closing-confirm',record.id,ctx(m,boss)).html,/data-form="cash-closing-confirm"/);
 assert.throws(()=>cash.cashDialog('cash-closing-confirm',record.id,ctx(m,front)),/店长|老板/);
});
test('closing summary stays management-only, marks stale records and escapes notes',()=>{
 const m=fixture();assert.equal(typeof cash.renderCashClosingSummary,'function');
 assert.equal(cash.renderCashClosingSummary(ctx(m,{type:'customer',id:'c1'})),'');assert.equal(cash.renderCashClosingSummary(ctx(m,{type:'therapist',id:'t1'})),'');
 let html=cash.renderCashClosingSummary(ctx(m,front));assert.match(html,/今日对账/);assert.match(html,/麦岛店/);assert.ok(!html.includes('崂山店'));assert.match(html,/尚未对账/);
 receipt(m);const r=m.saveCashClosing({storeId:'a',date:m.today,actualWechat:'3000',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'<img src=x onerror=alert(1)>',version:0,requestId:'closing-escape'},front);m.confirmCashClosing(r.id,{version:r.version,requestId:'confirm-ui'},boss);
 m.recordReceipt({clientId:'c1',storeId:'a',purpose:'single',method:'cash',channel:'direct',amount:'300',date:m.today,time:'10:00',requestId:'later'},front);
 html=cash.cashDialog('cash-closing',JSON.stringify({storeId:'a',date:m.today}),ctx(m,manager)).html;assert.match(html,/账目.*变化|重新核对/);assert.ok(!html.includes('data-action="cash-closing-confirm"'));assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;img/);
 assert.throws(()=>cash.cashDialog('cash-closing','',ctx(m,{type:'boss',id:'forged'})),/权限|老板/);
});
test('choosing a platform package payment preserves the operator choice for linking',()=>{
 const option={},label={},help={},dateLabel={};
 const form={dataset:{form:'record-receipt'},elements:{channel:{value:'douyin'},method:{value:'bank'},storeId:{value:'a',options:[{},{}]},clientId:{required:false,options:[{}]},purpose:{value:'package',querySelector:()=>option},settlementStatus:{value:'received'},notes:{},reference:{},date:{closest:()=>({querySelector:()=>dateLabel})}},querySelectorAll:()=>[],querySelector:s=>s==='[data-cash-help]'?help:label};
 cash.updateCashFields(form,'purpose');assert.equal(form.elements.purpose.value,'package');
});
test('unlinked receipt with no matching open package clearly stops an unusable link submission',()=>{
 const m=fixture(),r=receipt(m);m.state.packages.filter(p=>p.clientId==='c1'&&p.storeId==='a').forEach(p=>p.closed=true);
 const html=cash.cashDialog('link-receipt-package',r.id,ctx(m)).html;
 assert.match(html,/还没有可关联套餐/);assert.ok(!/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>/.test(html));
});
test('a full refund after confirmation displays the current ledger difference while preserving the old closing snapshot',()=>{
 const m=fixture(),r=m.recordReceipt({clientId:'c1',storeId:'a',purpose:'package',method:'wechat',channel:'direct',amount:'25200',date:m.today,time:'09:00',requestId:'refund-stale-receipt'},front);
 const closing=m.saveCashClosing({storeId:'a',date:m.today,actualWechat:'25200',actualAlipay:'0',actualCash:'0',actualBank:'0',notes:'原账已核平',version:0,requestId:'refund-stale-closing'},front);
 m.confirmCashClosing(closing.id,{version:closing.version,requestId:'refund-stale-confirm'},boss);
 m.refundReceipt({receiptId:r.id,amount:'25200',date:m.today,time:'10:00',reason:'客户全额退款',requestId:'refund-stale-refund'},boss);
 const s=m.cashClosingSummary(boss,{storeId:'a',date:m.today});assert.equal(s.status,'stale');assert.equal(s.expectedTotal,0);assert.equal(s.record.differenceTotal,0);
 const before=structuredClone(m.state),html=cash.cashDialog('cash-closing',JSON.stringify({storeId:'a',date:m.today}),ctx(m)).html;
 assert.match(html,/实际核对 ¥25,200\.00 · 差额 ¥25,200\.00/);
 const wechat=html.match(/<div class="finance-closing-method"><strong>微信<\/strong>[\s\S]*?(?=<div class="finance-closing-method">|<\/div><\/div>)/)?.[0]||'';
 assert.match(wechat,/<span>登记净收<\/span><strong>¥0\.00/);assert.match(wechat,/<span>差额<\/span><strong>¥25,200\.00/);
 assert.match(cash.renderCashClosingSummary(ctx(m,front)),/核对差额 ¥25,200\.00/);assert.ok(!html.includes('data-action="cash-closing-confirm"'));
 assert.deepEqual(m.state,before,'UI must not rewrite the historical confirmed snapshot');
});
