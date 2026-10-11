import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as core from './core.js';
import {ensureEvaluations} from './evaluations.js';
import {ensureCustomerBooking} from './customer-booking.js';
import {ensurePaperIntakes} from './paper-intake.js';
import {ensureSchedules,saveSchedule} from './schedules.js';
import {renderFranchiseManagement,renderFranchiseDashboard,franchiseDialog} from './franchise-ui.js';

const boss={type:'boss',id:'boss'},owner={type:'franchise_owner',id:'franchise-preview-suzhou'};
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const fresh=()=>new core.DemoModel({now:()=> '2026-10-08T08:00:00.000Z'});
const sample=()=>({id:'franchise-preview-suzhou',previewOnly:true,name:'苏州店加盟老板（示例）',phone:'',storeIds:['store-suzhou'],active:true,profileVersion:0,history:[]});
const context=(model,role)=>({model:model.uiModel(role),role,view:'overview',esc,filters:{},fmt:{money:String,date:String}});
function ensure(model){assert.equal(typeof core.ensureFranchisePreviewExamples,'function','explicit preview initializer must exist');return core.ensureFranchisePreviewExamples(model);}
function suppliedSample(){const model=fresh();model.state.franchiseOwners=[sample()];return model;}
function update(row,extra={}){return {id:row.id,name:row.name,phone:row.phone,storeIds:row.storeIds,active:row.active,expectedVersion:row.profileVersion,reason:'验收核对授权',requestId:'sample-change',...extra};}
const snapshot=model=>JSON.stringify([model.state,model.sequence]);
function refused(model,run,pattern=/权限|老板|门店|手机号|电话|非法字段/){const before=snapshot(model);assert.throws(run,pattern);assert.equal(snapshot(model),before);}

// A removed initialization guard would repopulate an intentionally empty roster.
test('explicit preview initialization grants only Suzhou and invents no local business facts',()=>{
 const model=fresh();assert.equal((model.state.franchiseOwners||[]).length,0);
 const before=structuredClone(model.state);ensure(model);
 assert.deepEqual(model.state.franchiseOwners,[sample()]);
 const {franchiseOwners,...business}=model.state;const {franchiseOwners:priorOwners,...priorBusiness}=before;
 assert.deepEqual(business,priorBusiness);assert.deepEqual(model.ownerStoreIds({...owner,storeIds:['a','b']}),['store-suzhou']);
 const view=model.franchiseState(owner);assert.deepEqual(view.stores.map(row=>row.id),['store-suzhou']);assert.equal(view.stores[0].address,'');
 for(const key of ['clients','therapists','frontDesks','storeManagers','packages','services','appointments','receipts','refunds','staffSchedules'])assert.deepEqual(view[key],[],key);
 refused(model,()=>model.updateStore({id:'a',name:'外店越权',address:'',expectedVersion:0,reason:'越权',requestId:'foreign'},owner));
 refused(model,()=>model.addFranchiseOwner({name:'自行开通',phone:'13899009999',storeIds:['store-suzhou'],reason:'越权',requestId:'forge'},owner));
});

test('repeated preview initialization preserves revocation, reassignment and deleted roster',()=>{
 for(const action of ['stop','reassign','delete']){
  const model=fresh();ensure(model);
  if(action==='delete')model.state.franchiseOwners=[];
  else model.updateFranchiseOwner(update(model.state.franchiseOwners[0],action==='stop'?{active:false}:{storeIds:['b']}),boss);
  const before=snapshot(model);ensure(model);ensure(model);assert.equal(snapshot(model),before);
  assert.equal(model.isStoreOwner(owner,['store-suzhou']),false);
 }
});

test('first initializer call with an existing roster never becomes a later automatic grant',()=>{
 const model=fresh();model.state.franchiseOwners=[{...sample(),id:'existing',previewOnly:false,phone:'13899001111',storeIds:['a']}];
 ensure(model);model.state.franchiseOwners=[];ensure(model);assert.deepEqual(model.state.franchiseOwners,[]);
});

test('supplied archives never acquire preview permissions when missing, empty, revoked or reassigned',()=>{
 for(const rows of [undefined,[],[{...sample(),active:false}],[{...sample(),storeIds:['b']}]] ){
  const state=structuredClone(fresh().state);if(rows===undefined)delete state.franchiseOwners;else state.franchiseOwners=rows;
  const model=new core.DemoModel({state});ensure(model);
  assert.deepEqual(model.state.franchiseOwners,rows||[]);assert.equal(model.isStoreOwner(owner,['store-suzhou']),false);
 }
});

