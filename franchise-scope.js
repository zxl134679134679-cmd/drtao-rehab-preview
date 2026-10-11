/* Current, explicit store grants for franchise owners. Headquarters stays boss/boss. */
const clone=value=>JSON.parse(JSON.stringify(value));
const text=(value,label,max=500)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`请填写有效的${label}`);return value.trim();};
const version=value=>{if(!['number','string'].includes(typeof value)||!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<0)throw new Error('加盟身份版本无效');return Number(value);};
export function ownerStoreIds(model,role){
 if(role?.type==='boss'){model._boss(role);return model.state.stores.map(store=>store.id);}
 if(role?.type!=='franchise_owner')throw new Error('仅总部或当前授权加盟老板有经营权限');
 const rows=(model.state.franchiseOwners||[]).filter(row=>row.id===role.id);
 if(rows.length!==1||rows[0].active!==true)throw new Error('加盟老板身份不存在或已停用');
 const ids=rows[0].storeIds;
 if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!model.state.stores.some(store=>store.id===id)))throw new Error('加盟老板门店分配无效，请联系总部核对');
 return [...ids];
}
export function assertStoreOwner(model,role,storeIds){
 const allowed=ownerStoreIds(model,role);
 if(!Array.isArray(storeIds)||!storeIds.length||storeIds.some(id=>typeof id!=='string'||!id||!allowed.includes(id)))throw new Error('记录门店不明确或不在当前加盟经营授权范围，请由总部核对');
}
export function saveFranchiseOwner(model,data,role,editing=false){
 model._boss(role);
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('请填写加盟身份资料');
 const keys=new Set(['id','name','phone','storeIds','active','expectedVersion','reason','requestId']);
 if(Object.keys(data).some(key=>!keys.has(key)))throw new Error('加盟身份资料含非法字段');
 const current=editing?(model.state.franchiseOwners||[]).find(row=>row.id===data.id):null;
 if(editing&&!current)throw new Error('加盟身份不存在');
 if(!Array.isArray(data.storeIds)||!data.storeIds.length||data.storeIds.some(id=>typeof id!=='string'||!model.state.stores.some(store=>store.id===id)))throw new Error('请选择有效的分配门店');
 if(new Set(data.storeIds).size!==data.storeIds.length)throw new Error('分配门店不能重复');
 const active=data.active===undefined?current?.active??true:data.active===true||data.active==='true'?true:data.active===false||data.active==='false'?false:null;
 if(active===null)throw new Error('加盟身份启停状态无效');
 const preview=current?.id==='franchise-preview-suzhou'&&current.previewOnly===true;
 const contact=preview&&typeof data.phone==='string'&&!data.phone.trim()?'':text(data.phone,'加盟老板手机号',30).replace(/\s/g,'');if(contact!==''&&!/^1\d{10}$/.test(contact))throw new Error('加盟老板手机号须为11位');
 const input={name:text(data.name,'加盟老板姓名',80),phone:contact,storeIds:[...data.storeIds].sort(),active};
 const expectedVersion=editing?version(data.expectedVersion):0,reason=text(data.reason,'授权或修改原因',500),requestId=text(data.requestId,'提交标识',150);
 const action=editing?'franchise_owner_updated':'franchise_owner_added',inputKey=JSON.stringify({id:current?.id||'',...input,expectedVersion,reason});
 const prior=model.state.audit.find(row=>row.type===action&&row.actorId===role.id&&row.actorType===role.type&&row.requestId===requestId);
 if(prior){if(prior.inputKey!==inputKey)throw new Error('同一提交请求的加盟资料发生变化');const result=(model.state.franchiseOwners||[]).find(row=>row.id===prior.franchiseOwnerId);if(!result)throw new Error('原提交身份待总部核对');return clone(result);}
 if(current&&version(current.profileVersion??0)!==expectedVersion)throw new Error('加盟身份版本已更新，请重新核对');
 if(!editing&&!active)throw new Error('新增加盟身份须启用，停用请在已存身份核对');
 const stamp=model._timestamp(),staged=Object.assign(Object.create(Object.getPrototypeOf(model)),model,{state:{...model.state,franchiseOwners:clone(model.state.franchiseOwners||[]),audit:[...model.state.audit]},now:()=>stamp});
 const id=current?.id||staged._id('franchise'),before=current?{id:current.id,name:current.name,phone:current.phone,storeIds:clone(current.storeIds),active:current.active,profileVersion:current.profileVersion??0}:null;
 const entry={before,reason,actorId:role.id,actorRole:role.type,createdAt:stamp};
 const row={...(current?clone(current):{id,createdAt:stamp,createdBy:role.id,createdRole:role.type}),...input,profileVersion:editing?expectedVersion+1:0,history:editing?[...(current.history||[]),entry]:[]};
 const index=staged.state.franchiseOwners.findIndex(item=>item.id===id);if(index<0)staged.state.franchiseOwners.push(row);else staged.state.franchiseOwners[index]=row;
 staged._log(action,{franchiseOwnerId:id,storeIds:input.storeIds,before,after:clone(input),reason,requestId,inputKey},role,stamp);
 model.state=staged.state;model.sequence=staged.sequence;return clone(row);
}
const basicClient=client=>Object.fromEntries(['id','name','phone','age','storeId','ownerId','assessorId'].filter(key=>client[key]!==undefined).map(key=>[key,clone(client[key])]));
const privateKeys=new Set(['inputKey','requestId','receptionInputKey','receptionRequestId','ledgerFingerprint','confirmInputKey','confirmRequestId','reviewInputKey','reviewRequestId','taskSnapshots','appointmentSnapshots','sourceBasis']);
export function franchiseState(model,role){
 const ids=new Set(ownerStoreIds(model,role));
 if(role.type==='boss')return clone(model.state);
 const clean=value=>Array.isArray(value)?value.filter(row=>!row||typeof row!=='object'||!row.storeId||ids.has(row.storeId)).map(clean):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!privateKeys.has(key)).map(([key,item])=>[key,clean(item)])):value;
 const own=row=>Boolean(row?.storeId)&&ids.has(row.storeId);
 const localCollections=['packages','services','appointments','receipts','refunds','cashClosings','paperIntakes','assessments','frontDeskEvaluations','staffSchedules','scheduleChangeRequests','bookingRequests','productCatalog','purchaseIntents','amountApplications','equipmentOrders','assessorSchedules','storeDutyAssignments','identityBindings','serviceVisits'];
 const result=Object.fromEntries(localCollections.map(key=>[key,clean((model.state[key]||[]).filter(own))]));
 const related=new Set(localCollections.flatMap(key=>result[key].map(row=>row.clientId).filter(Boolean)));
 result.stores=clone(model.state.stores.filter(row=>ids.has(row.id)));
 result.therapists=clean(model.state.therapists.filter(own));result.storeManagers=clean(model.state.storeManagers.filter(own));
 result.frontDesks=clean((model.state.frontDesks||[]).filter(row=>row.storeIds?.some(id=>ids.has(id))).map(row=>({...row,storeIds:row.storeIds.filter(id=>ids.has(id))})));
 result.assessors=clean((model.state.assessors||[]).filter(row=>row.storeIds?.some(id=>ids.has(id))).map(row=>({...row,storeIds:row.storeIds.filter(id=>ids.has(id))})));
 result.clients=model.state.clients.filter(row=>own(row)||related.has(row.id)).map(row=>{const client=own(row)?clean(row):basicClient(row);if(client.storeTherapistIds)client.storeTherapistIds=Object.fromEntries(Object.entries(client.storeTherapistIds).filter(([id])=>ids.has(id)));if(!result.packages.some(p=>p.id===client.packageId))client.packageId=null;return client;});
 result.tasks=clean((model.state.tasks||[]).filter(own));
 result.reviews=clean((model.state.reviews||[]).filter(row=>{const service=model.state.services.find(item=>item.id===row.serviceId);return own(service);}));
 result.audit=clean(model.state.audit.filter(own));
 result.franchiseOwners=clean((model.state.franchiseOwners||[]).filter(row=>row.id===role.id).map(row=>({id:row.id,name:row.name,storeIds:row.storeIds,active:row.active,profileVersion:row.profileVersion,...(row.previewOnly===true?{previewOnly:true}:{})})));
 return clone(result);
}

export const isRootBoss=role=>role?.type==='boss'&&role.id==='boss';
export const isOperatingOwner=role=>isRootBoss(role)||role?.type==='franchise_owner';
export function ownerStoreIdsForState(state,role){return ownerStoreIds({state,_boss:r=>{if(!isRootBoss(r))throw new Error('仅总部老板有权限');}},role);}
export function canManageStore(state,role,id){try{return ownerStoreIdsForState(state,role).includes(id);}catch{return false;}}
export function assertManageStore(state,role,id){if(!canManageStore(state,role,id))throw new Error('记录门店不明确或不在当前老板授权范围，请由总部核对');}
export function canApproveStore(state,role,id){return canManageStore(state,role,id)||role?.type==='manager'&&state.storeManagers.some(m=>m.id===role.id&&m.active===true&&m.storeId===id)&&state.stores.some(s=>s.id===id);}
