import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
function record(role){
 const pack={id:'p-test',clientId:'c1',storeId:'a',name:'本店套餐',total:10,openingUsed:0,closed:true,amount:3000};
 const scope={model:{packageRemaining:()=>0,packageFinance:()=>({received:3000,refunded:2400,netReceived:600,pending:0,status:'linked'})},role,clientServices:()=>[{id:'s1',packageId:'p-test',sessions:1,status:'valid',date:'2026-10-08',project:'阶段训练',storeId:'a'}],esc:s=>String(s??''),money:s=>String(s),pair:(label,value)=>`<p>${label}：${value}</p>`,date:s=>s,name:()=> '麦岛店',link:()=>''};
 const start=source.indexOf('function packageRecord('),end=source.indexOf('\nfunction packageDialog(',start);
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.record=packageRecord;',scope);return scope.record(pack);
}
test('ended package customer display distinguishes completed services from ended unused sessions and shows no financial amounts',()=>{
 const html=record({type:'customer',id:'c1'});
 assert.ok(html.includes('已使用：1 次'));assert.ok(html.includes('已结束未用次数：9 次'));assert.ok(html.includes('套餐已结束'));
 for(const amount of ['3000','2400','600'])assert.ok(!html.includes(amount));
});
test('the boss package record includes corresponding manual collection and refund totals without changing service quantity',()=>{
 const html=record({type:'boss',id:'boss'});
 for(const text of ['3000','2400','600','已使用：1 次','已结束未用次数：9 次'])assert.ok(html.includes(text),text);
});
