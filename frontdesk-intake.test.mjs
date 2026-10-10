import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { confirmedTestSchedules } from './scheduling-test-fixture.mjs';

const boss = { type: 'boss', id: 'boss' };
const frontdesk = { type: 'frontdesk', id: 'f1' };
const newModel = () => confirmedTestSchedules(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T04:00:00.000Z' }));
const input = (changes = {}) => ({ name: '新客户', phone: '13912345678', age: '32', problem: '跑步后膝部不适，希望先做评估', storeId: 'a', requestId: 'intake-request-1', ...changes });
const snapshot = model => JSON.stringify({ state: model.state, sequence: model.sequence });
function rejectsUnchanged(model, run, pattern) {
  const before = snapshot(model); assert.throws(run, pattern); assert.equal(snapshot(model), before, '失败不能新增档案、套餐、收款、评估、审计或序列');
}
function api(model, name) { assert.equal(typeof model[name], 'function', `缺少接待 API ${name}`); return model[name].bind(model); }
const cashAndWork = model => structuredClone({ packages: model.state.packages, receipts: model.state.receipts, refunds: model.state.refunds, services: model.state.services, appointments: model.state.appointments, tasks: model.state.tasks, assessments: model.state.assessments });

test('basic new-client intake accepts an omitted or blank problem without creating charges or professional assessment', () => {
  for (const problem of [undefined, null, '', '   ']) {
    const model = newModel(), beforeWork = cashAndWork(model);
    const payload = input({ problem });
    if (problem === undefined) delete payload.problem;
    const client = model.createReceptionClient(payload, frontdesk);
    assert.equal(client.problem, '');
    assert.equal(client.name, '新客户'); assert.equal(client.age, 32); assert.equal(client.phone, '13912345678');
    assert.equal(client.storeId, 'a'); assert.equal(client.ownerId, '');
    assert.deepEqual(cashAndWork(model), beforeWork);
    assert.equal(model.visibleClients(frontdesk).find(row => row.id === client.id).problem, '');
    assert.equal(model.createReceptionClient({ ...payload, problem: '' }, frontdesk).id, client.id, 'repeated basic intake is still idempotent');
  }
});

test('front desk creates a basic unbilled client and an assigned therapist can book the first assessment', () => {
  const model = newModel(), beforeWork = cashAndWork(model), create = api(model, 'createReceptionClient');
  const client = create(input(), frontdesk);
  assert.equal(model.state.clients.length, 7); assert.equal(client.name, '新客户'); assert.equal(client.age, 32);
  assert.equal(client.problem, '跑步后膝部不适，希望先做评估'); assert.equal(client.phone, '13912345678');
  assert.equal(client.storeId, 'a'); assert.equal(client.ownerId, ''); assert.equal(client.packageId, null);
  assert.equal(client.createdBy, 'f1'); assert.equal(client.createdRole, 'frontdesk'); assert.equal(client.createdAt, '2026-10-09T04:00:00.000Z');
  assert.equal(client.progress.status, 'pending'); assert.match(client.phase, /待.*评估/); assert.match(client.nextStep, /评估/);
  assert.deepEqual(cashAndWork(model), beforeWork, '接待登记不应办理套餐、收款、消课或生成评估结果');
  assert.equal(model.remaining(client.id), 0); assert.equal(model.remainingInStore(client.id, 'a'), 0); assert.deepEqual(model.availablePackages(client.id), []);
  assert.equal(model.canSeeClient(frontdesk, client.id), true); assert.equal(model.canSeeClient({ type: 'therapist', id: 't1' }, client.id), false);
  assert.equal(model.canSeeClient({ type: 'frontdesk', id: 'f2' }, client.id), false); assert.equal(model.canSeeClient({ type: 'therapist', id: 't3' }, client.id), false);
  model.transferClient(client.id,'t1','独立分配客户负责人',boss);
  const appointment = model.saveAppointment({ clientId: client.id, storeId: 'a', date: '2026-10-09', time: '10:30', principalId: 't1', project: '首次评估' }, frontdesk);
  assert.equal(appointment.status, 'confirmed'); assert.equal(appointment.clientId, client.id); assert.equal(model.remaining(client.id), 0);
});

test('first later boss-issued store card becomes the current card without inventing a receipt', () => {
  const model = newModel(), client = api(model, 'createReceptionClient')(input(), frontdesk);
  const moneyBefore = structuredClone([model.state.receipts, model.state.refunds, model.state.services]);
  const card = model.createStorePackage({ clientId: client.id, storeId: 'a', name: '本店康复套餐', amount: '25200', total: '60', requestId: 'intake-card-1' }, boss);
  assert.equal(card.status, 'current'); assert.equal(model.state.clients.find(row => row.id === client.id).packageId, card.id);
  assert.equal(model.remaining(client.id), 60); assert.equal(model.remainingInStore(client.id, 'a'), 60); assert.equal(model.remainingInStore(client.id, 'b'), 0);
  assert.deepEqual([model.state.receipts, model.state.refunds, model.state.services], moneyBefore);
  rejectsUnchanged(model, () => model.createStorePackage({ clientId: client.id, storeId: 'a', name: '本店康复套餐', amount: '3000', total: '10', requestId: 'intake-frontdesk-card' }, frontdesk), /老板|权限/);
});

test('no-card reads are zero but an invalid package reference remains an error', () => {
  const model = newModel(); model.state.clients.push({ id: 'c-no-card', name: '无卡客户', ownerId: 't1', storeId: 'a', packageId: null });
  assert.equal(model.remaining('c-no-card'), 0); assert.equal(model.remainingInStore('c-no-card', 'a'), 0);
  assert.throws(() => model.remaining('missing'), /客户/); assert.throws(() => model.packageRemaining(null), /套餐/);
  model.state.clients.find(row => row.id === 'c-no-card').packageId = 'nonexistent-card'; assert.throws(() => model.remaining('c-no-card'), /套餐/);
});

test('replayed reception submissions are identical and a changed payload cannot reuse a request', () => {
  const model = newModel(), create = api(model, 'createReceptionClient');
  const client = create(input({ name: ' 新客户 ', phone: '139 1234 5678', age: '032', problem: ' 跑步后膝部不适，希望先做评估 ' }), frontdesk), before = snapshot(model);
  assert.equal(create(input(), frontdesk).id, client.id); assert.equal(snapshot(model), before);
  for (const change of [{ name: '另一个客户' }, { phone: '13912345679' }, { age: 33 }, { problem: '不同问题' }, { assessorId: 'other' }]) {
    rejectsUnchanged(model, () => create(input(change), frontdesk), /提交|内容|变化|评估/);
  }
});

test('same phone cannot create a second file in the same or another store with another actor', () => {
  const model = newModel(), create = api(model, 'createReceptionClient');
  create(input(), frontdesk);
  rejectsUnchanged(model, () => create(input({ requestId: 'intake-request-2' }), frontdesk), /手机号|已存在|重复/);
  rejectsUnchanged(model, () => create(input({ storeId: 'b', requestId: 'intake-request-3' }), { type: 'frontdesk', id: 'f2' }), /手机号|已存在|重复/);
  rejectsUnchanged(model, () => create(input({ phone: '13800000002', requestId: 'intake-existing-client' }), frontdesk), /手机号|已存在|重复/);
});

test('phone checks reveal only authorized basic fields and never expose another store client identity', () => {
  const model = newModel(), check = api(model, 'findReceptionDuplicates');
  const local = check('138 0000 0003', frontdesk);
  assert.equal(local.duplicate, true); assert.equal(local.clients.length, 1); assert.equal(local.clients[0].id, 'c3'); assert.equal(local.clients[0].name, '周沐');
  assert.deepEqual(Object.keys(local.clients[0]).sort(), ['id', 'name', 'ownerId', 'phone', 'storeId']);
  assert.equal('goal' in local.clients[0], false); assert.equal('progress' in local.clients[0], false); assert.equal('packageId' in local.clients[0], false);
  assert.deepEqual(check('13800000002', frontdesk), { duplicate: true, clients: [] });
  assert.deepEqual(check('13900000000', frontdesk), { duplicate: false, clients: [] });
  assert.equal(check('13800000002', boss).clients[0].id, 'c2');
  local.clients[0].name = '篡改返回值'; assert.equal(model.state.clients.find(client => client.id === 'c3').name, '周沐');
});

test('reception projections retain age and the customer-stated problem without clinical details', () => {
  const model = newModel(), client = api(model, 'createReceptionClient')(input(), frontdesk);
  const visible = model.visibleClients(frontdesk).find(row => row.id === client.id);
  assert.equal(visible.age, 32); assert.equal(visible.problem, '跑步后膝部不适，希望先做评估');
  assert.equal('goal' in visible, false); assert.equal('progress' in visible, false); assert.equal('planNotes' in visible, false);
  const found = api(model, 'findReceptionDuplicates')(client.phone, frontdesk).clients[0];
  assert.equal(found.age, 32); assert.equal(found.problem, '跑步后膝部不适，希望先做评估'); assert.equal('receptionInputKey' in found, false);
});

test('forged, missing and customer actors cannot create or check clients', () => {
  const model = newModel(), create = api(model, 'createReceptionClient'), check = api(model, 'findReceptionDuplicates');
  for (const role of [null, { type: 'boss', id: 'forged' }, { type: 'frontdesk', id: 'missing' }, { type: 'therapist', id: 'missing' }, { type: 'manager', id: 'missing' }, { type: 'customer', id: 'c1' }, { type: 'manager', id: 't1' }, { type: 'therapist', id: 'm1' }]) {
    rejectsUnchanged(model, () => create(input(), role), /权限|老板|前台|停用|在职|康复师|店长/);
    rejectsUnchanged(model, () => check('13800000001', role), /权限|老板|前台|停用|在职|康复师|店长/);
  }
  model.state.frontDesks.find(row => row.id === 'f1').active = false;
  rejectsUnchanged(model, () => create(input(), frontdesk), /权限|停用/); rejectsUnchanged(model, () => check('13800000001', frontdesk), /权限|停用/);
});

test('intake authorization resolves actual role records and excludes stopped stores', () => {
  const model = newModel(), stores = api(model, 'receptionStoreIds');
  assert.deepEqual(stores(boss), ['a', 'b']);
  assert.deepEqual(stores({ type: 'manager', id: 'm1', storeId: 'b', storeIds: ['b'] }), ['a']);
  assert.deepEqual(stores({ type: 'manager', id: 'm2' }), ['b']);
  assert.deepEqual(stores({ type: 'therapist', id: 't1', storeId: 'b', storeIds: ['b'] }), ['a']);
  assert.deepEqual(stores({ type: 'therapist', id: 't2' }), ['b']);
  assert.deepEqual(stores(frontdesk), ['a']);
  const list = stores(frontdesk); list.push('b'); assert.deepEqual(stores(frontdesk), ['a']);
  model.state.frontDesks.find(row => row.id === 'f1').storeIds.push('b');
  assert.deepEqual(stores(frontdesk), ['a', 'b']);
  model.state.stores.find(row => row.id === 'a').active = false;
  assert.deepEqual(stores(boss), ['b']); assert.deepEqual(stores(frontdesk), ['b']);
  assert.deepEqual(stores({ type: 'manager', id: 'm1' }), []);
  assert.deepEqual(stores({ type: 'therapist', id: 't1' }), []);
});

test('both store managers inspect boss-created local files but all booking and financial writes remain read-only',()=>{
 for(const [id,storeId] of [['m1','a'],['m2','b']]){
 const model=newModel(),role={type:'manager',id},beforeWork=cashAndWork(model);
 rejectsUnchanged(model,()=>model.createReceptionClient(input({storeId}),role),/监管|查看/);
 const client=model.createReceptionClient(input({storeId}),boss);assert.equal(client.ownerId,'');assert.equal(client.assessorId,'tao');assert.deepEqual(cashAndWork(model),beforeWork);
 assert.equal(model.canSeeClient(role,client.id),true);assert.ok(model.managerSnapshot(role).clients.some(c=>c.id===client.id));
 rejectsUnchanged(model,()=>model.saveAppointment({clientId:client.id,storeId,date:'2026-10-10',time:'12:30',principalId:'t1',project:'预约'},role),/负责|授权|本店/);
 rejectsUnchanged(model,()=>model.createStorePackage({clientId:client.id,storeId,name:'套餐',amount:'3000',total:10,requestId:'card'},role),/权限|老板/);
 }
});

test('therapist intake is store-bound and unassigned; customer responsibility requires a separate boss assignment',()=>{
 for(const [id,storeId,otherStore] of [['t1','a','b'],['t2','b','a']]){
 const model=newModel(),role={type:'therapist',id},client=model.createReceptionClient(input({storeId}),role);
 assert.equal(client.ownerId,'');assert.equal(client.assessorId,'tao');assert.equal(model.canSeeClient(role,client.id),false);
 rejectsUnchanged(model,()=>model.createReceptionClient(input({phone:'13912345679',storeId:otherStore,requestId:'foreign'}),role),/门店|权限/);
 model.transferClient(client.id,id,'独立客户负责人分配',boss);assert.equal(model.canSeeClient(role,client.id),true);assert.equal(model._client(client.id).assessorId,'tao');
 }
});

test('new intake roles keep duplicate identity scoped to canSeeClient and expose basic fields only', () => {
  const model = newModel(), check = api(model, 'findReceptionDuplicates');
  for (const [role, visiblePhone, visibleId, hiddenPhone] of [
    [{ type: 'manager', id: 'm1' }, '13800000003', 'c3', '13800000002'],
    [{ type: 'therapist', id: 't1' }, '13800000003', 'c3', '13800000005'],
  ]) {
    const result = check(visiblePhone, role); assert.equal(result.duplicate, true); assert.equal(result.clients[0].id, visibleId);
    assert.deepEqual(Object.keys(result.clients[0]).sort(), ['id', 'name', 'ownerId', 'phone', 'storeId']);
    assert.deepEqual(check(hiddenPhone, role), { duplicate: true, clients: [] });
    rejectsUnchanged(model, () => model.createReceptionClient(input({ phone: hiddenPhone, requestId: `blocked-${role.type}` }), role), role.type === 'manager' ? /权限|监管|查看/ : /手机号|已存在|重复/);
  }
});

test('stopped employees and stopped home stores cannot check or create intake records', () => {
  for (const [collection, id, type] of [['storeManagers', 'm1', 'manager'], ['therapists', 't1', 'therapist'], ['frontDesks', 'f1', 'frontdesk']]) {
    const model = newModel(), role = { type, id }, create = api(model, 'createReceptionClient'), check = api(model, 'findReceptionDuplicates'), stores = api(model, 'receptionStoreIds');
    model.state[collection].find(row => row.id === id).active = false;
    rejectsUnchanged(model, () => create(input(), role), /权限|停用|在职|店长|康复师/);
    rejectsUnchanged(model, () => check('13800000003', role), /权限|停用|在职|店长|康复师/);
    rejectsUnchanged(model, () => stores(role), /权限|停用|在职|店长|康复师/);
    model.state[collection].find(row => row.id === id).active = true; model.state.stores.find(row => row.id === 'a').active = false;
    assert.deepEqual(stores(role), []);
    rejectsUnchanged(model, () => create(input(), role), /门店|停用|权限/);
    rejectsUnchanged(model, () => check('13800000003', role), /门店|停用|权限/);
  }
});

test('authorized front desk and therapist submissions retain replay guarantees', () => {
  for (const role of [frontdesk, { type: 'therapist', id: 't1' }]) {
    const model = newModel(), create = api(model, 'createReceptionClient'), client = create(input(), role), before = snapshot(model);
    assert.equal(create(input(), role).id, client.id); assert.equal(snapshot(model), before);
    rejectsUnchanged(model, () => create(input({ age: '33' }), role), /提交|内容|变化|评估/);
  }
});

test('create rejects unauthorized or stopped stores and forged responsibility or assessment selection',()=>{
 const model=newModel();rejectsUnchanged(model,()=>model.createReceptionClient(input({storeId:'b'}),frontdesk),/门店|权限/);
 for(const change of [{ownerId:'t1'},{ownerId:'t2'},{ownerId:'missing'},{assessorId:'t1'}])rejectsUnchanged(model,()=>model.createReceptionClient(input(change),frontdesk),/预约|评估|人员/);
 model.state.stores.find(s=>s.id==='a').active=false;rejectsUnchanged(model,()=>model.createReceptionClient(input(),boss),/门店|停用/);
});

test('reception validates required basic fields and integer ages before any state is changed', () => {
  const model = newModel(), create = api(model, 'createReceptionClient'), check = api(model, 'findReceptionDuplicates');
  for (const change of [{ name: '' }, { name: '长'.repeat(81) }, { phone: '' }, { phone: '1234' }, { phone: 13912345678 }, { phone: '23912345678' }, { age: '' }, { age: '-1' }, { age: '32.5' }, { age: 121 }, { age: null }, { problem: 123 }, { problem: '长'.repeat(1001) }, { storeId: '' }, { storeId: 'missing' }, { requestId: '' }]) {
    rejectsUnchanged(model, () => create(input(change), frontdesk));
  }
  for (const phone of ['', '123', 13912345678, null]) rejectsUnchanged(model, () => check(phone, frontdesk), /手机号/);
  const zero = create(input({ age: 0, requestId: 'age-zero' }), frontdesk); assert.equal(zero.age, 0);
  const old = create(input({ age: 120, phone: '13912345679', requestId: 'age-120' }), frontdesk); assert.equal(old.age, 120);
});

test('boss can create a client in either active store and multi-store front desk remains restricted to its authorized stores', () => {
  const model = newModel(), create = api(model, 'createReceptionClient');
  const client = create(input({ storeId: 'b' }), boss); assert.equal(client.storeId, 'b'); assert.equal(client.createdBy, 'boss');
  model.state.frontDesks.find(row => row.id === 'f1').storeIds.push('b');
  const other = create(input({ phone: '13912345679', storeId: 'b', requestId: 'multi-store-intake' }), frontdesk); assert.equal(other.ownerId, '');
});

test('invalid server clock makes a reception write fail atomically and the same request can then be retried', () => {
  const model = newModel(), create = api(model, 'createReceptionClient'); model.now = () => 'bad-clock';
  rejectsUnchanged(model, () => create(input(), frontdesk), /时钟|时间/);
  model.now = () => '2026-10-09T04:00:00.000Z'; const client = create(input(), frontdesk);
  assert.equal(client.phone, '13912345678'); assert.equal(model.state.clients.length, 7); assert.equal(model.state.audit.length, 1);
});
