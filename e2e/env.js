import os from 'node:os';
import path from 'node:path';

export const E2E_DATA_DIR = path.join(os.tmpdir(), 'ios-preview-playwright-annotations');
