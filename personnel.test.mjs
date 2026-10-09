import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import { ensureSchedules } from './schedules.js';

const boss = { type: 'boss', id: 'boss' };
const fresh = () => new DemoModel({ now: () => '2026-10-08T09:00:00.000Z' });
const snapshot = model => JSON.stringify({ state: model.state, sequence: model.sequence });
const edit = (row, values = {}) => ({ id: row.id, name: row.name, phone: row.phone || '', notes: row.notes || '', storeId: row.storeId, storeIds: row.storeIds, active: row.active, expectedVersion: row.profileVersion || 0, reason: '老板核对人员资料', requestId: `edit-${row.id}`, ...values });
const staffKinds = [
  ['Therapist', 'therapists', 't3', { name: '新康复师', storeId: 'a' }],
  ['FrontDesk', 'frontDesks', 'f1', { name: '新前台', storeIds: ['a'] }],
  ['StoreManager', 'storeManagers', 'm1', { name: '新店长', storeId: 'a' }],
];

test('老板可录入三类人员的姓名、电话、门店和备注，其他数据不变', () => {
  const model = fresh(), history = JSON.stringify([model.state.clients, model.state.services, model.state.appointments, model.state.tasks]);
  for (const [kind, collection, , input] of staffKinds) {
    const row = model[`add${kind}`]({ ...input, phone: `1390000000${staffKinds.findIndex(item => item[0] === kind) + 1}`, notes: '老板手工录入', requestId: `new-${kind}` }, boss);
    assert.equal(row.phone.startsWith('139'), true); assert.equal(row.notes, '老板手工录入');
    assert.equal(row.profileVersion, 1); assert.equal(row.active, true);
    assert.equal(model.state[collection].some(item => item.id === row.id), true);
  }
  assert.equal(JSON.stringify([model.state.clients, model.state.services, model.state.appointments, model.state.tasks]), history);
});

test('老板可编辑三类人员，人员ID和角色不变，每次记录改前改后', () => {
  const model = fresh(), history = JSON.stringify([model.state.clients, model.state.services, model.state.appointments, model.state.tasks]);
  for (const [kind, collection, id] of staffKinds) {
    const original = structuredClone(model.state[collection].find(row => row.id === id));
    const row = model[`update${kind}`](edit(original, { name: `${original.name}更新`, phone: `1381111111${staffKinds.findIndex(item => item[0] === kind) + 1}`, notes: '更新备注', role: 'boss', permissions: ['all'] }), boss);
    assert.equal(row.id, id); assert.equal(row.name, `${original.name}更新`); assert.equal(row.profileVersion, 1);
    assert.equal(row.role, undefined); assert.equal(row.permissions, undefined);
    assert.equal(model.state[collection].find(item => item.id === id).phone, row.phone);
    const audit = model.state.audit.find(item => item.type.endsWith('_updated') && item.after.id === id);
    assert.deepEqual(audit.before, original); assert.deepEqual(audit.after, row);
    assert.equal(audit.actorId, 'boss'); assert.equal(audit.reason, '老板核对人员资料');
  }
  assert.equal(JSON.stringify([model.state.clients, model.state.services, model.state.appointments, model.state.tasks]), history);
});

test('仅真实老板可新增或编辑人员，拒绝后数据与ID序列都不改变', () => {
  const model = fresh(), before = snapshot(model);
  for (const role of [{ type: 'boss', id: 'm1' }, { type: 'manager', id: 'm1' }, { type: 'frontdesk', id: 'f1' }, { type: 'therapist', id: 't1' }, { type: 'customer', id: 'c1' }, null]) {
    for (const [kind, collection, id, input] of staffKinds) {
      assert.throws(() => model[`update${kind}`](edit(model.state[collection].find(row => row.id === id)), role), /老板|权限/);
      assert.throws(() => model[`add${kind}`](input, role), /老板|权限/);
      assert.equal(snapshot(model), before);
    }
  }
});

test('编辑姓名、手机号、备注、版本、原因和提交标识均验证，错误不消耗ID', () => {
  const model = fresh(), original = model.state.frontDesks[0], before = snapshot(model);
  for (const invalid of [{ name: '' }, { name: '字'.repeat(81) }, { phone: '123' }, { phone: '12800000000' }, { notes: '字'.repeat(501) }, { expectedVersion: -1 }, { expectedVersion: undefined }, { reason: '' }, { reason: '字'.repeat(501) }, { requestId: '' }, { active: 'maybe' }, { storeIds: [] }, { storeIds: ['missing'] }, { storeIds: ['a', 'a'] }]) {
    assert.throws(() => model.updateFrontDesk(edit(original, invalid), boss)); assert.equal(snapshot(model), before);
  }
});

test('新增人员验证先于ID写入和审计时间，不能创建无效人员', () => {
  const model = fresh(), before = snapshot(model);
  for (const [kind, , , input] of staffKinds) {
    for (const invalid of [{ name: '' }, { name: '字'.repeat(81) }, { phone: '132' }, { notes: '字'.repeat(501) }, { active: false }, kind === 'FrontDesk' ? { storeIds: ['missing'] } : { storeId: 'missing' }]) {
      assert.throws(() => model[`add${kind}`]({ ...input, ...invalid }, boss)); assert.equal(snapshot(model), before);
    }
  }
});

