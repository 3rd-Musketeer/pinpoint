// 12 节、97 帧；不依赖 owner 的本地项目或账本，任意 checkout 都能重建。
import fs from 'node:fs';
import path from 'node:path';
import { E2E_SITES_DIR } from '../env.js';

export const OWNER_PROJECT = path.join(E2E_SITES_DIR, 'owner-site');
export const OWNER_SOURCE = path.join(OWNER_PROJECT, 'docs/pinpoint/articles/overview');
export const OWNER_PAGE = 'e2e-owner_overview';
export const OWNER_ARTICLE = '/e2e-owner/overview/';
export const OWNER_FRAMES = 97;
export const frameId = n => `flow-${String(n).padStart(3, '0')}`;
export const sectionId = n => `part-${Math.min(12, Math.floor((n - 1) / 8) + 1)}`;

export function writeOwnerFixture() {
  fs.mkdirSync(OWNER_SOURCE, { recursive: true });
  fs.writeFileSync(path.join(OWNER_PROJECT, 'docs/pinpoint/project.json'), JSON.stringify({ id: 'e2e-owner', title: 'Owner 流程验收' }));
  const sections = [];
  for (let s = 1; s <= 12; s++) {
    const ids = [];
    for (let n = (s - 1) * 8 + 1; n <= (s === 12 ? 97 : s * 8); n++) {
      const id = frameId(n);
      ids.push(id);
      // flow-001 / flow-002 保留预览脚本（owner-flows 的交互与红点重置靠它），文章卡片里这两帧留
      // srcdoc iframe；其余 95 帧是纯静态，卡片走 shadow root（E1，2026-10-19）。
      const previewScript = n <= 2 ? `
    <script data-preview-script>{\`
      root.querySelector('[data-owner-action]').addEventListener('click', () => {
        root.querySelector('[data-owner-result]').textContent = '已经确认';
      });
    \`}</script>` : '';
      fs.writeFileSync(path.join(OWNER_SOURCE, `${id}.jsx`), `export default function Flow() {
  return <div className="ios-app"><div className="ios-page" style={{ padding: '24px' }}>
    <h1 data-owner-heading>流程 ${n} 初稿</h1>
    <button data-owner-action type="button">确认流程 ${n}</button>
    <p data-owner-result>尚未确认</p>${previewScript}
  </div></div>;
}
`);
    }
    sections.push(`<Section id="part-${s}" title="流程 ${s}">\n\n第 ${s} 节说明：用户读完正文后打开画布，确认操作之前先看清结果。\n\n<Canvas frames={${JSON.stringify(ids)}} />\n\n</Section>`);
  }
  fs.writeFileSync(path.join(OWNER_SOURCE, 'index.mdx'), `---\ntitle: Owner 大文章验收\nsummary: 12 节、97 帧，覆盖正文与画布的日常操作。\n---\n\n${sections.join('\n\n')}\n`);
}
