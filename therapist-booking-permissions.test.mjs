import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './legacy-test-fixture.mjs';
import { confirmedTestSchedules } from './scheduling-test-fixture.mjs';
import {
  ensureCustomerBooking, requestCustomerBooking, customerBookingRows,
  customerBookingConfirmation, confirmCustomerBooking, cancelCustomerBooking,
} from './customer-booking.js';

const boss = { type: 'boss', id: 'boss' };
const therapist = id => ({ type: 'therapist', id });
const snapshot = model => JSON.stringify({ state: model.state, sequence: model.sequence });
const ready = () => {
  const model = confirmedTestSchedules(new DemoModel({ today: '2026-10-09', now: () => '2026-10-09T04:00:00.000Z' }));
  ensureCustomerBooking(model);
  return model;
};
function request(model, clientId = 'c1', extra = {}) {
  const client = model._client(clientId);
  return requestCustomerBooking(model, {
    storeId: client.storeId, date: '2026-10-12', time: '14:30', principalId: client.ownerId,
    project: '阶段复评与训练', requestId: `booking-permission-${clientId}`, ...extra,
  }, { type: 'customer', id: clientId });
}
function rejectUnchanged(model, action, pattern) {
  const before = snapshot(model);
  assert.throws(action, pattern);
  assert.equal(snapshot(model), before, '拒绝操作不能改变申请、预约、人员、客户、审计或序列');
}

test('all active therapists read basic requests while clinical visibility stays scoped',()=>{const model=ready(),rows=[request(model),request(model,'c2'),request(model,'c3'),request(model,'c5')],before=snapshot(model);for(const id of ['t1','t2','t3','t4','t5'])assert.deepEqual(customerBookingRows(model,therapist(id)).map(r=>r.id),rows.map(r=>r.id));assert.equal(model.canSeeClient(therapist('t4'),'c1'),false);assert.equal(snapshot(model),before);});

test('valid participants read pending, confirmed and cancelled content without obtaining confirmation or cancellation powers', () => {
  for (const end of ['pending', 'confirmed', 'cancelled']) {
    const model = ready(), row = request(model);
    if (end === 'confirmed') confirmCustomerBooking(model, row.id, boss);
    if (end === 'cancelled') cancelCustomerBooking(model, row.id, { type: 'customer', id: 'c1' });
    const participant = therapist('t3'), before = snapshot(model);
    const [visible] = customerBookingRows(model, participant);
    assert.ok(visible, '有效服务协作人员应能读取相关客户的预约内容');
    assert.equal(visible.id, row.id); assert.equal(visible.status, end);
    assert.deepEqual([visible.clientId, visible.storeId, visible.date, visible.time, visible.project, visible.principalId],
      ['c1', 'a', '2026-10-12', '14:30', '阶段复评与训练', 't1']);
    assert.equal(customerBookingConfirmation(model,row.id,participant).canConfirm,end==='pending');
    assert.equal(snapshot(model), before, '查询权限提示也不能写入业务状态');
    if(end==='pending')assert.equal(confirmCustomerBooking(model,row.id,participant).confirmedBy,'t3');else if(end==='cancelled')rejectUnchanged(model,()=>confirmCustomerBooking(model,row.id,participant),/取消|处理/);
    rejectUnchanged(model, () => cancelCustomerBooking(model, row.id, participant), /本人|客户|取消/);
  }
});

test('the responsible therapist retains existing owner-only confirmation authority', () => {
  const model = ready(), row = request(model), owner = therapist('t1');
  const before = snapshot(model);
  assert.equal(customerBookingConfirmation(model, row.id, owner).canConfirm, true);
  assert.equal(snapshot(model), before);
  const confirmed = confirmCustomerBooking(model, row.id, owner);
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.confirmedBy, 't1');
  assert.equal(confirmed.confirmedRole, 'therapist');
});

test('disabled, missing and forged therapist identities cannot read booking requests or confirmation hints', () => {
  const model = ready(), row = request(model);
  model.state.therapists.find(person => person.id === 't3').active = false;
  for (const role of [therapist('t3'), therapist('missing'), therapist('boss'), { type: 'boss', id: 't1' }, null]) {
    rejectUnchanged(model, () => customerBookingRows(model, role), /权限|在职|停用|不存在/);
    rejectUnchanged(model, () => customerBookingConfirmation(model, row.id, role), /权限|在职|停用|不存在/);
  }
});

test('revoking the only valid service immediately removes past participant read access', () => {
  const model = ready(), row = request(model), participant = therapist('t3');
  assert.equal(customerBookingRows(model, participant)[0]?.id, row.id);
  model.revokeService('s1', '虚构服务误登记，撤销后重新核对', boss);
  const before = snapshot(model);
  assert.equal(customerBookingRows(model,participant)[0]?.id,row.id);assert.equal(model.canSeeClient(participant,'c1'),false);
  assert.equal(customerBookingRows(model,therapist('t2'))[0]?.id,row.id);
  assert.equal(customerBookingRows(model, therapist('t1'))[0]?.id, row.id, '负责人权限保留');
  assert.equal(customerBookingConfirmation(model,row.id,participant).canConfirm,true);
  assert.equal(snapshot(model), before, '不能凭撤销的协作记录继续获得客户预约访问权');
});

test('client handover changes booking read access immediately without rewriting the original booking', () => {
  const model = ready(), row = request(model, 'c3');
  assert.equal(customerBookingRows(model, therapist('t1'))[0]?.id, row.id);
  assert.equal(customerBookingRows(model,therapist('t3'))[0]?.id,row.id);
  const original = structuredClone(model.state.bookingRequests[0]);
  model.transferClient('c3', 't3', '虚构客户交接，由苏晴继续负责', boss);
  const before = snapshot(model);
  assert.equal(customerBookingRows(model,therapist('t1'))[0]?.id,row.id);assert.equal(model.canSeeClient(therapist('t1'),'c3'),false);
  assert.equal(customerBookingRows(model, therapist('t3'))[0]?.id, row.id);
  assert.deepEqual(model.state.bookingRequests[0], original, '预约的主康复师和历史身份不随交接被改写');
  assert.equal(snapshot(model), before);
});

test('participant projections omit retry metadata and arbitrary private fields and cannot mutate the source', () => {
  const model = ready(), row = request(model);
  request(model, 'c1', { requestId: 'hidden-retry-alias' });
  Object.assign(model.state.bookingRequests[0], { privateAssessment: '仅内部测试的评估附件', privateRating: '仅老板可见评价', arbitrary: { internal: true } });
  const before = snapshot(model);
  const [visible] = customerBookingRows(model, therapist('t3'));
  assert.equal(visible?.id, row.id);
  for (const field of ['requestId', 'inputKey', 'requestAliases', 'privateAssessment', 'privateRating', 'arbitrary'])
    assert.equal(Object.hasOwn(visible, field), false, `${field} 不应进入预约只读投影`);
  visible.status = 'cancelled'; visible.project = '篡改显示结果';
  assert.equal(snapshot(model), before, '读结果与内部记录没有共享可写引用');
  assert.equal(customerBookingConfirmation(model,row.id,therapist('t4')).canConfirm,true);
});
