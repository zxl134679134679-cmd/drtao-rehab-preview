// Small dialogs for the existing work flow; all writes remain in the model.
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const find=(m,k,id)=>m.state[k]?.find(r=>r.id===id);
const name=(m,k,id)=>id==='boss'?'老板':find(m,k,id)?.name||'待安排';
const money=v=>`¥${Number(v||0).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const hidden=(k,v)=>`<input type="hidden" name="${k}" value="${esc(v)}">`;
const pair=(k,v)=>`<div class="detail-pair"><span class="muted">${esc(k)}</span><strong>${esc(v)}</strong></div>`;
const button=(label,type,id='',style='btn-outline')=>`<button type="button" class="btn ${style}" data-action="${type}" data-id="${esc(id)}">${esc(label)}</button>`;
const textarea=(label,key,value='',extra='')=>`<label class="field span-all"><span>${esc(label)}</span><textarea name="${key}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
const form=(type,body,label)=>`<form data-form="${type}">${body}<p class="form-error" role="alert" hidden></p><div class="dialog-footer">${button('返回','close-dialog','','btn-quiet')}<button type="submit" class="btn btn-primary">${esc(label)}</button></div></form>`;
const special=new Set(['service_note','reschedule','review_followup','appointment_cancellation']);
export const workflowTypes=new Set(['task-detail','task-complete','task-edit','assign-store-therapist','appointment-cancel-request','appointment-cancel-handle','confirm-service-next-step']);

function allowedTask(model,role,id){
 if(role.type==='manager') {const row=model.managerSnapshot(role).tasks.find(t=>t.id===id);if(!row)throw new Error('您没有本店待办权限');return row;}
 const task=find(model,'tasks',id);if(!task)throw new Error('待办不存在');
 if(role.type==='boss')model._boss(role);
 else if(role.type!=='therapist'||task.type==='review_followup'||!model.canSeeClient(role,task.clientId)||(task.assigneeId!==role.id&&!(task.type==='intake_followup'&&find(model,'clients',task.clientId)?.ownerId===role.id)))throw new Error('仅待办负责人或老板有权限查看');
 return task;
}

