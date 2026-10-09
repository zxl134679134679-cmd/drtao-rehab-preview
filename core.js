import { managerClientInStore, storeWorkSnapshot } from './manager-scope.js?v=20261009-scheduling';
import { assertScheduleAvailability } from './schedules.js?v=20261009-scheduling';

export const TODAY = '2026-10-08';
export const EVIDENCE_LIMITS = Object.freeze({ maxCount: 3, maxBytes: 512 * 1024, maxEdge: 1280 });

const copy = value => JSON.parse(JSON.stringify(value));
const money = value => Math.round((value + Number.EPSILON) * 100) / 100;
const required = (value, label, maxLength = 4000) => {
  if (value != null && typeof value !== 'string') throw new Error(`请填写有效的${label}`);
  const text = (value ?? '').trim();
  if (!text) throw new Error(`请填写${label}`);
  if (text.length > maxLength) throw new Error(`${label}长度不能超过 ${maxLength} 字`);
  return text;
};
const optionalText = (value, label, maxLength = 2000) => {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`请填写有效的${label}`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}长度不能超过 ${maxLength} 字`);
  return text;
};
const CASH_CHANNELS = Object.freeze(['direct', 'douyin', 'meituan', 'other_platform']);
const amountMinor = (value, label = '套餐金额') => {
  if (!['string', 'number'].includes(typeof value)) throw new Error(`请核对${label}`);
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error(`${label}须为最多两位小数的正数`);
  const [whole, fraction = ''] = text.split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor < 1 || minor > 1000000000) throw new Error(`${label}须在 0.01 至 10000000 元之间`);
  return minor;
};
const count = (value, label, min = 1, max = 999) => {
  if (!['string', 'number'].includes(typeof value) || !/^\d+$/.test(String(value).trim())) throw new Error(`请核对${label}`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label}须在 ${min} 至 ${max} 之间`);
  return number;
};
const pendingAppointment = status => ['confirmed', 'reschedule_requested', 'pending_reassignment'].includes(status);
const validDate = value => {
  const date = required(value, '日期');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error('请选择有效日期');
  }
  return date;
};
const validTime = value => {
  const time = required(value, '时间');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('请选择有效时间');
  return time;
};
const minutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const pendingProgress = () => ({ status: 'pending', summary: '待康复师完成评估后更新', metrics: [] });
const receptionPhone = value => {
  const phone = required(value, '手机号', 20).replace(/\s/g, '');
  if (!/^1\d{10}$/.test(phone)) throw new Error('请输入 11 位手机号');
  return phone;
};
const receptionBasicClient = client => Object.fromEntries(['id', 'name', 'phone', 'age', 'problem', 'storeId', 'ownerId']
  .filter(key => client[key] !== undefined).map(key => [key, client[key]]));

// Read raster headers as well as the declared MIME type. SVG and remote URLs
// are never evidence attachments; photo dimensions must match the actual file.
function evidenceImageSize(type, bytes) {
  const ascii = (offset, length) => String.fromCharCode(...bytes.slice(offset, offset + length));
  const uint32 = offset => bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 + bytes[offset + 2] * 0x100 + bytes[offset + 3];
  const uint24le = offset => bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
  if (type === 'png' && bytes.length >= 24 &&
      bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index]) && ascii(12, 4) === 'IHDR') {
    return { width: uint32(16), height: uint32(20) };
  }
  if (type === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = bytes[offset] * 256 + bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
        return { width: bytes[offset + 5] * 256 + bytes[offset + 6], height: bytes[offset + 3] * 256 + bytes[offset + 4] };
      }
      offset += length;
    }
  }
  if (type === 'webp' && bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    if (chunk === 'VP8X') return { width: 1 + uint24le(24), height: 1 + uint24le(27) };
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      return { width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]), height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | (bytes[22] >> 6)) };
    }
    if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { width: (bytes[26] | (bytes[27] << 8)) & 0x3fff, height: (bytes[28] | (bytes[29] << 8)) & 0x3fff };
    }
  }
  throw new Error('留底照片格式无效，请重新拍照或选择 JPEG、PNG、WebP 照片');
}

function serviceEvidencePhotos(photos) {
  if (!Array.isArray(photos) || photos.length < 1) throw new Error('请至少添加 1 张本次服务留底照片');
  if (photos.length > EVIDENCE_LIMITS.maxCount) throw new Error(`每次服务最多添加 ${EVIDENCE_LIMITS.maxCount} 张留底照片`);
  const ids = new Set();
  return photos.map(photo => {
    if (!photo || typeof photo !== 'object') throw new Error('留底照片数据无效，请重新添加');
    const id = required(photo.id, '留底照片标识');
    const name = required(photo.name, '留底照片名称');
    if (id.length > 80 || name.length > 160 || ids.has(id)) throw new Error('留底照片标识或名称无效，请重新添加');
    ids.add(id);
    const { width, height } = photo;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > EVIDENCE_LIMITS.maxEdge || height > EVIDENCE_LIMITS.maxEdge) {
      throw new Error(`留底照片尺寸无效，最长边须不超过 ${EVIDENCE_LIMITS.maxEdge} 像素`);
    }
    if (typeof photo.dataUrl !== 'string' || photo.dataUrl.length > Math.ceil(EVIDENCE_LIMITS.maxBytes / 3) * 4 + 32) {
      throw new Error('留底照片须压缩至每张不超过 512 KB');
    }
    const matched = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo.dataUrl);
    if (!matched || matched[2].length % 4 !== 0) throw new Error('留底照片格式无效，请重新拍照或选择 JPEG、PNG、WebP 照片');
    const payload = matched[2];
    const byteLength = payload.length / 4 * 3 - (payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0);
    if (byteLength > EVIDENCE_LIMITS.maxBytes) throw new Error('留底照片须压缩至每张不超过 512 KB');
    let bytes;
    try { bytes = Uint8Array.from(atob(payload), char => char.charCodeAt(0)); }
    catch { throw new Error('留底照片数据无效，请重新添加'); }
    const actual = evidenceImageSize(matched[1], bytes);
    if (actual.width !== width || actual.height !== height) throw new Error('留底照片尺寸与文件不一致，请重新添加');
    // Keep only validated input fields; a caller cannot supply record ownership.
    return { id, name, dataUrl: photo.dataUrl, width, height };
  });
}

function seedClient(id, name, ownerId, storeId, packageId, phone) {
  return {
    id, name, phone, ownerId, storeId, packageId,
    goal: '运动功能恢复计划', phase: '评估与基础训练',
    nextStep: '进行基础训练与阶段复评',
    planNotes: '先完成评估，再根据您的目标安排训练。每个阶段复评后，由负责康复师调整后续计划。',
    progress: pendingProgress(), progressUpdatedAt: null,
    homeAdvice: '请按康复师当次指导练习。练习中如有不适，请停止并联系您的康复师。',
    planVersion: 1,
  };
}

function seedState() {
  return {
    stores: [
      { id: 'a', name: '麦岛店', address: '青岛 · 麦岛店（详细地址待补充）' },
      { id: 'b', name: '崂山店', address: '青岛 · 崂山店（详细地址待补充）' },
    ],
    therapists: [
      { id: 't1', name: '林予安', storeId: 'a', active: true },
      { id: 't2', name: '周亦宁', storeId: 'b', active: true },
      { id: 't3', name: '苏晴', storeId: 'a', active: true },
      { id: 't4', name: '何知行', storeId: 'b', active: true },
      { id: 't5', name: '许映', storeId: 'a', active: true },
    ],
    frontDesks: [
      { id: 'f1', name: '麦岛店前台', storeIds: ['a'], active: true },
      { id: 'f2', name: '崂山店前台', storeIds: ['b'], active: true },
    ],
    storeManagers: [
      { id: 'm1', name: '麦岛店店长', storeId: 'a', active: true },
      { id: 'm2', name: '崂山店店长', storeId: 'b', active: true },
    ],
    clients: [
      seedClient('c1', '陈一诺', 't1', 'a', 'p1', '13800000001'),
      seedClient('c2', '许安然', 't2', 'b', 'p2', '13800000002'),
      seedClient('c3', '周沐', 't1', 'a', 'p3', '13800000003'),
      seedClient('c4', '赵清禾', 't4', 'b', 'p4', '13800000004'),
      seedClient('c5', '王星野', 't5', 'a', 'p5', '13800000005'),
      seedClient('c6', '顾清宁', 't5', 'a', 'p6', '13800000006'),
    ],
    packages: [
      { id: 'p0', clientId: 'c1', name: '历史运动评估套餐', amount: 1200, total: 4, openingUsed: 4, status: 'historical' },
      { id: 'p1', clientId: 'c1', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 0, status: 'current' },
      { id: 'p2', clientId: 'c2', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 0, status: 'current' },
      { id: 'p3', clientId: 'c3', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 8, status: 'current' },
      { id: 'p4', clientId: 'c4', name: '运动功能恢复套餐', amount: 3600, total: 12, openingUsed: 3, status: 'current' },
      { id: 'p5', clientId: 'c5', name: '运动功能恢复套餐', amount: 2400, total: 8, openingUsed: 2, status: 'current' },
      { id: 'p6', clientId: 'c6', name: '运动功能恢复套餐', amount: 3000, total: 10, openingUsed: 10, status: 'current' },
    ],
    services: [
      {
        id: 's1', clientId: 'c1', packageId: 'p1', storeId: 'b', date: TODAY,
        time: '10:00', project: '首次评估', principalId: 't2', participantIds: ['t1', 't3'],
        ownerId: 't1', recordedBy: 't2', amount: 300, sessions: 1, status: 'valid',
        notes: '已完成首次评估。下一步进行基础训练与阶段复评。',
        slotNumber: 1, amountMinor: 30000,
        requestId: 'seed-s1', createdAt: '2026-10-08T03:00:00.000Z',
      },
    ],
    appointments: [
      { id: 'a1', clientId: 'c1', date: '2026-10-10', time: '10:00', storeId: 'b', principalId: 't2', project: '阶段复评与训练', status: 'confirmed', requestNote: '' },
      { id: 'a2', clientId: 'c2', date: TODAY, time: '11:30', storeId: 'b', principalId: 't2', project: '基础训练', status: 'confirmed', requestNote: '' },
      { id: 'a3', clientId: 'c3', date: TODAY, time: '14:00', storeId: 'a', principalId: 't1', project: '阶段复评', status: 'confirmed', requestNote: '' },
      { id: 'a4', clientId: 'c3', date: '2026-10-07', time: '15:00', storeId: 'a', principalId: 't1', project: '基础训练', status: 'confirmed', requestNote: '' },
    ],
    tasks: [
      { id: 'task1', clientId: 'c1', title: '完善首次评估与阶段计划', assigneeId: 't1', dueDate: TODAY, status: 'pending', type: 'assessment' },
      { id: 'task2', clientId: 'c3', title: '剩余 2 次，安排阶段复评', assigneeId: 't1', dueDate: '2026-10-10', status: 'pending', type: 'review' },
      { id: 'task3', clientId: 'c2', appointmentId: 'a2', title: '完成本次训练后的服务记录', assigneeId: 't2', dueDate: TODAY, status: 'pending', type: 'service_note' },
      { id: 'task4', clientId: 'c6', title: '套餐已用完，核对下一阶段服务安排', assigneeId: 't5', dueDate: '2026-10-07', status: 'pending', type: 'review' },
    ],
    reviews: [], audit: [], receipts: [], refunds: [],
  };
}

