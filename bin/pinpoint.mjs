#!/usr/bin/env node
/** pinpoint CLI 壳：参数层与逻辑都在 ./pinpoint-cli.js（node --test 覆盖），这里只接进程 IO。 */
import { runAdd } from './pinpoint-cli.js';

const code = await runAdd(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
});
process.exit(code);