test('人员手机号跨三类唯一，空手机号兼容旧数据', () => {
  const model = fresh(); model.addTherapist({ name: '电话所有者', storeId: 'a', phone: '13912345678' }, boss);
  const before = snapshot(model);
  assert.throws(() => model.addFrontDesk({ name: '重复', storeIds: ['a'], phone: '13912345678' }, boss), /手机号|重复|使用/);
  assert.throws(() => model.updateStoreManager(edit(model.state.storeManagers[0], { phone: '13912345678' }), boss), /手机号|重复|使用/);
  assert.equal(snapshot(model), before);
  assert.equal(model.addFrontDesk({ name: '不填电话', storeIds: ['a'] }, boss).phone, '');
});

test('历史人员ID不会被新人员覆盖，同ID的跨角色资料也不能绕过电话重复校验', () => {
  const model = fresh(); model.state.frontDesks.push({ id: 'f101', name: '旧前台', storeIds: ['a'], active: true });
  const old = structuredClone(model.state.frontDesks.find(row => row.id === 'f101'));
  const added = model.addFrontDesk({ name: '新前台', storeIds: ['a'] }, boss);
  assert.notEqual(added.id, 'f101'); assert.deepEqual(model.state.frontDesks.find(row => row.id === 'f101'), old);
  model.state.frontDesks.push({ id: 't3', name: '不同角色旧人员', storeIds: ['a'], active: true, phone: '13912345678' });
  const before = snapshot(model);
  assert.throws(() => model.updateTherapist(edit(model.state.therapists.find(row => row.id === 't3'), { phone: '13912345678' }), boss), /手机号|重复|使用/);
  assert.equal(snapshot(model), before);
});

test('编辑重放只更新一次，变更提交内容或目标不得复用token', () => {
  const model = fresh(), original = model.state.frontDesks[0], data = edit(original, { name: '接待小张' });
  const first = model.updateFrontDesk(data, boss), after = snapshot(model);
  assert.deepEqual(model.updateFrontDesk(data, boss), first); assert.equal(snapshot(model), after);
  assert.throws(() => model.updateFrontDesk({ ...data, name: '不同内容' }, boss), /提交|重复|变化/);
  assert.throws(() => model.updateFrontDesk({ ...data, id: 'f2' }, boss), /提交|重复|变化/);
  assert.equal(snapshot(model), after);
});

test('新增带token防止重复建人，旧调用兼容无token', () => {
  const model = fresh(), data = { name: '新店長', storeId: 'b', requestId: 'new-manager' };
  const first = model.addStoreManager(data, boss), after = snapshot(model);
  assert.deepEqual(model.addStoreManager(data, boss), first); assert.equal(snapshot(model), after);
  assert.throws(() => model.addStoreManager({ ...data, name: '另一人' }, boss), /提交|重复|变化/);
  assert.equal(snapshot(model), after);
  assert.ok(model.addStoreManager({ name: '兼容录入', storeId: 'a' }, boss).id);
});

test('陈旧版本或缺失人员不能覆盖最新资料', () => {
  const model = fresh(), original = model.state.storeManagers[0], data = edit(original, { name: '新名字' });
  model.updateStoreManager(data, boss); const before = snapshot(model);
  assert.throws(() => model.updateStoreManager({ ...data, requestId: 'another' }, boss), /版本|更新|重新/);
  assert.throws(() => model.updateStoreManager({ ...data, id: 'missing', requestId: 'unknown' }, boss), /不存在|人员/);
  assert.equal(snapshot(model), before);
});

test('前台门店权限修改立即生效，历史收款和服务门店不变', () => {
  const model = fresh(), original = model.state.frontDesks[0];
  model.state.receipts.push({ id: 'history-receipt', recordedBy: 'f1', storeId: 'a', amount: 100 });
  const history = JSON.stringify([model.state.receipts, model.state.services]);
  model.updateFrontDesk(edit(original, { storeIds: ['b'] }), boss);
  assert.deepEqual(model.frontDeskStoreIds({ type: 'frontdesk', id: 'f1' }), ['b']);
  assert.equal(JSON.stringify([model.state.receipts, model.state.services]), history);
});

test('店长所属门店修改立即生效，历史记录和排班不自动移动', () => {
  const model = fresh(); ensureSchedules(model); const history = JSON.stringify([model.state.services, model.state.staffSchedules]);
  model.updateStoreManager(edit(model.state.storeManagers[0], { storeId: 'b' }), boss);
  assert.equal(model.managerStoreId({ type: 'manager', id: 'm1' }), 'b');
  assert.equal(JSON.stringify([model.state.services, model.state.staffSchedules]), history);
});

