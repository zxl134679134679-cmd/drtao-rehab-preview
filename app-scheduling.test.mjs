import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DemoModel } from './core.js';
import { ensureSchedules } from './schedules.js';
import { renderScheduleSummary } from './schedules-ui.js';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
function clickRuntime(role){
 const scope={role,view:'home',document:{addEventListener(type,fn){scope.click=fn;}},closeDialog(){},render(){scope.rendered=true;},toast(message){scope.error=message;}};
 const start=source.indexOf("document.addEventListener('click', event => {"),end=source.indexOf('\nfunction checkReceptionIntakePhone',start);
 assert.ok(start>0&&end>start);vm.runInNewContext(source.slice(start,end),scope);return scope;
}
test('every work role can open schedules through the actual generated entry and click dispatcher',()=>{
 const model=new DemoModel();ensureSchedules(model);
 for(const role of [{type:'boss',id:'boss'},{type:'frontdesk',id:'f1'},{type:'manager',id:'m1'},{type:'therapist',id:'t1'}]){
  const html=renderScheduleSummary({model,role,filters:{}}),action=/data-action="([^"]+)" data-id="([^"]+)"/.exec(html);
  assert.ok(action,'入口必须是可操作的实际nav按钮');
  const runtime=clickRuntime(role);runtime.click({target:{closest:()=>({dataset:{action:action[1],id:action[2]}})}});
  assert.equal(runtime.error,undefined);assert.equal(runtime.view,'schedules');assert.equal(runtime.rendered,true);
 }
});
test('customer cannot reach staff schedules through a forged nav click',()=>{
 const runtime=clickRuntime({type:'customer',id:'c1'});runtime.click({target:{closest:()=>({dataset:{action:'nav',id:'schedules'}})}});
 assert.equal(runtime.view,'home');assert.equal(runtime.rendered,undefined);assert.match(runtime.error,/不可访问/);
});