test('loaded franchise roster validates authority shape and preserves unique allocation sequence',()=>{
 for(const rows of [{},[sample(),sample()],[{...sample(),active:'true'}],[{...sample(),storeIds:[]}],[{...sample(),storeIds:['missing']}],[{...sample(),storeIds:['a','a']}]] ){
  const state=structuredClone(fresh().state);state.franchiseOwners=rows;assert.throws(()=>new core.DemoModel({state}),/状态|身份|加盟|门店|重复/);
 }
 const state=structuredClone(fresh().state);state.franchiseOwners=[{...sample(),id:'franchise101',previewOnly:false,phone:'13899001111'}];
 const loaded=new core.DemoModel({state}),added=loaded.addFranchiseOwner({name:'验收新增身份',phone:'13899002222',storeIds:['store-suzhou'],reason:'明确总部授权',requestId:'new'},boss);
 assert.notEqual(added.id,'franchise101');assert.equal(new Set(loaded.state.franchiseOwners.map(row=>row.id)).size,2);
});

test('headquarters can edit and revoke the existing blank-contact preview without fabricating contact details',()=>{
 const model=suppliedSample(),row=model.state.franchiseOwners[0];
 const edited=model.updateFranchiseOwner(update(row,{name:'苏州加盟体验（示例）'}),boss);assert.equal(edited.phone,'');assert.equal(edited.previewOnly,true);assert.equal(edited.profileVersion,1);
 const stopped=model.updateFranchiseOwner(update(edited,{active:false,requestId:'stop'}),boss);assert.equal(stopped.active,false);assert.equal(stopped.history.length,2);assert.equal(stopped.history[1].before.phone,'');assert.equal(stopped.history[1].actorId,'boss');assert.equal(stopped.history[1].actorRole,'boss');
 assert.equal(model.isStoreOwner(owner,['store-suzhou']),false);const before=snapshot(model);model.updateFranchiseOwner(update(row,{name:'苏州加盟体验（示例）'}),boss);assert.equal(snapshot(model),before);
});

test('preview contact exemption cannot be added through payload or applied to another identity',()=>{
 const model=suppliedSample(),data={name:'待核对身份',phone:'',storeIds:['store-suzhou'],reason:'测试',requestId:'create'};
 refused(model,()=>model.addFranchiseOwner(data,boss));refused(model,()=>model.addFranchiseOwner({...data,previewOnly:true},boss));
 const ordinary=model.addFranchiseOwner({...data,phone:'13899003333'},boss);refused(model,()=>model.updateFranchiseOwner(update(ordinary,{phone:''}),boss));
 model.state.franchiseOwners.push({...sample(),id:'forged-preview'});refused(model,()=>model.updateFranchiseOwner(update(model.state.franchiseOwners.at(-1)),boss));
 for(const phone of ['123',null])refused(model,()=>model.updateFranchiseOwner(update(model.state.franchiseOwners[0],{phone}),boss));
});

test('preview interfaces disclose unknown contact and allow blank-contact headquarters revocation',()=>{
 const model=suppliedSample();ensureSchedules(model);
 const management=renderFranchiseManagement(context(model,boss));assert.match(management,/示例身份/);assert.match(management,/真实姓名\/手机号待配置/);
 const edit=franchiseDialog('franchise-owner-edit',owner.id,context(model,boss)).html;
 const phoneTag=edit.match(/<input\b[^>]*name="phone"[^>]*>/)?.[0];assert.ok(phoneTag);assert.doesNotMatch(phoneTag,/\brequired\b/);assert.match(edit,/真实姓名\/手机号待配置/);
 const create=franchiseDialog('franchise-owner-create','',context(model,boss)).html;assert.match(create.match(/<input\b[^>]*name="phone"[^>]*>/)?.[0]||'',/\brequired\b/);
 const dashboard=renderFranchiseDashboard(context(model,owner));assert.match(dashboard,/示例身份/);assert.match(dashboard,/真实姓名\/手机号待配置/);assert.match(dashboard,/人员.*待配置/);assert.match(dashboard,/地址待配置/);assert.doesNotMatch(dashboard,/麦岛店|崂山店|franchise-owner-create/);
 refused(model,()=>saveSchedule(model,{therapistId:'t-qiu-zhen',storeId:'a',date:'2026-10-12',status:'work',startTime:'09:00',endTime:'18:00',expectedVersion:0,reason:'越权',requestId:'foreign-shift'},owner));
});

