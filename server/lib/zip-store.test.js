import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32, zipStore } from './zip-store.js';

// 最小读取端：只够校验 store-only 包的结构（local header 顺序 + EOCD 计数 +
// 中央目录回读），不追求通用解压。
function readEntries(zip) {
  const eocdOffset = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocdOffset), 0x06054b50, 'EOCD signature');
  const count = zip.readUInt16LE(eocdOffset + 10);
  const cdOffset = zip.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let cursor = cdOffset;
  for (let index = 0; index < count; index += 1) {
    assert.equal(zip.readUInt32LE(cursor), 0x02014b50, 'central header signature');
    const crc = zip.readUInt32LE(cursor + 16);
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, 'local header signature');
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + size);
    entries.push({ name, crc, data });
    cursor += 46 + nameLength;
  }
  assert.equal(cursor, cdOffset + zip.readUInt32LE(eocdOffset + 12), 'central directory size');
  return entries;
}

test('crc32 matches the standard check vectors', () => {
  assert.equal(crc32(Buffer.from('')), 0);
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('zipStore writes magic bytes, member count, and round-trips data', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const zip = zipStore([
    { name: 'library__brew-flow__recipe@2x.png', data: png, date: new Date('2026-08-15T12:00:00') },
    { name: 'library__brew-flow__timer@2x.png', data: Buffer.from('second member') },
  ]);
  assert.equal(zip.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.equal(zip.readUInt16LE(zip.length - 22 + 10), 2, 'EOCD member count');
  const entries = readEntries(zip);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].name, 'library__brew-flow__recipe@2x.png');
  assert.deepEqual(entries[0].data, png);
  assert.equal(entries[0].crc, crc32(png));
  assert.deepEqual(entries[1].data, Buffer.from('second member'));
});

test('zipStore keeps UTF-8 names with the EFS flag set', () => {
  const zip = zipStore([{ name: '页面__锁屏@2x.png', data: Buffer.from('x') }]);
  assert.equal(zip.readUInt16LE(6) & 0x0800, 0x0800, 'UTF-8 flag on the local header');
  const entries = readEntries(zip);
  assert.equal(entries[0].name, '页面__锁屏@2x.png');
});

test('zipStore stores without compression (method 0, size in == size out)', () => {
  const payload = Buffer.alloc(4096, 7);
  const zip = zipStore([{ name: 'big@2x.png', data: payload }]);
  assert.equal(zip.readUInt16LE(8), 0, 'store method');
  const entries = readEntries(zip);
  assert.equal(entries[0].data.length, payload.length);
  // store：包体必含原始字节流本体（local header 30 + name + data）
  assert.ok(zip.length > payload.length + 30);
});

test('zipStore rejects malformed entries loudly', () => {
  assert.throws(() => zipStore('nope'), TypeError);
  assert.throws(() => zipStore([{ data: Buffer.from('x') }]), TypeError);
  assert.throws(() => zipStore([{ name: '', data: Buffer.from('x') }]), TypeError);
});

test('zipStore produces a valid empty archive for zero entries', () => {
  const zip = zipStore([]);
  assert.equal(zip.length, 22, 'EOCD only');
  assert.equal(zip.readUInt16LE(10), 0);
  assert.deepEqual(readEntries(zip), []);
});
