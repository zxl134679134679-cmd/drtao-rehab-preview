import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import * as staff from './staff.js';

const roles = { boss: { type: 'boss', id: 'boss' }, manager: { type: 'manager', id: 'm1' }, frontdesk: { type: 'frontdesk', id: 'f1' }, therapist: { type: 'therapist', id: 't1' }, customer: { type: 'customer', id: 'c1' } };
const context = (model, role = roles.boss) => ({ model, role, view: 'team', filters: {}, icon: () => '' });
const open = (type, id, ctx) => {
  assert.equal(typeof staff.personnelDialog, 'function', 'boss needs editable staff profiles');
  return staff.personnelDialog(type, id, ctx);
};

test('boss personnel page makes all three staff types and edit entries immediately visible', () => {
  const model = new DemoModel(), html = staff.renderStaff(context(model));
  assert.match(html, /<h1>人员管理<\/h1>/);
  for (const role of ['therapist', 'frontdesk', 'manager']) {
    assert.match(html, new RegExp(`data-action="add-${role}"`));
    assert.match(html, new RegExp(`data-action="edit-${role}"`));
  }
  assert.match(html, /手机号/); assert.match(html, /未填写手机号/);
  assert.match(html, /资料和权限由老板维护/);
});

test('each add form collects clear identity, contact and store fields without creating a real login promise', () => {
  const model = new DemoModel();
  for (const [kind, name] of [['therapist', '康复师'], ['frontdesk', '前台'], ['manager', '店长']]) {
    const dialog = open(`add-${kind}`, '', context(model));
    assert.match(dialog.title, new RegExp(name));
    assert.match(dialog.html, new RegExp(`data-form="add-${kind}"`));
    assert.match(dialog.html, /name="name"[^>]*required/);
    assert.match(dialog.html, /name="phone"[^>]*type="tel"[^>]*maxlength="11"/);
    assert.match(dialog.html, /name="notes"[^>]*maxlength="500"/);
    assert.match(dialog.html, /name="active" value="true"/);
    assert.match(dialog.html, new RegExp(`name="${kind === 'frontdesk' ? 'storeIds' : 'storeId'}"`));
    assert.match(dialog.html, /预览.*虚构资料/);
    assert.doesNotMatch(dialog.html, /已开通真实|自动发送登录|手机号即已注册/);
  }
});

test('edit opens active or inactive employee with stable identity, version, status and required reason', () => {
  const model = new DemoModel();
  for (const [kind, collection, id] of [['therapist', 'therapists', 't1'], ['frontdesk', 'frontDesks', 'f1'], ['manager', 'storeManagers', 'm1']]) {
    const person = model.state[collection].find(row => row.id === id);
    person.active = false; person.profileVersion = 7; person.phone = '13899092111'; person.notes = '虚构人员备注';
    const dialog = open(`edit-${kind}`, id, context(model));
    assert.match(dialog.html, new RegExp(`name="id" value="${id}"`));
    assert.match(dialog.html, /name="expectedVersion" value="7"/);
    assert.match(dialog.html, /name="phone"[^>]*value="13899092111"/);
    assert.match(dialog.html, /value="false" selected/);
    assert.match(dialog.html, /name="reason"[^>]*required[^>]*maxlength="500"/);
    assert.match(dialog.html, /虚构人员备注/); assert.match(dialog.html, /历史服务/);
    assert.match(staff.renderStaff(context(model)), new RegExp(`data-action="edit-${kind}" data-id="${id}"`));
  }
});

test('personnel editing is boss only, including forged boss identities and unrelated team entry', () => {
  const model = new DemoModel();
  for (const role of [roles.manager, roles.frontdesk, roles.therapist, roles.customer, { type: 'boss', id: 'm1' }]) {
    for (const type of ['add-therapist', 'add-frontdesk', 'add-manager', 'edit-therapist', 'edit-frontdesk', 'edit-manager']) {
      assert.throws(() => open(type, 't1', context(model, role)), /老板|权限/);
      assert.throws(() => staff.staffDialog(type, 't1', context(model, role)), /老板|权限/);
    }
  }
  assert.throws(() => staff.renderStaff(context(model, { type: 'boss', id: 't1' })), /老板|权限/);
  assert.throws(() => open('edit-therapist', 'missing', context(model)), /不存在|人员/);
});

test('current inactive store remains explicit and retained while new assignments only offer active stores', () => {
  const model = new DemoModel(); model.state.stores.find(row => row.id === 'a').active = false;
  for (const [kind, id] of [['therapist', 't1'], ['frontdesk', 'f1'], ['manager', 'm1']]) {
    const edit = open(`edit-${kind}`, id, context(model)).html;
    assert.match(edit, /value="a"(?: selected| checked)/);
    assert.match(edit, /已停用.*当前绑定/);
    const add = open(`add-${kind}`, '', context(model)).html;
    assert.doesNotMatch(add, /value="a"/); assert.match(add, /value="b"/);
  }
});

test('names, phone, notes and store labels are escaped in both profile form and boss page', () => {
  const model = new DemoModel(), person = model.state.frontDesks.find(row => row.id === 'f1');
  person.name = '<img src=x onerror=alert(1)>'; person.phone = '" autofocus>'; person.notes = '</textarea><script>evil()</script>';
  model.state.stores[0].name = '<svg onload=evil()>';
  const dialog = open('edit-frontdesk', 'f1', context(model)).html, page = staff.renderStaff(context(model));
  for (const html of [dialog, page]) {
    assert.doesNotMatch(html, /<img src=x|<script>evil|<svg onload/);
    assert.match(html, /&lt;img/); assert.match(html, /&lt;svg/);
  }
  assert.match(dialog, /&lt;\/textarea&gt;&lt;script&gt;/);
});
