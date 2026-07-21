import fs from 'node:fs';

import { E2E_DATA_DIR } from './env.js';

export default function globalSetup() {
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
}
