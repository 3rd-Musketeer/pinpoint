import os from 'node:os';
import path from 'node:path';

// E2E_DATA_DIR is the annotation data ROOT — entry buckets live under it
// (<root>/<entry-id>/). E2E_REGISTRY keeps e2e off the real machine registry.
export const E2E_DATA_DIR = path.join(os.tmpdir(), 'ios-preview-playwright-annotations');
export const E2E_REGISTRY = path.join(os.tmpdir(), 'ios-preview-playwright-registry.json');
