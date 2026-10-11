import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoModel} from './core.js';
import {renderStaff} from './staff.js';
import * as search from './client-search.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
test('actual therapist work renderer marks today, future, followup and completed customer lists for name filtering',()=>{
 const model=new DemoModel();const role={type:'therapist',id:'t-qiu-zhen'};
 const today=model.today;
 model.state.clients.push({...model.state.clients[0],id:'search-client',name:'列表验收',ownerId:role.id,storeId:'a'});
 model.state.appointments.push({id:'search-today',clientId:'search-client',storeId:'a',date:today,time:'11:00',project:'康复训练',principalId:role.id,participantIds:[],status:'confirmed'}, {id:'search-future',clientId:'search-client',storeId:'a',date:'2026-11-01',time:'11:00',project:'康复训练',principalId:role.id,participantIds:[],status:'confirmed'});
 model.state.services.push({id:'search-completed',clientId:'search-client',storeId:'a',date:today,time:'09:00',project:'康复训练',principalId:role.id,participantIds:[],status:'valid',amount:0});
 const html=renderStaff({model,role,view:'work',esc,icon:()=>''});
 assert.match(html,/<h2>今天的服务<\/h2>[\s\S]*?<div class="ease-service-list" data-client-search-list>/);
 assert.match(html,/之后的预约[\s\S]*?<div class="ease-service-list" data-client-search-list>/);
 assert.match(html,/我负责客户的跟进[\s\S]*?<div class="line-list" data-client-search-list>/);
 assert.match(html,/今日完成记录[\s\S]*?<div class="line-list" data-client-search-list>/);
});
test('list name search resolves visible appointment/service/intake/approval sources but never arbitrary IDs or numbers',()=>{
 const ctx={model:{state:{clients:[{id:'c1',name:'Alice',phone:'13800000001'}],appointments:[{id:'a1',clientId:'c1'}],services:[{id:'s1',clientId:'c1'}],paperIntakes:[{id:'p1',clientId:'c1'}],amountApplications:[{id:'x1',clientId:'c1'}]}}};
 assert.equal(typeof search.clientIdForAction,'function');
 for(const [action,id] of [['register-appointment','a1'],['service-detail','s1'],['paper-intake-review','p1'],['amount-decision','x1']])assert.equal(search.clientIdForAction(action,id,ctx),'c1');
 assert.equal(search.clientIdForAction('edit-therapist','c1',ctx),'');
 assert.equal(search.clientIdForAction('client-detail','13800000001',ctx),'');
});
