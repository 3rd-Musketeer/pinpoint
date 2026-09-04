// Store-only ZIP writer（decisions 2026-08-15d 导出 picker 收敛，多张打包 zip）。
// PNG 本身已是压缩流，再 deflate 只费 CPU 不省字节 ——  entries 一律 method 0
// (store)。零依赖手写：local header + central directory + EOCD + CRC32，约百行，
// 避免为一条端点引入 jszip。成员名按 UTF-8 编码并打 EFS 旗标（general purpose
// bit 11），macOS Finder / unzip / Windows 资源管理器都能正确解出中文名。

const LOCAL_HEADER_SIG = 0x04034b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const VERSION = 20; // PKZIP 2.0 — UTF-8 旗标需要的最低版本
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const MAX_UINT32 = 0xffffffff;

// CRC-32（IEEE 802.3，poly 0xEDB88320）查表实现。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let index = 0; index < buffer.length; index += 1) {
    crc = CRC_TABLE[(crc ^ buffer[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// MS-DOS 日期/时间对（ZIP 原生时间格式）；1980-01-01 之前的值钳到起点。
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

/**
 * entries: [{ name: string, data: Buffer, date?: Date }] → 完整 zip Buffer。
 * 约束（store 格式天然边界）：成员名 UTF-8 ≤ 65535 字节，单文件与总大小 < 4 GiB，
 * 成员数 ≤ 65535 —— 超限直接抛错，不静默写出截断包。
 */
export function zipStore(entries) {
  if (!Array.isArray(entries)) throw new TypeError('zipStore: entries must be an array');
  if (entries.length > 0xffff) throw new RangeError(`zipStore: too many entries (${entries.length})`);
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) {
      throw new TypeError('zipStore: every entry needs a non-empty name');
    }
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    if (name.length > 0xffff) throw new RangeError(`zipStore: name too long (${entry.name})`);
    if (data.length > MAX_UINT32 || offset > MAX_UINT32) {
      throw new RangeError('zipStore: archive exceeds the 4 GiB zip32 limit');
    }
    const crc = crc32(data);
    const { dosDate, dosTime } = dosDateTime(entry.date ? new Date(entry.date) : new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER_SIG, 0);
    central.writeUInt16LE(VERSION, 4); // version made by
    central.writeUInt16LE(VERSION, 6); // version needed
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // central directory disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}