// Explicitly initialize the fictional UI example. Loading any supplied archive
// never invents cards or changes the store ownership of existing packages.
export function ensureStorePackageExamples(model) {
  if (!model._usesPreviewSeed) return model;
  const client = model.state.clients.find(row => row.id === 'c1');
  const current = model.state.packages.find(row => row.id === 'p1');
  if (!client || client.name !== '陈一诺' || client.ownerId !== 't1' || client.packageId !== 'p1' || !current || current.clientId !== 'c1' || current.amountMinor !== 300000 || current.total !== 10 || model.state.packages.some(row => row.id === 'p7')) return model;
  model._store('a'); model._store('b');
  for (const pack of model.state.packages) {
    const owner = model.state.clients.find(row => row.id === pack.clientId);
    if (owner) pack.storeId = pack.id === 'p1' ? 'b' : owner.storeId;
  }
  model.state.packages.push({ id: 'p7', clientId: 'c1', storeId: 'a', name: '运动功能恢复套餐', amount: 3000, amountMinor: 300000, total: 10, openingUsed: 0, status: 'historical' });
  return model;
}

export class DemoModel {
  constructor({ today = TODAY, now = () => new Date().toISOString(), state, sequence = 100, seed = true, enforceServiceTime = false } = {}) {
    this.today = validDate(today);
    if (typeof enforceServiceTime !== 'boolean') throw new Error('严格服务时间配置须为布尔值');
    this.enforceServiceTime = enforceServiceTime;
    if (typeof now !== 'function') throw new Error('请提供有效的服务器时钟');
    this.now = now;
    this._timestamp();
    if (state === undefined && !seed) throw new Error('无种子模式须显式提供业务状态，不能自动生成示例数据');
    this._usesPreviewSeed = state === undefined;
    const source = state === undefined ? seedState() : state;
    const collections = ['stores', 'therapists', 'clients', 'packages', 'services', 'appointments', 'tasks', 'reviews', 'audit'];
    if (!source || collections.some(key => !Array.isArray(source[key]))) throw new Error('业务状态缺少有效的数据集合');
    for (const key of ['receipts', 'refunds', 'frontDesks', 'appointmentBatches', 'storeManagers']) {
      if (source[key] !== undefined && !Array.isArray(source[key])) throw new Error('业务状态缺少有效的数据集合');
      collections.push(key);
    }
    this.state = copy(source);
    this.state.receipts ??= [];
    this.state.refunds ??= [];
    this.state.frontDesks ??= [];
    this.state.appointmentBatches ??= [];
    this.state.storeManagers ??= [];
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('业务序列无效');
    const ids = collections.flatMap(key => this.state[key].map(row => row?.id));
    if (ids.some(id => typeof id !== 'string' || !id.trim())) throw new Error('业务状态包含无效记录标识');
    const numericIds = ids.map(id => Number(/(\d+)$/.exec(id)?.[1] || 0));
    this.sequence = numericIds.reduce((highest, value) => Math.max(highest, value), sequence);
    if (!Number.isSafeInteger(this.sequence)) throw new Error('业务状态的数字序列超出可用范围');
    const frontDeskIds = new Set();
    for (const row of this.state.frontDesks) {
      required(row.name, '前台姓名', 80);
      this._frontDeskStoreIds(row.storeIds);
      if (typeof row.active !== 'boolean' || frontDeskIds.has(row.id)) throw new Error('前台业务状态包含无效或重复人员记录');
      frontDeskIds.add(row.id);
    }
    const managerIds = new Set();
    for (const row of this.state.storeManagers) {
      required(row.name, '店长姓名', 80);
      this._store(row.storeId);
      if (typeof row.active !== 'boolean' || managerIds.has(row.id)) throw new Error('店长业务状态包含无效或重复人员记录');
      managerIds.add(row.id);
    }
    this.state.packages.forEach(pack => {
      const minor = amountMinor(pack.amount);
      if (pack.amountMinor !== undefined && pack.amountMinor !== minor) throw new Error('套餐金额与分金额不一致');
      pack.amountMinor = minor;
      pack.total = count(pack.total, '套餐总次数');
      pack.openingUsed = count(pack.openingUsed, '期初已用次数', 0, pack.total);
      if (minor < pack.total) throw new Error('套餐金额不能少于总次数对应的分金额');
      const storeId = this._packageStoreId(pack);
      if (storeId) { pack.storeId = storeId; this._client(pack.clientId); }
    });
    const claimed = new Set();
    this.state.services.forEach(service => {
      const pack = this.state.packages.find(row => row.id === service.packageId);
      if (!pack || !Number.isInteger(service.slotNumber) || service.slotNumber <= pack.openingUsed || service.slotNumber > pack.total) {
        throw new Error('历史服务缺少有效套餐槽位，请先完成数据迁移');
      }
      if (pack.storeId && (service.storeId !== pack.storeId || service.clientId !== pack.clientId)) throw new Error('历史服务客户或门店与原套餐绑定不一致，请核对原档案');
      const minor = this.slotValueMinor(pack.id, service.slotNumber);
      if (amountMinor(service.amount) !== minor || (service.amountMinor !== undefined && service.amountMinor !== minor)) throw new Error('历史服务金额与套餐槽位不一致，请核对迁移');
      service.amountMinor = minor;
      const key = `${pack.id}:${service.slotNumber}`;
      if (service.status === 'valid' && claimed.has(key)) throw new Error('同一套餐槽位存在重复有效消课');
      if (service.status === 'valid') claimed.add(key);
    });
    for (const row of [...this.state.receipts, ...this.state.refunds]) {
      const minor = amountMinor(row.amount, '收支金额');
      if (row.amountMinor !== undefined && row.amountMinor !== minor) throw new Error('收支金额与分金额不一致，请核对迁移');
      row.amountMinor = minor;
    }
    this._validateCashState();
  }