test('康复师换店先处理负责客户、待办、预约和未来工作排班', () => {
  const cases = [
    model => model.state.clients.push({ id: 'operational', ownerId: 't3' }),
    model => model.state.tasks.push({ id: 'operational', assigneeId: 't3', status: 'pending' }),
    model => model.state.appointments.push({ id: 'operational', principalId: 't3', date: model.today, status: 'confirmed' }),
    model => model.state.appointments.push({ id: 'operational', principalId: 't1', participantIds: ['t3'], date: model.today, status: 'confirmed' }),
    model => ensureSchedules(model),
  ];
  for (const setup of cases) {
    const model = fresh(); setup(model); const before = snapshot(model);
    assert.throws(() => model.updateTherapist(edit(model.state.therapists.find(row => row.id === 't3'), { storeId: 'b' }), boss), /客户|待办|预约|排班/);
    assert.equal(snapshot(model), before);
  }
});

test('无未完成工作的康复师可换店，过去排班、休息和历史服务保留', () => {
  const model = fresh(); model.state.staffSchedules = [{ id: 'past', therapistId: 't3', storeId: 'a', date: '2026-10-07', status: 'work' }, { id: 'rest', therapistId: 't3', storeId: 'a', date: model.today, status: 'rest' }];
  const history = JSON.stringify([model.state.services, model.state.staffSchedules]);
  const row = model.updateTherapist(edit(model.state.therapists.find(row => row.id === 't3'), { storeId: 'b' }), boss);
  assert.equal(row.storeId, 'b'); assert.equal(JSON.stringify([model.state.services, model.state.staffSchedules]), history);
});

test('康复师停用保留历史，客户/待办/协作预约阻止停用，两入口一致', () => {
  const cases = [
    model => model.state.clients.push({ id: 'operational', ownerId: 't3' }),
    model => model.state.tasks.push({ id: 'operational', assigneeId: 't3', status: 'pending' }),
    model => model.state.appointments.push({ id: 'operational', principalId: 't1', participantIds: ['t3'], status: 'confirmed' }),
  ];
  for (const setup of cases) {
    const model = fresh(); setup(model); const before = snapshot(model);
    assert.throws(() => model.updateTherapist(edit(model.state.therapists.find(row => row.id === 't3'), { active: false }), boss), /客户|待办|预约/);
    assert.throws(() => model.deactivateTherapist('t3', boss), /客户|待办|预约/); assert.equal(snapshot(model), before);
  }
  const model = fresh(); ensureSchedules(model); const history = JSON.stringify([model.state.services, model.state.staffSchedules]);
  model.updateTherapist(edit(model.state.therapists.find(row => row.id === 't3'), { active: 'false' }), boss);
  assert.equal(model.state.therapists.find(row => row.id === 't3').active, false);
  assert.equal(JSON.stringify([model.state.services, model.state.staffSchedules]), history);
});

test('停用与重新启用三类账号，修改版本且权限即时更新', () => {
  const model = fresh();
  for (const [kind, collection, id] of staffKinds) {
    model[`deactivate${kind}`](id, boss);
    const row = model.state[collection].find(item => item.id === id);
    assert.equal(row.profileVersion, 1); assert.equal(row.active, false);
    model[`update${kind}`](edit(row, { active: 'true', requestId: `reactivate-${id}` }), boss);
    assert.equal(model.state[collection].find(item => item.id === id).profileVersion, 2);
    assert.equal(model.state[collection].find(item => item.id === id).active, true);
  }
});

test('新门店必须在营业，重新启用不能恢复停用门店权限', () => {
  const model = fresh(); model.state.stores.find(row => row.id === 'b').active = false;
  const before = snapshot(model);
  for (const [kind, , , input] of staffKinds) assert.throws(() => model[`add${kind}`]({ ...input, ...(kind === 'FrontDesk' ? { storeIds: ['b'] } : { storeId: 'b' }) }, boss), /门店|停用/);
  assert.equal(snapshot(model), before);
  model.deactivateStoreManager('m2', boss); const disabled = model.state.storeManagers.find(row => row.id === 'm2'), stopped = snapshot(model);
  assert.throws(() => model.updateStoreManager(edit(disabled, { active: true }), boss), /门店|停用/); assert.equal(snapshot(model), stopped);
  assert.equal(model.updateStoreManager(edit(disabled, { name: '停用店长资料更正', active: false }), boss).name, '停用店长资料更正');
});

test('时钟故障不会留下半条人员信息、审计或消耗ID', () => {
  const model = fresh(), before = snapshot(model); model.now = () => 'invalid-clock';
  assert.throws(() => model.addFrontDesk({ name: '新前台', storeIds: ['a'] }, boss), /时钟/);
  assert.throws(() => model.updateFrontDesk(edit(model.state.frontDesks[0], { name: '新名字' }), boss), /时钟/);
  assert.throws(() => model.deactivateFrontDesk('f1', boss), /时钟/);
  assert.equal(snapshot(model), before);
});

test('纯文字数据保留，返回数据不能反向改写人员和审计', () => {
  const model = fresh(), row = model.updateFrontDesk(edit(model.state.frontDesks[0], { name: '<img src=x onerror=alert(1)>', notes: '<script>alert(1)</script>' }), boss);
  assert.equal(row.name, '<img src=x onerror=alert(1)>'); const before = snapshot(model); row.name = 'mutated';
  assert.equal(snapshot(model), before);
});
