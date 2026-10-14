// 多个 spec 共用的 ppnt 子进程：指向本轮 e2e 的数据目录、registry 和服务。
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from '../env.js';

/** 仓库根。 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const execFileP = promisify(execFile);

// PINPOINT_ORIGIN 总是设：不设时 CLI 回落到常驻服务 https://pinpoint.localhost，
// 探活、重读 registry、截图会打到 owner 的服务上。
async function run(args, timeout) {
  // process.execPath：playwright worker 的 PATH 不一定带 node。
  return execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
    cwd: ROOT,
    env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
    ...(timeout ? { timeout } : {}),
  });
}

/** 跑一次 ppnt，返回 { code: 0, stdout, stderr }；非 0 退出时抛错，
 *  除非 expectFail，那时返回 { code, stdout, stderr }。timeout 毫秒，缺省不限。 */
export async function ppnt(args, { expectFail = false, timeout } = {}) {
  try {
    const { stdout, stderr } = await run(args, timeout);
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (!expectFail) throw error;
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

/** 同 ppnt，但从不抛错：失败也返回 { code, stdout, stderr }，由用例自己断言退出码。 */
export function ppntResult(args, { timeout } = {}) {
  return ppnt(args, { expectFail: true, timeout });
}
