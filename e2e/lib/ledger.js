// 多个 spec 共用的账本读写：从盘上读一个桶里的账本、清桶。
// 删桶前先 closeSettled(page)（../ledger-settle.js），否则关页时的保存会把账本写回来。
import fs from 'node:fs';
import path from 'node:path';

import { E2E_DATA_DIR } from '../env.js';

// _seq.json 是 #n 的桶级计数器（M1 起 save 落号必写），不是账本，
// 泄进来会把「恰好这些账本」的断言数多一个。
const isLedger = (name) => name.endsWith('.json') && name !== '_seq.json';

/** 桶目录里的账本文件名；桶不存在时是空数组。 */
export function ledgerNames(bucket) {
  if (!fs.existsSync(bucket)) return [];
  return fs.readdirSync(bucket).filter(isLedger);
}

/** 桶里的账本，{ 文件名: 解析后的账本 }；桶不存在时是空对象。 */
function readLedgers(bucket) {
  const out = {};
  for (const name of ledgerNames(bucket)) {
    out[name] = JSON.parse(fs.readFileSync(path.join(bucket, name), 'utf8'));
  }
  return out;
}

/** 桶里的账本，数组，顺序同 readdir。 */
export function ledgerDocs(bucket) {
  return Object.values(readLedgers(bucket));
}

/** 删掉这些页的标注桶（E2E_DATA_DIR/<页 id>/）。 */
export function clearBuckets(pageIds) {
  for (const id of pageIds) {
    fs.rmSync(path.join(E2E_DATA_DIR, id), { recursive: true, force: true });
  }
}
