import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel } from './core.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const front={type:'frontdesk',id:'f1'},manager={type:'manager',id:'m1'};
class FakeData {
 constructor(form){this.data=form.data;}
 *[Symbol.iterator](){for(const entry of Object.entries(this.data))yield entry;}
 getAll(key){return key in this.data?[this.data[key]]:[];}
}
function runtime(role,type,data,failure=false){
 const calls=[],model=new DemoModel();
 for(const method of ['saveCashClosing','confirmCashClosing','linkReceiptPackage'])model[method]=(...args)=>{calls.push({method,args});return {id:'closing-test',storeId:'a',date:model.today,version:1,status:method==='confirmCashClosing'?'confirmed':'submitted',differenceTotal:0,actualTotal:300};};
 const form={dataset:{form:type},isConnected:true,data,reportValidity:()=>true,querySelector:()=>null,querySelectorAll:()=>[]};
 const scope={model,role,TODAY:model.today,document:{addEventListener:(name,callback)=>{if(name==='submit')scope.submit=callback;}},FormData:FakeData,dialogContext:{key:'financial-form',requestId:'finance-integration-key'},drafts:new Map(),sheet:{open:true},$:(selector)=>selector==='#network-toggle'?scope.network:null,network:{checked:failure},setTimeout:callback=>{callback();return 1;},saveDraft(){},updateEvidencePicker(){},advanceCustomerBookingForm:()=>true,render(){scope.rendered=true;},showSuccess(title,html){scope.success=title;scope.successHtml=html;},formError(form,message){scope.error=message;},assertBoss(){model._boss(role);},esc:s=>String(s??''),name:()=> '麦岛店',money:s=>String(s),pair:(a,b)=>a+b,button:()=>'',ctx:()=>({model,role}),customerCtx:()=>({model,role})};
 scope.toast=()=>{};scope.closeDialog=()=>{};
 for(const name of ['updateReceptionIntakeChoices','updatePaperIntakeForm','updateScheduleForm','updateAppointmentAvailability'])scope[name]=()=>{};
 const start=source.indexOf("document.addEventListener('submit', async event =>"),end=source.indexOf('\nfunction exportPreview',start);
 vm.runInNewContext(source.slice(start,end),scope);
 return {scope,form,calls,run:()=>scope.submit({target:form,preventDefault(){}})};
}
test('actual frontdesk submit saves a manual closing with the same request identity and prevents repeated submission',async()=>{
 const r=runtime(front,'cash-closing',{storeId:'a',date:'2026-10-08',actualWechat:'300',actualAlipay:'0',actualCash:'0',actualBank:'0',version:'0'});
 await r.run();await r.run();
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].method,'saveCashClosing');
 assert.equal(r.calls[0].args[0].requestId,'finance-integration-key');assert.equal(r.calls[0].args[0].actualWechat,'300');assert.deepEqual(r.calls[0].args[1],front);
 assert.equal(r.form.dataset.succeeded,'true');assert.ok(r.scope.success);
});
test('offsetting method differences still ask the operator to investigate before daily confirmation',async()=>{
 const r=runtime(front,'cash-closing',{storeId:'a',date:'2026-10-08'});
 r.scope.model.saveCashClosing=()=>({id:'closing-test',storeId:'a',date:'2026-10-08',status:'submitted',differenceTotal:0,difference:{wechat:-1,alipay:0,cash:1,bank:0}});
 await r.run();assert.match(r.scope.successHtml,/差额.*核对|逐项.*核对/);
});
test('actual manager submit can confirm daily reconciliation without gaining receipt entry or refund actions',async()=>{
 const r=runtime(manager,'cash-closing-confirm',{id:'closing-test',version:'1'});await r.run();
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].method,'confirmCashClosing');assert.equal(r.calls[0].args[0],'closing-test');assert.equal(r.calls[0].args[1].requestId,'finance-integration-key');assert.deepEqual(r.calls[0].args[2],manager);
 const denied=runtime(manager,'cash-closing',{storeId:'a',date:'2026-10-08'});await denied.run();assert.equal(denied.calls.length,0);assert.match(denied.scope.error,/店长|权限/);
});
test('manual linking is dispatched only after the real boss check and keeps original request identity',async()=>{
 const r=runtime({type:'boss',id:'boss'},'link-receipt-package',{receiptId:'r1',packageId:'p1',reason:'核对对应套餐'});await r.run();
 assert.equal(r.calls.length,1);assert.equal(r.calls[0].method,'linkReceiptPackage');assert.equal(r.calls[0].args[0].requestId,'finance-integration-key');
 for(const role of [front,{type:'boss',id:'wrong'}]){const denied=runtime(role,'link-receipt-package',{receiptId:'r1',packageId:'p1',reason:'核对对应套餐'});await denied.run();assert.equal(denied.calls.length,0);assert.match(denied.scope.error,/老板|权限/);}
});
test('simulated financial save failures keep fields and never invoke daily or linking mutations',async()=>{
 for(const [role,type,data]of [[front,'cash-closing',{storeId:'a',date:'2026-10-08',actualWechat:'300'}],[manager,'cash-closing-confirm',{id:'closing-test',version:'1'}],[{type:'boss',id:'boss'},'link-receipt-package',{receiptId:'r1',packageId:'p1',reason:'核对对应套餐'}]]){
  const r=runtime(role,type,data,true);await r.run();assert.equal(r.calls.length,0);assert.match(r.scope.error,/提交失败/);assert.deepEqual(r.form.data,data);assert.notEqual(r.form.dataset.succeeded,'true');
 }
});
