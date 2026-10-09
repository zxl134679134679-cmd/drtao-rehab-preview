import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
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

test('therapist request readers follow owned clients and valid service participation, not the home store', () => {
  const model = ready();
  const c1 = request(model), c2 = request(model, 'c2'), c3 = request(model, 'c3'), c5 = request(model, 'c5');
  const before = snapshot(model);
  const ids = id => customerBookingRows(model, therapist(id)).map(row => row.id);
  assert.deepEqual(ids('t1'), [c1.id, c3.id], '负责人可查看自己负责客户的预约申请');
  assert.deepEqual(ids('t2'), [c1.id, c2.id], '曾作为实际主康复师服务的客户也可查看，跨店不丢失');
  assert.deepEqual(ids('t3'), [c1.id], '曾参与有效协作服务可查看该客户预约申请');
  assert.deepEqual(ids('t4'), [], '同店但未负责或参与的客户仍不可查看');
  assert.deepEqual(ids('t5'), [c5.id]);
  assert.equal(snapshot(model), before, '读取不改变预约、客户或权限状态');
});

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
    assert.equal(customerBookingConfirmation(model, row.id, participant).canConfirm, false);
    assert.equal(snapshot(model), before, '查询权限提示也不能写入业务状态');
    rejectUnchanged(model, () => confirmCustomerBooking(model, row.id, participant), /负责|权限|只读/);
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
  assert.deepEqual(customerBookingRows(model, participant), []);
  assert.deepEqual(customerBookingRows(model, therapist('t2')), []);
  assert.equal(customerBookingRows(model, therapist('t1'))[0]?.id, row.id, '负责人权限保留');
  rejectUnchanged(model, () => customerBookingConfirmation(model, row.id, participant), /查看|权限/);
  assert.equal(snapshot(model), before, '不能凭撤销的协作记录继续获得客户预约访问权');
});

test('client handover changes booking read access immediately without rewriting the original booking', () => {
  const model = ready(), row = request(model, 'c3');
  assert.equal(customerBookingRows(model, therapist('t1'))[0]?.id, row.id);
  assert.deepEqual(customerBookingRows(model, therapist('t3')), []);
  const original = structuredClone(model.state.bookingRequests[0]);
  model.transferClient('c3', 't3', '虚构客户交接，由苏晴继续负责', boss);
  const before = snapshot(model);
  assert.deepEqual(customerBookingRows(model, therapist('t1')), []);
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
  rejectUnchanged(model, () => customerBookingConfirmation(model, row.id, therapist('t4')), /权限|查看/);
});
