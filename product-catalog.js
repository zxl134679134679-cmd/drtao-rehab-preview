class ApiError extends Error { constructor(status,code,message){super(message);this.status=status;this.code=code;} }
const denied=()=>new ApiError(403,'PERMISSION_DENIED','您没有当前门店的商品权限');
import {assertManageStore,canManageStore,isRootBoss,ownerStoreIdsForState as ownerStoreIds} from './franchise-scope.js?v=20261011-combination-approval-franchise-paper-search-7';

export const SERVICE_IDS=Object.freeze(['rehabilitation','cryotherapy','iastm','deep-stretch']);
const templates=[['annual','年卡','annual'],['half-year','半年卡','half-year'],['cryo','超低温冷疗','service'],['iastm','筋膜刀','service'],['stretch','深度拉伸放松治疗','service'],['equipment','器械','equipment']];
const command='configure-catalog-product',copy=v=>structuredClone(v),pick=(o,keys)=>Object.fromEntries(keys.filter(k=>o[k]!==undefined).map(k=>[k,copy(o[k])]));
const invalid=m=>{throw new ApiError(400,'INVALID_INPUT',m);},conflict=(code,m)=>{throw new ApiError(409,code,m);};
const plain=o=>o&&typeof o==='object'&&!Array.isArray(o);
const canonical=v=>Array.isArray(v)?v.map(canonical):plain(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const fields=['productId','storeId','expectedVersion','name','serviceContent','description','priceMinor','totalSessions','unitQuantity','validityMonths','validityDays','allowedServiceIds','active','reason'];
const required=['productId','storeId','expectedVersion','name','serviceContent','description','priceMinor','allowedServiceIds','active','reason'];
const rowKeys=['id','storeId','kind','name','serviceContent','description','version','status','priceMinor','totalSessions','unitQuantity','validityMonths','validityDays','allowedServiceIds'];
function text(v,label,max=80,empty=false){if(typeof v!=='string'||(!empty&&!v.trim())||v.trim().length>max)invalid(`请核对${label}`);return v.trim();}
function integer(v,label,min=0,max=1000000000){if(!Number.isSafeInteger(v)||v<min||v>max)invalid(`请核对${label}`);return v;}
function rows(state){if(state.productCatalog!==undefined&&!Array.isArray(state.productCatalog))invalid('商品目录集合异常');return state.productCatalog||[];}
export function initializeProductCatalog(state){
 const next=copy(state);next.productCatalog??=[];rows(next);
 for(const store of next.stores||[])for(const [suffix,name,kind]of templates){const id=`catalog-${store.id}-${suffix}`;if(!next.productCatalog.some(p=>p.id===id))next.productCatalog.push({id,storeId:store.id,kind,name,version:0,status:'unconfigured'});}
 return next;
}
function product(m,id,storeId){const row=rows(m.state).find(p=>p.id===id);if(!row||row.storeId!==storeId||!m.state.stores.some(s=>s.id===storeId))throw denied();return row;}
function normalized(p,row){
 if(!plain(p)||Object.keys(p).some(k=>!fields.includes(k))||required.some(k=>!Object.hasOwn(p,k)))invalid('商品配置字段不完整或含未知字段');
 const data={productId:text(p.productId,'商品标识'),storeId:text(p.storeId,'门店'),expectedVersion:integer(p.expectedVersion,'目录版本',0,1000000),name:text(p.name,'商品名称',80),serviceContent:text(p.serviceContent,'服务内容',2000,true),description:text(p.description,'说明',2000,true),priceMinor:integer(p.priceMinor,'商品价格分金额',1),allowedServiceIds:p.allowedServiceIds,active:p.active,reason:text(p.reason,'配置原因',1000)};
 if(typeof p.active!=='boolean'||!Array.isArray(p.allowedServiceIds)||new Set(p.allowedServiceIds).size!==p.allowedServiceIds.length||p.allowedServiceIds.some(id=>!SERVICE_IDS.includes(id)))invalid('请核对可用项目和发布状态');
 data.allowedServiceIds=[...p.allowedServiceIds];
 if(row.kind==='equipment'){
  if(['totalSessions','validityDays','validityMonths'].some(k=>Object.hasOwn(p,k))||data.allowedServiceIds.length)invalid('器械是实物，不能配置课程次数、有效期或治疗项目');
  data.unitQuantity=integer(p.unitQuantity,'每份实物数量',1,999);
 }else{
  if(Object.hasOwn(p,'unitQuantity')||!data.allowedServiceIds.length||Object.hasOwn(p,'validityDays')===Object.hasOwn(p,'validityMonths'))invalid('课程须配置次数、可用项目和唯一有效期');
  data.totalSessions=integer(p.totalSessions,'课程次数',1,999);
  if(p.priceMinor<data.totalSessions)invalid('课程价格不能少于次数对应的分金额');
  if(Object.hasOwn(p,'validityMonths'))data.validityMonths=integer(p.validityMonths,'有效月数',1,120);
  else data.validityDays=integer(p.validityDays,'有效天数',1,36500);
 }
 return data;
}
function dto(row,history=false,financial=true){const out=pick(row,rowKeys);if(!financial)delete out.priceMinor;if(history)out.history=copy(row.history||[]);return out;}
export function catalogReplay(m,r,name,p,snapshot){
 if(name!==command||snapshot?.id!==p.productId||snapshot.storeId!==p.storeId)throw denied();
 assertManageStore(m.state,r,p.storeId);const live=product(m,p.productId,p.storeId);if(live.kind!==snapshot.kind)throw denied();return dto(snapshot,true);
}
function configure(m,p,r,requestId){
 assertManageStore(m.state,r,p?.storeId);const row=product(m,p?.productId,p?.storeId),request=text(requestId,'提交标识'),key=JSON.stringify(canonical(p));
 const old=(m.state.catalogRequests||[]).find(v=>v.requestId===request&&v.actorId===r.id&&v.actorRole===r.type);
 if(old){if(old.inputKey!==key)conflict('REQUEST_CHANGED','同一提交请求的内容发生变化');return catalogReplay(m,r,command,p,old.snapshot);}
 const data=normalized(p,row);
 if(row.version!==data.expectedVersion)conflict('STALE_RECORD','商品版本已变化，请重新核对');
 const stage=Object.assign(Object.create(Object.getPrototypeOf(m)),m,{state:copy(m.state)}),target=product(stage,row.id,row.storeId),before=dto(target),history={id:stage._id('catalogHistory'),before,reason:data.reason,actorId:r.id,actorRole:r.type,createdAt:stage._timestamp()};
 for(const k of ['totalSessions','unitQuantity','validityDays','validityMonths'])delete target[k];
 Object.assign(target,pick(data,['name','serviceContent','description','priceMinor','totalSessions','unitQuantity','validityMonths','validityDays','allowedServiceIds']),{version:row.version+1,status:data.active?'published':'inactive'});target.history??=[];target.history.push(history);
 stage._log('catalog_product_configured',{productId:target.id,storeId:target.storeId,version:target.version,reason:data.reason},r);
 const result=dto(target,true);stage.state.catalogRequests??=[];stage.state.catalogRequests.push({id:stage._id('catalogRequest'),actorId:r.id,actorRole:r.type,requestId:request,inputKey:key,snapshot:copy(result)});
 m.state=stage.state;m.sequence=stage.sequence;return copy(result);
}
export function catalogProductSnapshot(m,storeId,line){
 if(!plain(line)||Object.keys(line).some(k=>!['productId','catalogVersion','quantity'].includes(k)))invalid('请核对组合商品行');
 text(line.productId,'商品');integer(line.catalogVersion,'目录版本',0,1000000);integer(line.quantity,'购买份数',1,99);
 const row=product(m,line.productId,storeId);if(row.status!=='published')conflict('CATALOG_NOT_AVAILABLE','商品尚未配置或已停售');if(row.version!==line.catalogVersion)conflict('STALE_RECORD','所选商品已变化，请重新核对');
 const snap={...dto(row),quantity:line.quantity,catalogVersion:row.version};
 if(!Number.isSafeInteger(snap.priceMinor)||snap.priceMinor<1||row.kind==='equipment'&&(!Number.isSafeInteger(row.unitQuantity)||row.unitQuantity<1)||row.kind!=='equipment'&&(!Number.isSafeInteger(row.totalSessions)||row.totalSessions<1))conflict('CATALOG_NOT_AVAILABLE','商品配置尚不完整');
 return snap;
}
export function catalogView(m,r){
 let stores,history=false,financial=false;
 if(isRootBoss(r)){stores=m.state.stores.map(s=>s.id);history=true;financial=true;}
 else if(r?.type==='franchise_owner'){stores=ownerStoreIds(m.state,r);history=true;financial=true;}
 else if(r?.type==='frontdesk'){stores=m.frontDeskStoreIds(r);financial=true;}
 else if(r?.type==='manager'){stores=[m.managerStoreId(r)];financial=true;}
 else if(r?.type==='therapist'){m._therapist(r.id);stores=m.state.stores.map(s=>s.id);}
 else if(r?.type==='customer'){m._client(r.id);stores=m.state.stores.map(s=>s.id);}
 else throw denied();
 return {productCatalog:rows(m.state).filter(p=>stores.includes(p.storeId)&&(financial||p.status==='published')).map(p=>dto(p,history&&canManageStore(m.state,r,p.storeId),financial))};
}
const id={type:'string',minLength:1,maxLength:80},int=(min,max)=>({type:'integer',minimum:min,maximum:max});
export const catalogCommands=Object.freeze({[command]:configure});
export const catalogSchemas=Object.freeze({[command]:{type:'object',additionalProperties:false,required,properties:{productId:id,storeId:id,expectedVersion:int(0,1000000),name:{type:'string',minLength:1,maxLength:80},serviceContent:{type:'string',maxLength:2000},description:{type:'string',maxLength:2000},priceMinor:int(1,1000000000),totalSessions:int(1,999),unitQuantity:int(1,999),validityMonths:int(1,120),validityDays:int(1,36500),allowedServiceIds:{type:'array',maxItems:4,uniqueItems:true,items:{enum:SERVICE_IDS}},active:{type:'boolean'},reason:{type:'string',minLength:1,maxLength:1000}}}});