export function workflowDialog(type,id,{model,role}){
 if(!workflowTypes.has(type))return null;
 if(type.startsWith('task-')){
  const task=allowedTask(model,role,id),done=['completed','done'].includes(task.status);
  if(type==='task-edit'){
   model._boss(role);if(done||special.has(task.type))throw new Error('关联业务待办请处理原业务，不能直接调整');
   const people=model.state.therapists.filter(t=>t.active&&model.canSeeClient({type:'therapist',id:t.id},task.clientId)&&(!task.storeId||model._therapistClientWorkAllowed(t.id,task.clientId,task.storeId)));
   return {title:'调整待办负责人和期限',html:form(type,`${hidden('id',id)}<p><strong>${esc(task.title)}</strong> · ${esc(name(model,'clients',task.clientId))}</p><div class="form-grid"><label class="field"><span>负责人</span><select name="assigneeId" required><option value="boss"${task.assigneeId==='boss'?' selected':''}>老板</option>${people.map(t=>`<option value="${esc(t.id)}"${task.assigneeId===t.id?' selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label class="field"><span>完成日期</span><input type="date" name="dueDate" value="${esc(task.dueDate)}" min="${model.today}" required></label>${textarea('调整原因','reason','','required maxlength="500"')}</div>`,'保存调整')};
  }
  const summary=`<h3>${esc(task.title)}</h3><div class="detail-grid">${pair('客户',name(model,'clients',task.clientId))}${pair('负责人',name(model,'therapists',task.assigneeId))}${pair('计划日期',task.dueDate)}${task.storeId?pair('门店',name(model,'stores',task.storeId)):''}${pair('状态',done?'已完成':task.dueDate<model.today?'已逾期，待处理':'待处理')}</div>`;
  if(type==='task-complete'){
   if(role.type==='manager')throw new Error('请由待办负责人或老板完成');
   if(role.type==='therapist'&&task.assigneeId!==role.id)throw new Error('请由待办负责人完成实际工作');
   if(done)return {title:'待办已完成',html:`${summary}<p>${esc(task.completionResult||'原任务已处理')}</p>`};
   if(special.has(task.type))return {title:'处理关联业务',html:`${summary}<p class="notice">完成实际业务后，此待办才会完成。</p>${button('去处理','task-complete',id,'btn-primary')}`};
   return {title:'记录待办处理结果',html:form(type,`${hidden('id',id)}${summary}${textarea('实际处理结果','result','','required maxlength="1000" placeholder="例如：已联系客户，确认周六10点到店；或记录评估完成情况"')}<p class="meta">请在工作实际完成后填写，老板能看到结果与处理人。</p>`,'保存结果并完成待办')};
  }
  return {title:'工作待办详情',html:`${summary}${done?`<h3>处理结果</h3><p>${esc(task.completionResult||'关联业务已完成')}</p><p class="meta">${esc(task.completedAt||'')}</p>`:''}<div class="action-row">${!done&&(role.type==='boss'||role.type==='therapist'&&task.assigneeId===role.id)?button('处理待办','task-complete',id,'btn-primary'):''}${!done&&!special.has(task.type)&&role.type==='boss'?button('调整负责人和期限','task-edit',id):''}${task.paperIntakeId?button('查看接待表','paper-intake-detail',task.paperIntakeId):''}${role.type==='manager'?button('查看客户','manager-client',task.clientId):button('查看客户档案','client-detail',task.clientId)}</div>`};
 }
 if(type==='assign-store-therapist'){
  model._boss(role);const client=find(model,'clients',id);if(!client)throw new Error('客户不存在');
  const stores=model.state.stores.filter(s=>s.active!==false),storeId=stores.find(s=>s.id===client.storeId)?.id||stores[0]?.id;
  return {title:'指定各店执行康复师',html:form(type,`${hidden('clientId',id)}<p><strong>${esc(client.name)}</strong> · 统一负责人 ${esc(name(model,'therapists',client.ownerId))}</p><p class="notice">为选定门店指定执行师，方便首次预约；不转交统一负责人，不改变套餐次数。各店套餐仍只在本店使用。</p><div class="form-grid"><label class="field"><span>服务门店</span><select name="storeId" required>${stores.map(s=>`<option value="${esc(s.id)}"${s.id===storeId?' selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label class="field"><span>本店执行康复师</span><select name="therapistId" required>${executionOptions(model,id,storeId)}</select></label>${textarea('安排说明','reason','','required maxlength="500" placeholder="例如：客户在崂山店办卡，指定周亦宁负责本店服务"')}</div>`,'保存本店执行师')};
 }
 if(type==='appointment-cancel-request'||type==='appointment-cancel-handle'){
  const a=find(model,'appointments',id);if(!a)throw new Error('预约不存在');
  const request=a.cancellationRequest;
  const summary=`<h3>${esc(name(model,'clients',a.clientId))} · ${esc(a.date)} ${esc(a.time)}</h3><p>${esc(a.project)} · ${esc(name(model,'stores',a.storeId))} · ${esc(name(model,'therapists',a.principalId))}</p>`;
  if(type==='appointment-cancel-request'){
   if(role.type==='customer'){if(role.id!==a.clientId)throw new Error('仅客户本人可以申请取消');}else if(role.type==='frontdesk')model.assertCancellationActor(role,a);else throw new Error('仅客户本人或本店前台可申请取消');
   if(request?.status==='pending')return {title:'取消申请待门店处理',html:`${summary}<p class="notice">原预约时间仍保留，门店确认后才取消。本次申请不扣次数。</p><p>申请原因：${esc(request.reason)}</p>`};
   if(!['confirmed','reschedule_requested'].includes(a.status))throw new Error('该预约已处理，不能申请取消');
   return {title:'申请取消预约',html:form(type,`${hidden('id',id)}${summary}${textarea('取消原因','reason','','required maxlength="500" placeholder="请说明需要取消的原因"')}<p class="notice">${role.type==='frontdesk'?'老板或本店店长批准前':'门店确认前'}，原预约仍保留；申请本身不扣次数、不改变收款。</p>`,'提交取消申请')};
  }
  model.assertCancellationActor(role,a,{approval:request?.needsApproval===true||request?.source==='frontdesk'});
  if(request?.status!=='pending')return {title:'取消申请已处理',html:`${summary}<p class="notice">请返回查看最新预约状态。</p>`};
  return {title:'处理取消申请',html:form(type,`${hidden('id',id)}${summary}<div class="note"><strong>${request.source==='frontdesk'?'前台申请取消，待老板或本店店长批准':'客户申请取消'}</strong><p>${esc(request.reason)}</p></div><label class="field"><span>处理结果</span><select name="decision" required><option value="">请选择处理结果</option><option value="approve">${role.type==='frontdesk'?'核对同意 · 申请老板或本店店长批准':'同意取消 · 释放时间'}</option><option value="reject">暂不同意 · 保留预约</option></select></label>${textarea('处理说明','reason','','required maxlength="500" placeholder="说明已核对的情况，客户可以查看"')}<p class="meta">只处理预约，不扣次数、不退款。款项更正仍由老板处理。</p>`,'保存处理结果')};
 }
 if(type==='confirm-service-next-step'){
  const s=find(model,'services',id),c=s&&find(model,'clients',s.clientId);
  if(!s||s.status!=='valid'||!c||!s.nextStepSuggestion)throw new Error('本次服务没有可确认的下一步建议');
  if(role.type==='boss')model._boss(role);else if(role.type!=='therapist'||c.ownerId!==role.id||!model.canSeeClient(role,c.id))throw new Error('请由客户负责人或老板确认下一步');
  return {title:'确认客户的下一步',html:form(type,`${hidden('serviceId',s.id)}<p><strong>${esc(c.name)}</strong> · ${esc(s.date)} ${esc(s.project)}</p><p class="meta">本次服务建议由 ${esc(name(model,'therapists',s.principalId))} 填写。确认后更新客户首页下一步，保留其他计划内容。</p>${textarea('客户接下来要做什么','nextStep',s.nextStepSuggestion,'required maxlength="500"')}`,'确认并更新客户下一步')};
 }
}

function executionOptions(model,clientId,storeId,previous=''){
 const people=model.state.therapists.filter(t=>t.active&&t.storeId===storeId);
 const assigned=model.clientStoreTherapist?.(clientId,storeId)||'';
 const selected=people.some(t=>t.id===previous)?previous:assigned;
 return `<option value="">请选择本店执行康复师</option>${people.map(t=>`<option value="${esc(t.id)}"${t.id===selected?' selected':''}>${esc(t.name)}</option>`).join('')}`;
}
export function updateWorkflowForm(form,{model}){
 if(form?.dataset.form!=='assign-store-therapist'||form.dataset.busy==='true')return;
 const select=form.elements.therapistId;
 select.innerHTML=executionOptions(model,form.elements.clientId.value,form.elements.storeId.value,select.value);
}

export function serviceResultSummary(s,{model},mode='registered'){
 const single=s.billingMode==='single';
 const appointment=find(model,'appointments',s.appointmentId),reassignment=mode==='revoked'&&appointment?.status==='pending_reassignment'?`<p class="notice">原预约需重新安排：${esc(appointment.reassignmentReason||'原时间或服务人员已不可用，请重新核对安排。')}</p>${button('重新安排原预约','appointment-edit',appointment.id,'btn-primary')}`:'';
 if(mode==='revoked'&&single)return `<p class="notice">单次服务业绩已冲回，收款记录保留；本次更正不自动退款。</p><div class="detail-grid">${pair('客户',name(model,'clients',s.clientId))}${pair('冲回消费业绩',money(s.amount))}${pair('主康复师',name(model,'therapists',s.principalId))}</div><p class="meta">原服务小结、照片和撤销原因保留，不改变任何套餐次数。</p>${reassignment}`;
 if(single)return `<div class="success-summary detail-grid">${pair('登记方式','单次服务 · 不扣套餐次数')}${pair('消费业绩',`${money(s.amount)}，归${name(model,'therapists',s.principalId)}`)}${pair('照片留底',`${s.evidencePhotos?.length||0} 张`)}</div><p class="muted">已关联本次单次服务收款，不会新增收款；协作只保留参与记录。</p>`;
 if(mode==='revoked')return `<div class="detail-grid">${pair('客户',name(model,'clients',s.clientId))}${pair('恢复至原套餐',name(model,'packages',s.packageId))}${pair('原套餐剩余',`${model.packageRemaining(s.packageId)} 次`)}${pair('冲回消费业绩',money(s.amount))}${pair('主康复师',name(model,'therapists',s.principalId))}</div><p class="muted">原服务记录与撤销原因保留。${find(model,'packages',s.packageId)?.closed?'原套餐已结束，更正不会重新启用次数。':''}</p>${reassignment}`;
 return `<div class="success-summary detail-grid">${pair('本次套餐剩余',`${model.packageRemaining(s.packageId)} 次`)}${pair('消费业绩',`${money(s.amount)}，归${name(model,'therapists',s.principalId)}`)}${pair('照片留底',`${s.evidencePhotos?.length||0} 张，可在服务明细查看`)}</div><p class="muted">协作只保留参与记录，本次仅扣 1 次；本次登记不会新增收款。</p>`;
}