  _validateCashState() {
    const financialRows = [...this.state.receipts, ...this.state.refunds];
    if (new Set(financialRows.map(row => row.id)).size !== financialRows.length) throw new Error('收支状态存在重复记录标识');
    const requestKeys = new Set();
    for (const row of financialRows) {
      validDate(row.date); validTime(row.time);
      this._store(row.storeId);
      required(row.recordedBy, '收支登记人', 80);
      const key = `${row.recordedBy}:${required(row.requestId, '收支提交标识', 80)}`;
      if (requestKeys.has(key)) throw new Error('收支状态存在重复提交请求');
      requestKeys.add(key);
      if (!CASH_CHANNELS.includes(row.channel)) throw new Error('收支状态包含无效渠道');
      if (!['wechat', 'alipay', 'cash', 'bank'].includes(row.method)) throw new Error('收支状态包含无效收款方式');
      if (row.clientId) this._client(row.clientId);
      else if (row.channel === 'direct') throw new Error('直接收款状态缺少客户');
    }
    for (const row of this.state.receipts) {
      if (!['valid', 'pending_settlement', 'settled', 'revoked'].includes(row.status) || !['received', 'pending'].includes(row.settlementStatus)) throw new Error('收款状态无效');
      if (!['package', 'renewal', 'single', 'other', 'platform_settlement'].includes(row.purpose)) throw new Error('收款用途无效');
      if (row.channel === 'direct' && (row.settlementStatus !== 'received' || row.purpose === 'platform_settlement')) throw new Error('直接收款状态不能使用平台待结算');
      if (row.channel !== 'direct') required(row.reference, '平台参考单号', 160);
      if ((row.status === 'valid' && row.settlementStatus !== 'received') || (['pending_settlement', 'settled'].includes(row.status) && row.settlementStatus !== 'pending')) throw new Error('收款状态与到账状态不一致');
      if (['valid', 'pending_settlement'].includes(row.status)) this._assertPlatformReferenceUnique(row, row.id);
      if (row.parentId) {
        const parent = this.state.receipts.find(item => item.id === row.parentId);
        if (!parent || parent.parentId || parent.channel === 'direct' || parent.settlementStatus !== 'pending' ||
            ['storeId', 'channel', 'clientId', 'method'].some(key => row[key] !== parent[key]) || row.settlementStatus !== 'received' ||
            row.purpose !== 'platform_settlement' || `${row.date} ${row.time}` < `${parent.date} ${parent.time}` ||
            !parent.settlementReceiptIds?.includes(row.id)) throw new Error('平台到账子单与父单关联无效');
        if (row.status === 'valid' && (parent.status !== 'settled' || parent.settlementReceiptId !== row.id)) throw new Error('有效到账子单与父单结算状态不一致');
      }
      if (row.settlementReceiptIds !== undefined) {
        const ids = row.settlementReceiptIds;
        if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string' || !this.state.receipts.some(child => child.id === id && child.parentId === row.id)) || new Set(ids).size !== ids.length ||
            !ids.includes(row.settlementReceiptId)) throw new Error('平台结算历史关联无效');
      }
      const children = this.state.receipts.filter(child => child.parentId === row.id && child.status === 'valid');
      if (children.length > 1 || (row.status === 'settled' && children.length !== 1) || (row.status !== 'settled' && children.length > 0)) throw new Error('平台父单存在无效或重复的有效到账结算');
    }
    for (const row of this.state.refunds) {
      const receipt = this.state.receipts.find(item => item.id === row.receiptId);
      if (!receipt || !['valid', 'revoked'].includes(row.status) || ['storeId', 'channel', 'clientId', 'method'].some(key => row[key] !== receipt[key]) ||
          `${row.date} ${row.time}` < `${receipt.date} ${receipt.time}` || (row.status === 'valid' && receipt.status !== 'valid')) throw new Error('退款与原有效收款关联无效');
    }
    for (const row of this.state.receipts) {
      const refunded = this.state.refunds.filter(item => item.receiptId === row.id && item.status === 'valid').reduce((sum, item) => sum + item.amountMinor, 0);
      if (refunded > row.amountMinor) throw new Error('累计有效退款超过原收款金额');
    }
  }

  _timestamp() {
    const stamp = this.now();
    if (typeof stamp !== 'string' || !Number.isFinite(Date.parse(stamp))) throw new Error('服务器时钟须返回有效 ISO 时间');
    return new Date(stamp).toISOString();
  }

  _assertServiceStarted(date, time, label = '服务') {
    if (!this.enforceServiceTime) return;
    const start = Date.parse(`${validDate(date)}T${validTime(time)}:00+08:00`);
    if (start > Date.parse(this._timestamp())) throw new Error(`此${label}时间尚未发生，请在实际${label}发生后处理`);
  }

  _id(prefix) { return `${prefix}${++this.sequence}`; }
  _client(id) {
    const row = this.state.clients.find(item => item.id === id);
    if (!row) throw new Error('客户不存在');
    return row;
  }
  _store(id) {
    const row = this.state.stores.find(item => item.id === id);
    if (!row) throw new Error('门店不存在');
    return row;
  }
  _therapist(id, active = true) {
    const row = this.state.therapists.find(item => item.id === id);
    if (!row || (active && !row.active)) throw new Error('请选择在职康复师');
    return row;
  }
  _boss(role) {
    if (role?.type !== 'boss' || role.id !== 'boss') throw new Error('仅老板有权限进行此操作');
  }
  managerStoreId(role) {
    if (role?.type !== 'manager') throw new Error('仅店长可读取本店工作权限');
    const row = this.state.storeManagers.find(item => item.id === role.id && item.active === true);
    if (!row) throw new Error('请选择在职且有本店权限的店长');
    this._store(row.storeId);
    return row.storeId;
  }

  managerSnapshot(role, filters = {}) {
    return storeWorkSnapshot(this, role, filters);
  }
  _frontDesk(id) {
    const row = this.state.frontDesks.find(item => item.id === id && item.active);
    if (!row) throw new Error('此前台不存在或已停用，您没有操作权限');
    return row;
  }
  _frontDeskStoreIds(value) {
    if (!Array.isArray(value) || !value.length || value.length > 99 || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 80) || new Set(value).size !== value.length) throw new Error('前台授权门店须填写非空、唯一的有效门店标识数组');
    value.forEach(id => this._store(id));
    return [...value];
  }
  frontDeskStoreIds(role) {
    if (role?.type !== 'frontdesk') throw new Error('仅前台可读取本人门店权限');
    return [...this._frontDesk(role.id).storeIds];
  }
  receptionStoreIds(role) {
    let ids;
    if (role?.type === 'boss') {
      this._boss(role);
      ids = this.state.stores.map(store => store.id);
    } else if (role?.type === 'manager') ids = [this.managerStoreId(role)];
    else if (role?.type === 'frontdesk') ids = this.frontDeskStoreIds(role);
    else if (role?.type === 'therapist') ids = [this._therapist(role.id).storeId];
    else throw new Error('仅老板、在职店长、前台和康复师有权限新客户建档');
    return ids.filter(id => this._store(id).active !== false);
  }
  _receptionActor(role, storeId) {
    const stores = this.receptionStoreIds(role);
    if (!stores.length) throw new Error('没有有效的新客户建档门店，请核对门店是否停用');
    if (storeId && !stores.includes(storeId)) throw new Error('您没有该门店的新客户建档权限，或门店已停用');
    return stores;
  }

  findReceptionDuplicates(value, role) {
    this._receptionActor(role);
    const phone = receptionPhone(value);
    const matches = this.state.clients.filter(client => typeof client.phone === 'string' && client.phone.replace(/\s/g, '') === phone);
    // A cross-store match blocks a duplicate file, but it does not grant access
    // to that other store's customer identity, condition or clinical records.
    return { duplicate: matches.length > 0, clients: matches.filter(client => this.canSeeClient(role, client.id)).map(receptionBasicClient) };
  }

  createReceptionClient(data, role) {
    this._receptionActor(role);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请填写新客户基本资料');
    const storeId = required(data.storeId, '接待门店', 80);
    this._receptionActor(role, storeId);
    const store = this._store(storeId);
    if (store.active === false) throw new Error('接待门店已停用，请核对门店');
    const ownerId = required(data.ownerId, '负责康复师', 80), owner = this._therapist(ownerId);
    if (owner.storeId !== storeId) throw new Error('请选择本店在职康复师作为负责人');
    if (role.type === 'therapist' && ownerId !== role.id) throw new Error('康复师新建档案的负责人须为本人');
    const requestId = required(data.requestId, '建档提交标识', 80);
    const input = { name: required(data.name, '客户姓名', 80), phone: receptionPhone(data.phone), age: count(data.age, '客户年龄', 0, 120),
      problem: required(data.problem, '主要问题', 1000), storeId, ownerId };
    const inputKey = JSON.stringify(input);
    const existing = this.state.clients.find(client => client.receptionRequestId === requestId && client.createdBy === role.id && client.createdRole === role.type);
    if (existing) {
      if (existing.receptionInputKey !== inputKey) throw new Error('同一建档提交请求的内容发生变化，请重新打开接待表');
      return existing;
    }
    if (this.findReceptionDuplicates(input.phone, role).duplicate) throw new Error('该手机号已存在客户档案，请核对原档案，避免重复建档；其他门店档案请联系老板处理');
    const stamp = this._timestamp(), staged = this._stagePackageWrite(stamp);
    const client = seedClient(staged._id('c'), input.name, ownerId, storeId, null, input.phone);
    Object.assign(client, { age: input.age, problem: input.problem, goal: '待制定康复计划', phase: '待初次评估',
      nextStep: '预约首次评估，完成后由负责康复师制定计划', planNotes: '客户基本资料已登记，康复计划待负责康复师完成评估后制定。',
      homeAdvice: '待负责康复师完成评估后补充', createdAt: stamp, createdBy: role.id, createdRole: role.type,
      receptionRequestId: requestId, receptionInputKey: inputKey });
    staged.state.clients.push(client);
    staged._log('reception_client_created', { clientId: client.id, storeId, after: receptionBasicClient(client), note: '仅建立客户基本档案，不办理套餐、不登记收款、不计消费业绩' }, role);
    this.state = staged.state; this.sequence = staged.sequence;
    return client;
  }
  _cashActor(role, storeId, clientId) {
    if (role?.type === 'boss') return this._boss(role);
    if (role?.type !== 'frontdesk') throw new Error('仅老板和授权门店前台有权限登记收款或确认到账');
    const frontDesk = this._frontDesk(role.id);
    if (storeId && !frontDesk.storeIds.includes(storeId)) throw new Error('您没有该门店的收款操作权限');
    if (clientId && !this.canSeeClient(role, clientId)) throw new Error('您没有该客户的前台操作权限');
    return frontDesk;
  }
  _bookingActor(role, clientId, storeId) {
    if (role?.type !== 'frontdesk') return this._staff(role, clientId);
    const frontDesk = this._frontDesk(role.id);
    if (!frontDesk.storeIds.includes(storeId)) throw new Error('您没有该门店的预约操作权限');
    if (!this.canSeeClient(role, clientId)) throw new Error('您没有该客户的前台操作权限');
    return this._client(clientId);
  }
  _staff(role, clientId) {
    if (role?.type === 'boss') this._boss(role);
    else if (role?.type === 'therapist') {
      this._therapist(role.id);
      if (!this.canSeeClient(role, clientId)) throw new Error('您没有查看或登记该客户的权限');
    } else throw new Error('您没有登记或管理服务的权限，仅康复师和老板可以操作');
    return this._client(clientId);
  }
  _log(type, data, role) {
    const row = { id: this._id('audit'), type, ...copy(data), actorId: role.id, actorType: role.type, createdAt: this._timestamp() };
    this.state.audit.unshift(row);
    return row;
  }

  _cashOccurrence(data, label) {
    const date = validDate(data.date), time = validTime(data.time);
    if (date > this.today) throw new Error(`不能登记尚未发生的未来${label}`);
    this._assertServiceStarted(date, time, label);
    return { date, time };
  }

  _financialExisting(requestId, role, requestType, inputKey) {
    const existing = [...this.state.receipts, ...this.state.refunds].find(row => row.recordedBy === role.id && row.requestId === requestId);
    if (!existing) return null;
    if (existing.requestType !== requestType || existing.inputKey !== inputKey) throw new Error('同一提交请求的内容或收支操作发生变化，请重新打开录入表');
    return existing;
  }

  _assertPlatformReferenceUnique(input, excludedId) {
    if (input.channel === 'direct') return;
    const excluded = new Set(Array.isArray(excludedId) ? excludedId : [excludedId]);
    if (this.state.receipts.some(row => !excluded.has(row.id) && ['valid', 'pending_settlement'].includes(row.status) &&
        row.storeId === input.storeId && row.channel === input.channel && row.reference === input.reference)) {
      throw new Error('该门店和平台的单号已录入，请核对原账单，不能重复记账');
    }
  }

  recordReceipt(data, role) {
    this._cashActor(role);
    const requestId = required(data.requestId, '提交标识', 80);
    const channel = data.channel ?? 'direct', settlementStatus = data.settlementStatus ?? 'received';
    if (!CASH_CHANNELS.includes(channel)) throw new Error('请选择有效收款渠道');
    if (!['received', 'pending'].includes(settlementStatus)) throw new Error('请选择有效到账状态');
    if (channel === 'direct' && settlementStatus === 'pending') throw new Error('待结算状态仅适用于平台渠道');
    const purpose = required(data.purpose, '收款用途', 80), method = required(data.method, '收款方式', 80);
    if (!['package', 'renewal', 'single', 'other', 'platform_settlement'].includes(purpose)) throw new Error('请选择有效收款用途');
    if (purpose === 'platform_settlement' && channel === 'direct') throw new Error('平台结算用途须选择平台渠道');
    if (!['wechat', 'alipay', 'cash', 'bank'].includes(method)) throw new Error('请选择有效收款方式');
    const clientId = channel === 'direct' ? required(data.clientId, '客户', 80) : optionalText(data.clientId, '客户', 80);
    if (clientId) this._client(clientId);
    const storeId = required(data.storeId, '收款门店', 80);
    this._store(storeId);
    this._cashActor(role, storeId, clientId);
    const reference = channel === 'direct' ? optionalText(data.reference, '参考单号', 160) : required(data.reference, '平台参考单号', 160);
    const minor = amountMinor(data.amount, '收款金额');
    const input = { clientId, storeId, date: validDate(data.date), time: validTime(data.time), purpose, method, channel,
      settlementStatus, reference, amountMinor: minor, notes: optionalText(data.notes, '收款备注') };
    const inputKey = JSON.stringify(input);
    const existing = this._financialExisting(requestId, role, 'receipt', inputKey);
    if (existing) return existing;
    this._cashOccurrence(input, '收款');
    this._assertPlatformReferenceUnique(input);
    const stamp = this._timestamp();
    const row = { id: this._id('receipt'), ...input, amount: minor / 100,
      status: settlementStatus === 'pending' ? 'pending_settlement' : 'valid', recordedBy: role.id, recordedRole: role.type,
      requestId, requestType: 'receipt', inputKey, createdAt: stamp, recordedAt: stamp };
    this.state.receipts.push(row);
    this._log('receipt_recorded', { receiptId: row.id, clientId, storeId, channel, status: row.status, amountMinor: minor, reference }, role);
    return row;
  }

  refundReceipt(data, role) {
    this._boss(role);
    const requestId = required(data.requestId, '提交标识', 80);
    const receiptId = required(data.receiptId, '原收款标识', 80), minor = amountMinor(data.amount, '退款金额');
    const input = { receiptId, date: validDate(data.date), time: validTime(data.time), amountMinor: minor,
      reason: required(data.reason, '退款原因', 1000) };
    const inputKey = JSON.stringify(input), existing = this._financialExisting(requestId, role, 'refund', inputKey);
    if (existing) return existing;
    const receipt = this.state.receipts.find(row => row.id === receiptId);
    if (!receipt || receipt.status !== 'valid') throw new Error('只能从有效的已到账收款登记退款');
    this._cashOccurrence(input, '退款');
    if (`${input.date} ${input.time}` < `${receipt.date} ${receipt.time}`) throw new Error('退款时间不能早于原收款时间');
    const refunded = this.state.refunds.filter(row => row.receiptId === receiptId && row.status === 'valid').reduce((sum, row) => sum + row.amountMinor, 0);
    if (refunded + minor > receipt.amountMinor) throw new Error('累计有效退款不能超过原收款金额，请核对可退余额');
    const stamp = this._timestamp();
    const row = { id: this._id('refund'), ...input, clientId: receipt.clientId, storeId: receipt.storeId,
      method: receipt.method, channel: receipt.channel, amount: minor / 100, status: 'valid', recordedBy: role.id, recordedRole: role.type,
      requestId, requestType: 'refund', inputKey, createdAt: stamp, recordedAt: stamp };
    this.state.refunds.push(row);
    this._log('refund_recorded', { refundId: row.id, receiptId, clientId: row.clientId, storeId: row.storeId, channel: row.channel, amountMinor: minor, reason: row.reason }, role);
    return row;
  }

  settleReceipt(id, data, role) {
    this._cashActor(role);
    const parentId = required(id, '待结算标识', 80), requestId = required(data.requestId, '提交标识', 80);
    const parent = this.state.receipts.find(row => row.id === parentId);
    if (!parent) throw new Error('待结算收款记录不存在');
    this._cashActor(role, parent.storeId, parent.clientId);
    const minor = amountMinor(data.amount, '到账金额');
    const input = { parentId, date: validDate(data.date), time: validTime(data.time), amountMinor: minor,
      reference: required(data.reference, '到账参考单号', 160), notes: optionalText(data.notes, '到账备注') };
    const inputKey = JSON.stringify(input), existing = this._financialExisting(requestId, role, 'settlement', inputKey);
    if (existing) return existing;
    if (parent.status !== 'pending_settlement' || parent.channel === 'direct') throw new Error('只能确认平台待结算单到账，原单可能已结算或已撤销');
    if (this.state.receipts.some(row => row.parentId === parentId && row.status === 'valid')) throw new Error('该待结算单已有有效到账子单，不能重复结算');
    this._cashOccurrence(input, '到账');
    if (`${input.date} ${input.time}` < `${parent.date} ${parent.time}`) throw new Error('到账时间不能早于原待结算日期和时间');
    this._assertPlatformReferenceUnique({ storeId: parent.storeId, channel: parent.channel, reference: input.reference }, parentId);
    const stamp = this._timestamp();
    const row = { id: this._id('receipt'), ...input, clientId: parent.clientId, storeId: parent.storeId,
      channel: parent.channel, purpose: 'platform_settlement', method: parent.method,
      settlementStatus: 'received', amount: minor / 100, status: 'valid', recordedBy: role.id, recordedRole: role.type,
      requestId, requestType: 'settlement', inputKey, createdAt: stamp, recordedAt: stamp };
    this.state.receipts.push(row);
    parent.status = 'settled';
    parent.settlementReceiptId = row.id;
    parent.settlementReceiptIds = [...(parent.settlementReceiptIds || []), row.id];
    this._log('receipt_settled', { receiptId: row.id, parentId, storeId: row.storeId, channel: row.channel, amountMinor: minor, reference: row.reference }, role);
    return row;
  }

  voidReceipt(id, reason, role) {
    this._boss(role);
    const why = required(reason, '撤销收款原因', 1000), row = this.state.receipts.find(item => item.id === id);
    if (!row) throw new Error('收款记录不存在');
    if (row.status === 'revoked') throw new Error('该收款已撤销，不能重复撤销');
    if (row.status === 'settled') throw new Error('该单已结算，请先核对并处理到账子单，不能直接撤销父单');
    if (!['valid', 'pending_settlement'].includes(row.status)) throw new Error('该收款状态不能撤销');
    if (this.state.refunds.some(item => item.receiptId === row.id && item.status === 'valid')) throw new Error('此收款有有效退款，请先核对并处理退款记录');
    const parent = row.parentId && this.state.receipts.find(item => item.id === row.parentId);
    if (row.parentId && (!parent || parent.status !== 'settled' || parent.settlementReceiptId !== row.id)) throw new Error('到账子单与父单关联不一致，请核对账目');
    if (parent) this._assertPlatformReferenceUnique(parent, [parent.id, row.id]);
    const stamp = this._timestamp();
    row.status = 'revoked';
    row.voidReason = why; row.voidedBy = role.id; row.voidedAt = stamp;
    if (parent) parent.status = 'pending_settlement';
    this._log('receipt_voided', { receiptId: row.id, parentId: row.parentId || null, reason: why, amountMinor: row.amountMinor }, role);
    return row;
  }

  voidRefund(id, reason, role) {
    this._boss(role);
    const why = required(reason, '撤销退款原因', 1000), row = this.state.refunds.find(item => item.id === id);
    if (!row) throw new Error('退款记录不存在');
    if (row.status === 'revoked') throw new Error('该退款已撤销，不能重复撤销');
    if (row.status !== 'valid') throw new Error('该退款状态不能撤销');
    const stamp = this._timestamp();
    row.status = 'revoked';
    row.voidReason = why; row.voidedBy = role.id; row.voidedAt = stamp;
    this._log('refund_voided', { refundId: row.id, receiptId: row.receiptId, reason: why, amountMinor: row.amountMinor }, role);
    return row;
  }

  cashSummary(filters = {}, role) {
    let allowedStores = null;
    if (role !== undefined) {
      if (role?.type === 'boss') this._boss(role);
      else if (role?.type === 'frontdesk') allowedStores = this.frontDeskStoreIds(role);
      else if (role?.type === 'manager') allowedStores = [this.managerStoreId(role)];
      else throw new Error('您没有查看营业收支的权限');
    }
    const storeId = optionalText(filters.storeId, '门店', 80);
    if (storeId) this._store(storeId);
    if (storeId && allowedStores && !allowedStores.includes(storeId)) throw new Error('您没有该门店的营业收支查看权限');
    const from = filters.from ? validDate(filters.from) : '', to = filters.to ? validDate(filters.to) : '';
    if (from && to && from > to) throw new Error('日期范围的开始不能晚于结束');
    const matches = row => (!allowedStores || allowedStores.includes(row.storeId)) && (!storeId || row.storeId === storeId) && (!from || row.date >= from) && (!to || row.date <= to);
    const receipts = this.state.receipts.filter(row => row.status === 'valid' && matches(row));
    const refunds = this.state.refunds.filter(row => row.status === 'valid' && matches(row));
    const pending = this.state.receipts.filter(row => row.status === 'pending_settlement' && matches(row));
    const sum = rows => rows.reduce((total, row) => {
      const next = total + row.amountMinor;
      if (!Number.isSafeInteger(next)) throw new Error('收支合计超出安全金额范围，请分日期核对');
      return next;
    }, 0);
    const totals = (receivedMinor, refundedMinor, pendingMinor) => ({ receivedMinor, refundedMinor, netMinor: receivedMinor - refundedMinor,
      received: receivedMinor / 100, refunded: refundedMinor / 100, net: (receivedMinor - refundedMinor) / 100, pendingMinor, pending: pendingMinor / 100 });
    const channels = CASH_CHANNELS.map(channel => ({ channel, ...totals(sum(receipts.filter(row => row.channel === channel)),
      sum(refunds.filter(row => row.channel === channel)), sum(pending.filter(row => row.channel === channel))) }));
    return { ...totals(sum(receipts), sum(refunds), sum(pending)), receipts, refunds, channels };
  }

  remaining(clientId) {
    const client = this._client(clientId);
    if (client.packageId === null || client.packageId === undefined || client.packageId === '') return 0;
    return this.packageRemaining(client.packageId);
  }

  packageRemaining(packageId) {
    const pack = this.state.packages.find(item => item.id === packageId);
    if (!pack) throw new Error('套餐不存在');
    const used = this.state.services.filter(item => item.packageId === pack.id && item.status === 'valid').reduce((total, item) => total + item.sessions, 0);
    return pack.total - pack.openingUsed - used;
  }

  _packageStoreId(pack) {
    if (pack.storeId === undefined || pack.storeId === null || pack.storeId === '') return '';
    const storeId = required(pack.storeId, '套餐使用门店', 80);
    this._store(storeId);
    return storeId;
  }

  availablePackages(clientId, storeId) {
    const client = this._client(clientId);
    if (storeId !== undefined) this._store(storeId);
    return this.state.packages.filter(pack => {
      if (pack.clientId !== client.id || !['current', 'historical'].includes(pack.status)) return false;
      const boundStore = this._packageStoreId(pack);
      if (!boundStore && (pack.id !== client.packageId || pack.status !== 'current')) return false;
      if (storeId !== undefined && boundStore && boundStore !== storeId) return false;
      return pack.status === 'current' || this.packageRemaining(pack.id) > 0;
    }).sort((a, b) => {
      const rank = pack => storeId !== undefined && !this._packageStoreId(pack) ? 2 : pack.status === 'current' ? 0 : 1;
      return rank(a) - rank(b);
    }).map(copy);
  }

  remainingInStore(clientId, storeId) {
    this._store(storeId);
    return this.availablePackages(clientId, storeId).reduce((total, pack) => total + this.packageRemaining(pack.id), 0);
  }

  _stagePackageWrite(stamp) {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { now: () => stamp, state: { ...this.state, packages: this.state.packages.map(copy), clients: this.state.clients.map(copy), audit: [...this.state.audit] } });
  }

  _existingPackageRequest(requestId, role) {
    return this.state.packages.find(pack => pack.requestId === requestId && (pack.createdBy === role.id || pack.renewedBy === role.id));
  }

  createStorePackage(data, role) {
    this._boss(role);
    const client = this._client(data.clientId), store = this._store(required(data.storeId, '办卡门店', 80));
    const requestId = required(data.requestId, '提交标识', 80);
    const minor = amountMinor(data.amount), total = count(data.total, '套餐总次数');
    if (minor < total) throw new Error('套餐金额不能少于总次数对应的分金额');
    const input = { operation: 'store_package_created', clientId: client.id, storeId: store.id, name: required(data.name, '套餐名称', 80), amount: minor / 100, total };
    const inputKey = JSON.stringify(input), existing = this._existingPackageRequest(requestId, role);
    if (existing) {
      if (existing.inputKey !== inputKey) throw new Error('同一套餐提交请求的内容或操作用途发生变化，请重新打开办卡表');
      return existing;
    }
    if (store.active === false) throw new Error('办卡门店已停用，请核对门店');
    const stamp = this._timestamp(), staged = this._stagePackageWrite(stamp);
    const firstPackage = !client.packageId;
    const row = { id: staged._id('p'), clientId: client.id, storeId: store.id, name: input.name, amount: minor / 100, amountMinor: minor, total, openingUsed: 0, status: firstPackage ? 'current' : 'historical', createdBy: role.id, createdRole: role.type, createdAt: stamp, requestId, inputKey };
    staged.state.packages.push(row);
    if (firstPackage) staged._client(client.id).packageId = row.id;
    staged._log('store_package_created', { clientId: client.id, storeId: store.id, packageId: row.id, after: copy(row), note: '登记本店套餐次数，实际收款须单独登记' }, role);
    this.state = staged.state; this.sequence = staged.sequence;
    return row;
  }

  renewPackage(data, role) {
    this._boss(role);
    const client = this._client(data.clientId);
    const requestId = required(data.requestId, '提交标识', 80);
    const minor = amountMinor(data.amount), amount = minor / 100, total = count(data.total, '套餐总次数');
    if (minor < total) throw new Error('套餐金额不能少于总次数对应的分金额');
    const existing = this._existingPackageRequest(requestId, role);
    if (existing && !existing.renewedBy) throw new Error('同一套餐提交请求已用于其他操作，请重新打开续套餐表');
    const previousId = data.previousPackageId === undefined ? existing?.previousPackageId || client.packageId : required(data.previousPackageId, '原套餐标识', 80);
    const previous = this.state.packages.find(item => item.id === previousId && item.clientId === client.id && ['current', 'historical'].includes(item.status));
    if (!previous) throw new Error('请选择该客户本人已用完的原套餐');
    const boundStore = this._packageStoreId(previous);
    const requestedStore = data.storeId === undefined ? '' : required(data.storeId, '续套餐门店', 80);
    if (boundStore && requestedStore && boundStore !== requestedStore) throw new Error('原套餐只能在办卡门店续费，不能改成另一门店');
    const storeId = boundStore || requestedStore || existing?.storeId || client.storeId;
    const store = this._store(storeId);
    const input = { operation: 'package_renewed', clientId: client.id, storeId, previousPackageId: previous.id, name: required(data.name, '套餐名称', 80), amount, total, reason: required(data.reason, '续套餐原因', 1000) };
    const inputKey = JSON.stringify(input);
    if (existing) {
      if (existing.inputKey !== inputKey) throw new Error('同一提交请求的内容发生变化，请重新打开续套餐表');
      return existing;
    }
    if (store.active === false) throw new Error('续套餐门店已停用，请核对门店');
    if (this.packageRemaining(previous.id) !== 0) throw new Error('原套餐仍有剩余次数，请用完后再续套餐');
    const stamp = this._timestamp(), staged = this._stagePackageWrite(stamp);
    const replacePrimary = previous.id === client.packageId;
    const row = { id: staged._id('p'), clientId: client.id, storeId, name: input.name, amount, amountMinor: minor, total, openingUsed: 0,
      status: replacePrimary ? 'current' : 'historical', previousPackageId: previous.id, renewedBy: role.id, reason: input.reason,
      requestId, inputKey, createdAt: stamp };
    staged.state.packages.find(item => item.id === previous.id).status = 'historical';
    if (replacePrimary) staged._client(client.id).packageId = row.id;
    staged.state.packages.push(row);
    staged._log('package_renewed', { clientId: client.id, storeId, packageId: row.id, previousPackageId: previous.id, reason: input.reason, after: copy(row) }, role);
    this.state = staged.state; this.sequence = staged.sequence;
    return row;
  }

  activatePackage(packageId, reason, role) {
    this._boss(role);
    const why = required(reason, '切换使用套餐原因');
    const target = this.state.packages.find(item => item.id === packageId);
    if (!target) throw new Error('套餐不存在');
    const client = this._client(target.clientId);
    if (target.status !== 'historical' || client.packageId === target.id) throw new Error('只能切换使用有余额的历史套餐');
    if (this.packageRemaining(target.id) <= 0) throw new Error('该历史套餐没有剩余次数');
    const previousPackageId = client.packageId;
    this.state.packages.filter(item => item.clientId === client.id && item.status === 'current').forEach(item => { item.status = 'historical'; });
    target.status = 'current';
    client.packageId = target.id;
    this._log('package_activated', { clientId: client.id, packageId: target.id, previousPackageId, reason: why }, role);
    return target;
  }

  unitValue(packageId) {
    const pack = this.state.packages.find(item => item.id === packageId);
    if (!pack || !pack.total) throw new Error('套餐不存在或总次数无效');
    return money(pack.amount / pack.total);
  }

  slotValueMinor(packageId, slotNumber) {
    const pack = this.state.packages.find(row => row.id === packageId);
    if (!pack || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > pack.total) throw new Error('套餐次数槽位无效');
    const minor = pack.amountMinor ?? amountMinor(pack.amount);
    const quotient = Math.floor(minor / pack.total), remainder = minor % pack.total;
    return quotient + (slotNumber > pack.total - remainder ? 1 : 0);
  }

  _availableSlot(packageId) {
    const pack = this.state.packages.find(row => row.id === packageId);
    if (!pack) throw new Error('套餐不存在');
    const occupied = new Set(this.state.services.filter(row => row.packageId === packageId && row.status === 'valid').map(row => row.slotNumber));
    for (let slot = pack.openingUsed + 1; slot <= pack.total; slot++) if (!occupied.has(slot)) return slot;
    throw new Error('套餐次数已用完，请先由老板确认套餐');
  }

  nextServiceValue(packageId) {
    const slotNumber = this._availableSlot(packageId);
    const minor = this.slotValueMinor(packageId, slotNumber);
    return { slotNumber, amountMinor: minor, amount: minor / 100 };
  }

  canSeeClient(role, clientId) {
    const client = this.state.clients.find(item => item.id === clientId);
    if (!client) return false;
    if (role?.type === 'boss' && role.id === 'boss') return true;
    if (role?.type === 'customer') return role.id === clientId;
    if (role?.type === 'manager') {
      try { return managerClientInStore(this, client, this.managerStoreId(role)); } catch { return false; }
    }
    if (role?.type === 'frontdesk') {
      const frontDesk = this.state.frontDesks.find(row => row.id === role.id && row.active);
      if (!frontDesk) return false;
      const stores = frontDesk.storeIds;
      return stores.includes(client.storeId) ||
        this.state.packages.some(pack => pack.clientId === clientId && Boolean(pack.storeId) && stores.includes(pack.storeId)) ||
        this.state.appointments.some(row => row.clientId === clientId && stores.includes(row.storeId) && (pendingAppointment(row.status) || Boolean(row.arrivalAt))) ||
        this.state.services.some(row => row.clientId === clientId && stores.includes(row.storeId) && row.status === 'valid');
    }
    if (role?.type !== 'therapist' || !this.state.therapists.some(item => item.id === role.id && item.active)) return false;
    return client.ownerId === role.id || this.state.services.some(item => item.clientId === clientId && item.status === 'valid' && (item.principalId === role.id || item.participantIds.includes(role.id)));
  }

  canSeeEvidence(role, serviceId) {
    if (role?.type === 'frontdesk') return false;
    const service = this.state.services.find(item => item.id === serviceId);
    const client = service && this.state.clients.find(item => item.id === service.clientId);
    if (!service || !client) return false;
    if (role?.type === 'boss') return role.id === 'boss';
    if (role?.type === 'manager') {
      try { return service.storeId === this.managerStoreId(role); } catch { return false; }
    }
    if (role?.type === 'customer') return role.id === client.id;
    if (role?.type !== 'therapist' || !this.state.therapists.some(item => item.id === role.id && item.active)) return false;
    // Evidence access follows this service, including revoked records. Taking
    // part in a different service does not expose another service's photos.
    return client.ownerId === role.id || service.principalId === role.id || service.participantIds.includes(role.id);
  }

  visibleClients(role) {
    if (role?.type === 'manager') return this.managerSnapshot(role).clients;
    const clients = this.state.clients.filter(item => this.canSeeClient(role, item.id));
    if (role?.type === 'frontdesk') return clients.map(({ id, name, phone, age, problem, ownerId, storeId, packageId }) => ({ id, name, phone, age, problem, ownerId, storeId, packageId }));
    return clients;
  }

  reviewRows(role) {
    if (role?.type === 'boss' && role.id === 'boss') return this.state.reviews;
    if (role?.type === 'customer' && this.state.clients.some(client => client.id === role.id)) {
      return this.state.reviews.filter(review => review.clientId === role.id);
    }
    // Being responsible for or participating in a service never grants access
    // to that customer's private rating or the boss's follow-up record.
    return [];
  }

  serviceRows(filters = {}) {
    return this.state.services.filter(item =>
      (!filters.storeId || item.storeId === filters.storeId) &&
      (!filters.therapistId || item.principalId === filters.therapistId) &&
      (!filters.clientId || item.clientId === filters.clientId) &&
      (!filters.from || item.date >= filters.from) &&
      (!filters.to || item.date <= filters.to),
    ).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
  }

  performance(therapistId, filters = {}) {
    return money(this.serviceRows({ ...filters, therapistId }).filter(item => item.status === 'valid').reduce((total, item) => total + item.amount, 0));
  }

  collaborationRows(therapistId, filters = {}) {
    const { therapistId: ignored, ...remainingFilters } = filters;
    return this.serviceRows(remainingFilters).filter(item => item.status === 'valid' && item.participantIds.includes(therapistId));
  }

  pendingAppointments(role, filters = {}) {
    return this.state.appointments.filter(item =>
      pendingAppointment(item.status) && item.date < this.today &&
      (role?.type !== 'frontdesk' || this.state.frontDesks.some(row => row.id === role.id && row.active && row.storeIds.includes(item.storeId))) &&
      (role?.type !== 'manager' || item.storeId === this.managerStoreId(role)) &&
      this.canSeeClient(role, item.clientId) && (role.type !== 'therapist' || item.principalId === role.id || (item.status === 'pending_reassignment' && this._client(item.clientId).ownerId === role.id)) &&
      (!filters.storeId || item.storeId === filters.storeId) &&
      (!filters.therapistId || item.principalId === filters.therapistId) &&
      (!filters.from || item.date >= filters.from) && (!filters.to || item.date <= filters.to),
    ).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  }

  registerService(data, role) {
    const client = this._staff(role, data.clientId);
    const requestId = required(data.requestId, '提交标识', 80);
    if (data.participantIds !== undefined && (!Array.isArray(data.participantIds) || data.participantIds.length > 99 || data.participantIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 80))) throw new Error('参与康复师须填写有效的人员标识数组');
    const input = {
      clientId: client.id, storeId: required(data.storeId, '服务门店', 80),
      date: validDate(data.date), time: validTime(data.time), project: required(data.project, '服务项目', 120),
      principalId: required(data.principalId, '主康复师', 80),
      participantIds: [...new Set(data.participantIds || [])].filter(id => id !== data.principalId).sort(),
      notes: required(data.notes, '本次服务记录'),
      evidencePhotos: serviceEvidencePhotos(data.evidencePhotos),
    };
    if (String(data.appointmentId || '').trim()) input.appointmentId = String(data.appointmentId).trim();
    if (data.packageId !== undefined && data.packageId !== '') input.packageId = required(data.packageId, '本次使用套餐', 80);
    const existing = this.state.services.find(item => item.requestId === requestId && item.recordedBy === role.id);
    if (existing) {
      if (!existing.inputKey) throw new Error('历史服务记录不能重复提交，请重新打开登记表');
      const replayKey = JSON.stringify({ ...input, packageId: input.packageId || existing.packageId });
      if (existing.inputKey !== replayKey) throw new Error('同一提交请求的内容发生变化，请重新打开登记表');
      return existing;
    }
    if (input.date > this.today) throw new Error('不能登记尚未发生的未来服务');
    this._assertServiceStarted(input.date, input.time);
    this._store(input.storeId);
    this._therapist(input.principalId);
    input.participantIds.forEach(id => this._therapist(id));
    if (this.state.services.some(item => item.status === 'valid' && item.clientId === client.id && item.date === input.date && item.time === input.time)) {
      throw new Error('同一客户此时间已登记有效服务，不能重复扣次数，请先核对原记录');
    }
    const activeService = appointment => this.state.services.some(item => item.status === 'valid' &&
      (item.appointmentId === appointment.id || item.id === appointment.serviceId));
    const sameSlot = appointment => ['clientId', 'date', 'time', 'storeId', 'principalId'].every(key => appointment[key] === input[key]);
    let appointment;
    if (input.appointmentId) {
      appointment = this.state.appointments.find(item => item.id === input.appointmentId);
      if (!appointment) throw new Error('预约记录不存在');
      if (appointment.clientId !== client.id) throw new Error('预约与服务客户不一致');
      if (activeService(appointment)) throw new Error('该预约已登记有效服务，不能重复扣次数');
      if (!['confirmed', 'reschedule_requested'].includes(appointment.status)) throw new Error('该预约已结束，请重新安排预约后登记');
      if (!sameSlot(appointment) || appointment.project !== input.project) throw new Error('服务日期、时间、门店、主康复师和项目须与所选预约一致');
    } else {
      const matches = this.state.appointments.filter(sameSlot);
      if (matches.some(activeService)) throw new Error('此时间的预约已登记有效服务，不能重复扣次数');
      if (matches.some(item => ['cancelled', 'no_show', 'completed'].includes(item.status))) throw new Error('此时间的预约已结束，请重新安排并选择新的预约登记');
      const unresolved = matches.filter(item => ['confirmed', 'reschedule_requested'].includes(item.status));
      if (unresolved.length > 1) throw new Error('此时间存在多条待处理预约，请选择具体预约登记');
      appointment = unresolved[0];
      if (appointment && appointment.project !== input.project) throw new Error('服务项目须与所选预约一致，请先核对或调整预约');
      if (matches.some(item => item.status === 'pending_reassignment')) throw new Error('该预约需要重新分配康复师，请先确认新的服务安排');
    }
    let pack;
    if (input.packageId) {
      pack = this.state.packages.find(item => item.id === input.packageId && item.clientId === client.id);
      if (!pack) throw new Error('请选择该客户本人的套餐');
      const boundStore = this._packageStoreId(pack);
      if (boundStore && boundStore !== input.storeId) throw new Error('该套餐只能在办卡门店使用，不能跨店扣次数');
      if (!['current', 'historical'].includes(pack.status) || (!boundStore && (pack.id !== client.packageId || pack.status !== 'current'))) throw new Error('该套餐当前不可使用，请先由老板核对');
      if (this.packageRemaining(pack.id) < 1) throw new Error('该套餐次数已用完，请先由老板确认套餐');
    } else {
      pack = this.availablePackages(client.id, input.storeId).find(item => this.packageRemaining(item.id) > 0);
      if (!pack) throw new Error('本店没有可用套餐次数，请先核对办卡门店或办理本店套餐');
    }
    const value = this.nextServiceValue(pack.id);
    input.packageId = pack.id;
    const inputKey = JSON.stringify(input);
    const recordedAt = this._timestamp();
    const row = {
      id: this._id('s'), ...input, packageId: pack.id, ownerId: client.ownerId,
      recordedBy: role.id, ...value, sessions: 1,
      evidencePhotos: input.evidencePhotos.map(photo => ({ ...photo, recordedAt, recordedBy: role.id })),
      status: 'valid', requestId, inputKey, createdAt: recordedAt, recordedAt,
    };
    this.state.services.unshift(row);
    if (appointment) row.appointmentId = appointment.id;
    row.appointmentSnapshots = appointment ? [{ id: appointment.id, status: appointment.status, request: copy(appointment.request ?? null), requestNote: appointment.requestNote || '' }] : [];
    row.appointmentSnapshots.forEach(snapshot => {
      const appointment = this.state.appointments.find(item => item.id === snapshot.id);
      appointment.status = 'completed';
      appointment.serviceId = row.id;
    });
    row.taskSnapshots = appointment ? this.state.tasks.filter(item => item.appointmentId === appointment.id &&
      item.status === 'pending' && ['reschedule', 'service_note'].includes(item.type)).map(item => ({ id: item.id, before: copy(item) })) : [];
    row.taskSnapshots.forEach(snapshot => {
      const task = this.state.tasks.find(item => item.id === snapshot.id);
      task.status = 'completed';
      task.completedBy = role.id;
      task.completedAt = row.createdAt;
      task.completedByServiceId = row.id;
    });
    this._log('service_registered', { serviceId: row.id, clientId: client.id, amount: row.amount,
      evidencePhotoIds: row.evidencePhotos.map(photo => photo.id), evidencePhotoCount: row.evidencePhotos.length }, role);
    return row;
  }

  revokeService(id, reason, role) {
    this._boss(role);
    const why = required(reason, '撤销原因');
    const row = this.state.services.find(item => item.id === id);
    if (!row) throw new Error('服务记录不存在');
    if (row.status === 'revoked') throw new Error('该服务记录已撤销，不能重复恢复次数');
    row.status = 'revoked';
    row.revokeReason = why;
    row.revokedBy = role.id;
    row.revokedAt = this._timestamp();
    (row.appointmentSnapshots || []).forEach(snapshot => {
      const appointment = this.state.appointments.find(item => item.id === snapshot.id);
      if (appointment?.status === 'completed' && appointment.serviceId === row.id) {
        appointment.status = snapshot.status;
        appointment.request = copy(snapshot.request ?? null);
        appointment.requestNote = snapshot.requestNote || '';
        delete appointment.serviceId;
        this._validateAppointmentAssignment(appointment, '原服务已撤销，请核对当前负责人与执行人员');
      }
    });
    (row.taskSnapshots || []).forEach(snapshot => {
      const task = this.state.tasks.find(item => item.id === snapshot.id);
      if (task?.status === 'completed' && task.completedByServiceId === row.id) {
        task.status = snapshot.before.status;
        for (const field of ['completedBy', 'completedAt', 'completedByServiceId']) {
          if (Object.hasOwn(snapshot.before, field)) task[field] = snapshot.before[field];
          else delete task[field];
        }
        if (task.assigneeId !== 'boss' && !this.canSeeClient({ type: 'therapist', id: task.assigneeId }, task.clientId)) {
          task.previousAssigneeId = task.assigneeId;
          const owner = this._client(task.clientId).ownerId;
          task.assigneeId = this.canSeeClient({ type: 'therapist', id: owner }, task.clientId) ? owner : 'boss';
          task.reassignmentReason = '原服务已撤销，待办转交当前有权限的负责人';
        }
      }
    });
    this._log('service_revoked', { serviceId: id, clientId: row.clientId, reason: why, reversedAmount: row.amount }, role);
    return row;
  }

  publishPlan(clientId, data, role) {
    const client = this._staff(role, clientId);
    if (role.type !== 'boss' && client.ownerId !== role.id) throw new Error('仅负责康复师或老板有权限发布计划');
    const next = {
      goal: required(data.goal, '康复目标'), phase: required(data.phase, '当前阶段'),
      nextStep: required(data.nextStep, '下一步安排'), planNotes: required(data.planNotes, '计划内容'),
      homeAdvice: required(data.homeAdvice, '居家指导'),
    };
    if (data.progress) {
      next.progress = copy(data.progress);
      if (!['pending', 'updated'].includes(next.progress.status) || !Array.isArray(next.progress.metrics)) throw new Error('请填写有效的康复进展记录');
      if (next.progress.status === 'updated' && !String(next.progress.summary || '').trim()) throw new Error('请填写阶段复评说明');
      next.progressUpdatedAt = next.progress.status === 'updated' ? this.today : null;
    }
    let nextTask = null;
    if (String(data.taskTitle || '').trim()) {
      const assigneeId = data.assigneeId || client.ownerId;
      if (assigneeId !== 'boss') {
        this._therapist(assigneeId);
        if (!this.canSeeClient({ type: 'therapist', id: assigneeId }, clientId)) throw new Error('待办负责人尚未负责或参与过此客户的有效服务，请先由老板转交客户负责人，再安排待办');
      }
      nextTask = { clientId, title: String(data.taskTitle).trim(), dueDate: validDate(data.dueDate), assigneeId, status: 'pending', type: 'plan' };
    }
    const before = copy(client);
    Object.assign(client, next, { planVersion: (client.planVersion || 1) + 1 });
    if (nextTask) this.state.tasks.push({ id: this._id('task'), ...nextTask });
    this._log('plan_published', { clientId, before, after: copy(client) }, role);
    return client;
  }

  saveAppointment(data, role) {
    const client = this._bookingActor(role, data.clientId, data.storeId);
    const input = {
      clientId: client.id, date: validDate(data.date), time: validTime(data.time),
      storeId: required(data.storeId, '服务门店'), principalId: required(data.principalId, '服务康复师'),
      project: required(data.project, '服务项目'),
    };
    if (input.date < this.today) throw new Error('不能预约过去的日期');
    this._store(input.storeId);
    this._therapist(input.principalId);
    if (!this.canSeeClient({ type: 'therapist', id: input.principalId }, client.id)) throw new Error('服务康复师尚未负责或参与过此客户的有效服务，请先由老板转交客户负责人，再安排服务');
    const existing = data.id ? this.state.appointments.find(item => item.id === data.id) : null;
    if (data.id && !existing) throw new Error('预约记录不存在');
    if (existing) this._bookingActor(role, existing.clientId, existing.storeId);
    if (existing && existing.clientId !== client.id) throw new Error('不能将预约转给其他客户');
    if (existing && !pendingAppointment(existing.status)) throw new Error('该预约已结束或已取消，不能编辑，请重新安排服务');
    if (existing?.arrivalAt && ['date', 'time', 'storeId'].some(key => existing[key] !== input[key])) throw new Error('此预约已到店，不能搬移到其他时间或门店，请先核对原预约后重新安排新预约');
    assertScheduleAvailability(this, input);
    const conflict = this.state.appointments.find(item => item.id !== data.id && pendingAppointment(item.status) && item.date === input.date && Math.abs(minutes(item.time) - minutes(input.time)) < 60 && (item.principalId === input.principalId || item.clientId === input.clientId));
    if (conflict) throw new Error('此时间与已有预约冲突，请检查康复师跨店安排及客户时间');
    const before = existing ? copy(existing) : null;
    const row = existing || { id: this._id('a') };
    Object.assign(row, input, { status: 'confirmed', requestNote: '', request: null });
    delete row.reassignmentReason;
    if (!existing) this.state.appointments.push(row);
    this.state.tasks.filter(item => item.appointmentId === row.id && item.type === 'reschedule').forEach(item => { item.status = 'completed'; });
    this._log('appointment_saved', { appointmentId: row.id, clientId: client.id, before, after: copy(row) }, role);
    return row;
  }

  saveAppointmentBatch(data, role) {
    if (!Array.isArray(data.items) || data.items.length < 2 || data.items.length > 20) throw new Error('一起预约需安排2至20位不同客户');
    const input = {
      storeId: required(data.storeId, '服务门店', 80), date: validDate(data.date), time: validTime(data.time),
      project: required(data.project, '服务项目', 120),
      items: data.items.map(item => ({clientId:required(item?.clientId,'客户',80),principalId:required(item?.principalId,'服务康复师',80)})),
    };
    if (!/:(00|30)$/.test(input.time)) throw new Error('一起预约请选择整点或半点开始时间');
    if (new Set(input.items.map(item => item.clientId)).size !== input.items.length) throw new Error('同一组不能重复选择客户，请每人使用自己的档案');
    if (new Set(input.items.map(item => item.principalId)).size !== input.items.length) throw new Error('每位客户须安排不同康复师，不能同一时间重复占用');
    const requestId = required(data.requestId, '提交标识', 80);
    input.items.forEach(item => this._bookingActor(role,item.clientId,input.storeId));
    const inputKey = JSON.stringify(input);
    const existing = this.state.appointmentBatches.find(batch => batch.requestId === requestId && batch.recordedBy === role.id && batch.recordedRole === role.type);
    if (existing) {
      if (existing.inputKey !== inputKey) throw new Error('同一提交请求的预约内容发生变化，请重新打开一起预约');
      const rows = existing.appointmentIds.map(id => this.state.appointments.find(row => row.id === id));
      for (const row of rows) {
        if (!row) throw new Error('原同行预约记录不完整，请由老板核对');
        this._bookingActor(role,row.clientId,row.storeId);
      }
      return rows;
    }
    // Stage only the collections this operation writes. Service photos and
    // financial records remain shared read-only, keeping mobile saves light.
    const staged = Object.assign(Object.create(Object.getPrototypeOf(this)), this, {state:{
      ...this.state, appointments:[...this.state.appointments], tasks:this.state.tasks.map(copy),
      audit:[...this.state.audit], appointmentBatches:[...this.state.appointmentBatches],
    }});
    const groupId = staged._id('group');
    const rows = input.items.map((item,index) => {
      try {
        const row = staged.saveAppointment({...input,...item,items:undefined},role);
        row.groupId = groupId;
        return row;
      } catch (error) { throw new Error(`第${index + 1}位客户：${error.message}。整组预约未保存`); }
    });
    staged.state.appointmentBatches.push({id:groupId,requestId,inputKey,recordedBy:role.id,recordedRole:role.type,appointmentIds:rows.map(row=>row.id),createdAt:staged._timestamp()});
    staged._log('appointment_batch_saved',{groupId,storeId:input.storeId,appointmentIds:rows.map(row=>row.id)},role);
    this.state = staged.state;
    this.sequence = staged.sequence;
    return rows;
  }

  _closeAppointmentTasks(appointment, reason, role) {
    const completedAt = this._timestamp();
    const tasks = this.state.tasks.filter(task => task.appointmentId === appointment.id &&
      task.status === 'pending' && ['reschedule', 'service_note'].includes(task.type));
    tasks.forEach(task => {
      task.status = 'completed';
      task.completedBy = role.id;
      task.completedAt = completedAt;
      task.closedByAppointmentStatus = appointment.status;
      task.completionReason = reason;
    });
    return tasks.map(task => task.id);
  }

  _validateAppointmentAssignment(appointment, reason) {
    if (pendingAppointment(appointment.status) && !this.canSeeClient({ type: 'therapist', id: appointment.principalId }, appointment.clientId)) {
      appointment.status = 'pending_reassignment';
      appointment.reassignmentReason = reason;
    }
    if (pendingAppointment(appointment.status)) {
      try { assertScheduleAvailability(this, appointment); }
      catch (error) { appointment.status = 'pending_reassignment'; appointment.reassignmentReason = `${reason}；当前排班需重新安排：${error.message}`; }
    }
    return appointment;
  }

  cancelAppointment(id, reason, role) {
    const row = this.state.appointments.find(item => item.id === id);
    if (!row) throw new Error('预约记录不存在');
    this._bookingActor(role, row.clientId, row.storeId);
    if (!pendingAppointment(row.status)) throw new Error('该预约已结束或已取消');
    row.cancelReason = required(reason, '取消原因');
    row.status = 'cancelled';
    const closedTaskIds = this._closeAppointmentTasks(row, row.cancelReason, role);
    this._log('appointment_cancelled', { appointmentId: id, clientId: row.clientId, reason: row.cancelReason, closedTaskIds }, role);
    return row;
  }

  markNoShow(id, reason, role) {
    const row = this.state.appointments.find(item => item.id === id);
    if (!row) throw new Error('预约记录不存在');
    this._bookingActor(role, row.clientId, row.storeId);
    if (role.type !== 'boss' && role.type !== 'frontdesk' && row.principalId !== role.id) throw new Error('仅当次主康复师、授权前台或老板有权限确认未到店');
    if (!['confirmed', 'reschedule_requested'].includes(row.status)) throw new Error('该预约已结束，不能重复确认未到店');
    if (row.arrivalAt) throw new Error('此预约已经确认到店，不能再确认未到店，请联系老板核对原记录');
    if (row.date > this.today) throw new Error('未来预约尚未发生，不能确认未到店');
    this._assertServiceStarted(row.date, row.time);
    const why = required(reason, '未到店原因');
    row.status = 'no_show';
    row.noShowReason = why;
    row.noShowBy = role.id;
    row.noShowAt = this._timestamp();
    const closedTaskIds = this._closeAppointmentTasks(row, why, role);
    this._log('appointment_no_show', { appointmentId: id, clientId: row.clientId, reason: why, closedTaskIds }, role);
    return row;
  }

  recordArrival(id, data, role) {
    if (role?.type === 'boss') this._boss(role);
    else if (role?.type === 'frontdesk') this._frontDesk(role.id);
    else throw new Error('仅老板和授权门店前台有权限确认到店');
    const row = this.state.appointments.find(item => item.id === id);
    if (!row) throw new Error('预约记录不存在');
    this._bookingActor(role, row.clientId, row.storeId);
    const requestId = required(data.requestId, '到店提交标识', 80), notes = optionalText(data.notes, '到店备注', 1000);
    if (row.date !== this.today) throw new Error('只能确认今天预约的实际到店；过去或未来日期请先核对服务安排，目前不支持补录历史到店');
    if (row.arrivalAt) return row;
    if (this.state.appointments.some(item => item.id !== id && item.arrivalBy === role.id && item.arrivalRequestId === requestId)) throw new Error('此到店提交请求已用于另一预约，请使用新的提交标识');
    if (!['confirmed', 'reschedule_requested'].includes(row.status)) throw new Error('只能确认当前已安排的预约到店，该预约已结束或需要重新安排');
    const stamp = this._timestamp();
    row.arrivalAt = stamp; row.arrivalBy = role.id; row.arrivalByRole = role.type;
    row.arrivalNotes = notes; row.arrivalRequestId = requestId;
    this._log('appointment_arrived', { appointmentId: row.id, clientId: row.clientId, storeId: row.storeId, arrivalAt: stamp, notes }, role);
    return row;
  }

  requestReschedule(id, data, role) {
    const row = this.state.appointments.find(item => item.id === id);
    if (!row) throw new Error('预约记录不存在');
    if (role?.type !== 'customer' || role.id !== row.clientId) throw new Error('仅客户本人有权限提交改约申请');
    if (!pendingAppointment(row.status)) throw new Error('此预约已结束或已取消，不能改约');
    if (row.arrivalAt) throw new Error('此预约已经到店，请联系门店核对安排，需要改期时重新安排新预约');
    const request = { date: validDate(data.date), time: validTime(data.time), reason: required(data.reason || data.requestNote, '改约说明') };
    if (request.date < this.today) throw new Error('不能改约到过去的日期');
    assertScheduleAvailability(this, {...row,...request});
    if (row.status !== 'pending_reassignment') row.status = 'reschedule_requested';
    row.request = request;
    row.requestNote = request.reason;
    const existingTask = this.state.tasks.find(item => item.appointmentId === id && item.type === 'reschedule' && item.status === 'pending');
    if (existingTask) existingTask.title = `确认${this._client(row.clientId).name}的改约申请`;
    else this.state.tasks.push({ id: this._id('task'), clientId: row.clientId, appointmentId: id, title: `确认${this._client(row.clientId).name}的改约申请`, type: 'reschedule', assigneeId: this._client(row.clientId).ownerId, dueDate: this.today, status: 'pending' });
    this._log('reschedule_requested', { appointmentId: id, clientId: row.clientId, request }, role);
    return row;
  }

  completeTask(id, role) {
    const row = this.state.tasks.find(item => item.id === id);
    if (!row) throw new Error('待办事项不存在');
    if (row.type === 'review_followup') this._boss(role);
    if (role?.type === 'boss') this._boss(role);
    else if (role?.type !== 'therapist' || role.id !== row.assigneeId || !this.canSeeClient(role, row.clientId)) throw new Error('仅待办负责人或老板有权限完成');
    const appointment = this.state.appointments.find(item => item.id === row.appointmentId);
    if (row.type === 'service_note' && (!appointment || appointment.status !== 'completed' || !this.state.services.some(service => service.status === 'valid' && service.appointmentId === appointment.id))) throw new Error('请先按预约登记真实服务，再完成服务记录待办；没有预约时请由老板核对');
    if (row.type === 'reschedule' && (!appointment || ['reschedule_requested', 'pending_reassignment'].includes(appointment.status))) throw new Error('请先确认新的预约时间或取消预约，再完成此待办');
    if (row.type === 'review_followup' && this.state.reviews.find(item => item.id === row.reviewId)?.followupStatus !== 'closed') throw new Error('请先填写反馈处理结果，再完成此待办');
    delete row.completedByServiceId;
    row.status = 'completed';
    row.completedBy = role.id;
    row.completedAt = this._timestamp();
    this._log('task_completed', { taskId: id, clientId: row.clientId }, role);
    return row;
  }

  submitReview(serviceId, data, role) {
    const service = this.state.services.find(item => item.id === serviceId);
    if (!service) throw new Error('服务记录不存在');
    if (role?.type !== 'customer' || role.id !== service.clientId) throw new Error('仅客户本人有权限评价本次服务');
    if (service.status !== 'valid' || service.date > this.today) throw new Error('仅有效且已完成的服务可以评价');
    if (this.state.reviews.some(item => item.serviceId === serviceId)) throw new Error('本次服务已评价，每次服务只能评价一次');
    const score = Number(data.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('请选择 1 至 5 分的评分');
    const wantContact = Boolean(data.wantContact);
    const followup = score <= 3 || wantContact;
    const row = {
      id: this._id('r'), serviceId, clientId: service.clientId, score,
      feedback: String(data.feedback ?? '').trim(), wantContact,
      followupStatus: followup ? 'pending' : 'none', createdAt: this._timestamp(),
    };
    this.state.reviews.unshift(row);
    if (followup) this.state.tasks.push({ id: this._id('task'), type: 'review_followup', reviewId: row.id, clientId: row.clientId, title: `跟进${this._client(row.clientId).name}的服务反馈`, assigneeId: 'boss', dueDate: this.today, status: 'pending' });
    this._log('review_submitted', { reviewId: row.id, serviceId, clientId: row.clientId, score }, role);
    return row;
  }

  closeFollowup(reviewId, resolution, role) {
    this._boss(role);
    const row = this.state.reviews.find(item => item.id === reviewId);
    if (!row) throw new Error('反馈不存在');
    if (row.followupStatus !== 'pending') throw new Error('此反馈没有待处理跟进');
    row.resolution = required(resolution, '反馈处理结果');
    row.followupStatus = 'closed';
    row.resolvedBy = role.id;
    row.resolvedAt = this._timestamp();
    this.state.tasks.filter(item => item.reviewId === reviewId).forEach(item => { item.status = 'completed'; item.completedBy = role.id; });
    this._log('review_followup_closed', { reviewId, clientId: row.clientId, resolution: row.resolution }, role);
    return row;
  }

  addStore(data, role) {
    this._boss(role);
    const name = required(data.name, '门店名称');
    if (this.state.stores.some(item => item.name === name)) throw new Error('门店名称重复，请使用可区分的名称');
    const row = { id: this._id('store'), name, address: required(data.address, '门店地址') };
    this.state.stores.push(row);
    this._log('store_added', { storeId: row.id, after: row }, role);
    return row;
  }

  addTherapist(data, role) {
    this._boss(role);
    this._store(data.storeId);
    const row = { id: this._id('t'), name: required(data.name, '康复师姓名'), storeId: data.storeId, active: true };
    this.state.therapists.push(row);
    this._log('therapist_added', { therapistId: row.id, after: row }, role);
    return row;
  }

  addFrontDesk(data, role) {
    this._boss(role);
    const name = required(data.name, '前台姓名', 80), storeIds = this._frontDeskStoreIds(data.storeIds);
    const row = { id: this._id('f'), name, storeIds, active: true };
    this.state.frontDesks.push(row);
    this._log('frontdesk_added', { frontDeskId: row.id, after: copy(row) }, role);
    return row;
  }

  addStoreManager(data, role) {
    this._boss(role);
    const name = required(data.name, '店长姓名', 80);
    const store = this._store(required(data.storeId, '负责门店', 80));
    const row = { id: this._id('m'), name, storeId: store.id, active: true };
    this.state.storeManagers.push(row);
    this._log('manager_added', { managerId: row.id, storeId: store.id }, role);
    return row;
  }

  deactivateStoreManager(id, role) {
    this._boss(role);
    this.managerStoreId({ type: 'manager', id });
    const row = this.state.storeManagers.find(item => item.id === id);
    row.active = false;
    this._log('manager_deactivated', { managerId: id, storeId: row.storeId }, role);
    return row;
  }

  deactivateFrontDesk(id, role) {
    this._boss(role);
    const row = this._frontDesk(id);
    row.active = false;
    this._log('frontdesk_deactivated', { frontDeskId: id }, role);
    return row;
  }

  deactivateTherapist(id, role) {
    this._boss(role);
    const row = this._therapist(id);
    if (this.state.clients.some(item => item.ownerId === id)) throw new Error('该康复师仍有负责客户，请先转交客户再停用');
    if (this.state.appointments.some(item => item.principalId === id && pendingAppointment(item.status))) throw new Error('该康复师仍有预约，请先改派或取消预约再停用');
    if (this.state.tasks.some(item => item.assigneeId === id && item.status === 'pending')) throw new Error('该康复师仍有未完成待办，请先处理后再停用');
    row.active = false;
    this._log('therapist_deactivated', { therapistId: id }, role);
    return row;
  }

  transferClient(clientId, newOwnerId, reason, role) {
    this._boss(role);
    const client = this._client(clientId);
    this._therapist(newOwnerId);
    const why = required(reason, '转交原因');
    const oldOwnerId = client.ownerId;
    if (oldOwnerId === newOwnerId) throw new Error('新负责人和当前负责人相同');
    client.ownerId = newOwnerId;
    this.state.tasks.filter(item => item.clientId === clientId && item.assigneeId === oldOwnerId && item.status === 'pending').forEach(item => { item.assigneeId = newOwnerId; });
    this.state.appointments.filter(item => item.clientId === clientId && pendingAppointment(item.status)).forEach(item => this._validateAppointmentAssignment(item, '客户负责人已转交，请核对新的服务安排'));
    this._log('client_transferred', { clientId, oldOwnerId, newOwnerId, reason: why }, role);
    return client;
  }

  importOpening(data, role) {
    this._boss(role);
    const name = required(data.name, '客户姓名', 80);
    const phone = required(data.phone, '手机号', 20).replace(/\s/g, '');
    if (!/^1\d{10}$/.test(phone)) throw new Error('请输入 11 位手机号');
    if (this.state.clients.some(item => item.phone === phone)) throw new Error('该手机号已存在，请核对原客户档案，避免重复迁入');
    this._therapist(data.ownerId);
    this._store(data.storeId);
    const minor = amountMinor(data.amount), total = count(data.total, '套餐总次数');
    const remaining = count(data.remaining ?? data.openingRemaining, '套餐剩余次数', 0, total);
    if (minor < total) throw new Error('套餐金额不能少于总次数对应的分金额');
    const packageName = required(data.packageName === undefined ? '运动功能恢复套餐' : data.packageName, '套餐名称', 80);
    const sourceNotes = required(data.notes, '原档案核对说明');
    const clientId = this._id('c'), packageId = this._id('p');
    const client = seedClient(clientId, name, data.ownerId, data.storeId, packageId, phone);
    client.openingNotes = sourceNotes;
    client.phase = '待康复师确认';
    client.nextStep = '由负责康复师核对原档案并完善康复计划';
    client.planNotes = '历史档案已迁入，康复计划待负责康复师确认后发布。';
    client.homeAdvice = '待负责康复师核对后补充';
    if (String(data.goal || '').trim()) client.goal = String(data.goal).trim();
    const pack = { id: packageId, clientId, storeId: data.storeId, name: packageName, amount: minor / 100, amountMinor: minor, total, openingUsed: total - remaining, status: 'current' };
    this.state.clients.push(client);
    this.state.packages.push(pack);
    this._log('opening_import', { clientId, packageId, total, remaining, openingUsed: total - remaining, sourceNotes, note: '纸质期初余额迁入，不计入系统消费业绩' }, role);
    return client;
  }
}