function roleRuntime(model){
 const select={innerHTML:'',value:''},controls={open:true};const scope={model,role:boss,view:'team',filters:{},TODAY:model.today,esc,customerShare:false,window:{matchMedia:()=>({matches:false})},$:(selector)=>selector==='#role-select'?select:controls,closeDialog(){},render(){}};
 vm.runInNewContext(source.slice(source.indexOf('const find ='),source.indexOf('const icon ='))+source.slice(source.indexOf('function roleOptions()'),source.indexOf('function navigation()'))+'globalThis.options=roleOptions;globalThis.switch=switchRole;',scope);
 return {scope,select};
}

test('actual role selector lists assigned stores and excludes invalid or revoked franchise grants',()=>{
 const model=suppliedSample();model.state.franchiseOwners.push({...sample(),id:'unassigned',storeIds:[]},{...sample(),id:'unknown-store',storeIds:['missing']},{...sample(),id:'duplicate',storeIds:['a']},{...sample(),id:'duplicate',storeIds:['b']});
 const {scope,select}=roleRuntime(model);scope.options();
 const group=select.innerHTML.match(/<optgroup label="加盟端">([\s\S]*?)<\/optgroup>/)?.[1]||'';
 assert.match(group,/value="franchise_owner:franchise-preview-suzhou"[^>]*>[^<]*苏州店[^<]*示例|value="franchise_owner:franchise-preview-suzhou"[^>]*>[^<]*示例[^<]*苏州店/);
 assert.doesNotMatch(group,/franchise_owner:(?:unassigned|unknown-store|duplicate)/);
 scope.switch('franchise_owner:'+owner.id);assert.equal(scope.role.type,'franchise_owner');assert.equal(scope.role.id,owner.id);assert.equal(scope.view,'overview');
 scope.switch('boss:boss');model.updateFranchiseOwner(update(model.state.franchiseOwners[0],{active:false}),boss);scope.options();assert.doesNotMatch(select.innerHTML,/value="franchise_owner:franchise-preview-suzhou"/);
 scope.switch('franchise_owner:'+owner.id);assert.equal(scope.role.type,'boss');assert.equal(model.state.franchiseOwners[0].active,false);
});

test('actual app initial model explicitly initializes the preview while plain models keep an empty roster',()=>{
 const scope={DemoModel:core.DemoModel,previewTimestamp:()=> '2026-10-08T08:00:00.000Z',ensureFranchisePreviewExamples:core.ensureFranchisePreviewExamples,ensureStorePackageExamples:core.ensureStorePackageExamples,ensureEvaluations,ensureCustomerBooking,ensurePaperIntakes,ensureSchedules};
 vm.runInNewContext(source.slice(source.indexOf('let model = new DemoModel'),source.indexOf("let role ="))+'globalThis.initialModel=model;',scope);
 assert.equal(scope.initialModel.isStoreOwner(owner,['store-suzhou']),true);assert.equal((fresh().state.franchiseOwners||[]).length,0);
});

test('actual explicit reset restores the documented Suzhou example as a deliberate new preview',()=>{
 const model=suppliedSample();model.state.franchiseOwners[0].active=false;
 const scope={model,DemoModel:core.DemoModel,previewTimestamp:()=> '2026-10-08T08:00:00.000Z',ensureFranchisePreviewExamples:core.ensureFranchisePreviewExamples,ensureStorePackageExamples:core.ensureStorePackageExamples,ensureEvaluations,ensureCustomerBooking,ensurePaperIntakes,ensureSchedules,drafts:new Map(),preferences:new Map(),$ :()=>({checked:true}),closeDialog(){},render(){},toast(){},role:boss,view:'team',filters:{}};
 const start=source.indexOf("} else if (type === 'reset') {"),end=source.indexOf("} else throw new Error('此表单暂不可提交');",start);
 vm.runInNewContext('function runReset(){'+source.slice(start+'} else if (type === \'reset\') {'.length,end)+'}runReset();',scope);
 assert.equal(scope.model.isStoreOwner(owner,['store-suzhou']),true);assert.equal(scope.model.state.franchiseOwners[0].phone,'');
});
