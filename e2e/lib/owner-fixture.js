// 12 节、97 帧；不依赖 owner 的本地项目或账本，任意 checkout 都能重建。
// 两篇文章同一套帧形状：overview 每帧带预览脚本（工作台的首开、输入、K1 门按 97 个预览脚本量；
// 文章卡片全部走 iframe 回退），static 是同样 97 帧去掉预览脚本（文章卡片全部挂 shadow root，
// 对应 owner 真实文章的形状：r3 实测的 97 个 dist 帧没有预览脚本）。E1，2026-10-19。
import fs from 'node:fs';
import path from 'node:path';
import { E2E_SITES_DIR } from '../env.js';

export const OWNER_PROJECT = path.join(E2E_SITES_DIR, 'owner-site');
export const OWNER_SOURCE = path.join(OWNER_PROJECT, 'docs/pinpoint/articles/overview');
export const OWNER_PAGE = 'e2e-owner_overview';
export const OWNER_ARTICLE = '/e2e-owner/overview/';
export const OWNER_STATIC_SOURCE = path.join(OWNER_PROJECT, 'docs/pinpoint/articles/static');
export const OWNER_STATIC_ARTICLE = '/e2e-owner/static/';
export const OWNER_UPDATE_SOURCE = path.join(OWNER_PROJECT, 'docs/pinpoint/articles/updates');
export const OWNER_FRAMES = 97;
export const frameId = n => `flow-${String(n).padStart(3, '0')}`;
export const sectionId = n => `part-${Math.min(12, Math.floor((n - 1) / 8) + 1)}`;

function writeArticle(dir, title, previewScript) {
  fs.mkdirSync(dir, { recursive: true });
  const sections = [];
  for (let s = 1; s <= 12; s++) {
    const ids = [];
    for (let n = (s - 1) * 8 + 1; n <= (s === 12 ? 97 : s * 8); n++) {
      const id = frameId(n);
      ids.push(id);
      const script = previewScript ? `
    <script data-preview-script>{\`
      root.querySelector('[data-owner-action]').addEventListener('click', () => {
        root.querySelector('[data-owner-result]').textContent = '已经确认';
      });
    \`}</script>` : '';
      fs.writeFileSync(path.join(dir, `${id}.jsx`), `export default function Flow() {
  return <div className="ios-app"><div className="ios-page" style={{ padding: '24px' }}>
    <h1 data-owner-heading>流程 ${n} 初稿</h1>
    <button data-owner-action type="button">确认流程 ${n}</button>
    <p data-owner-result>尚未确认</p>${script}
  </div></div>;
}
`);
    }
    sections.push(`<Section id="part-${s}" title="流程 ${s}">\n\n第 ${s} 节说明：用户读完正文后打开画布，确认操作之前先看清结果。\n\n<Canvas frames={${JSON.stringify(ids)}} />\n\n</Section>`);
  }
  fs.writeFileSync(path.join(dir, 'index.mdx'), `---\ntitle: ${title}\nsummary: 12 节、97 帧，覆盖正文与画布的日常操作。\n---\n\n${sections.join('\n\n')}\n`);
}

export function writeOwnerFixture() {
  fs.mkdirSync(path.join(OWNER_PROJECT, 'docs/pinpoint'), { recursive: true });
  fs.writeFileSync(path.join(OWNER_PROJECT, 'docs/pinpoint/project.json'), JSON.stringify({ id: 'e2e-owner', title: 'Owner 流程验收' }));
  writeArticle(OWNER_SOURCE, 'Owner 大文章验收', true);
  writeArticle(OWNER_STATIC_SOURCE, 'Owner 静态大文章验收', false);
  // 通知回归只需两种挂载路径，避免用 97 帧的性能固件测断流恢复。
  fs.mkdirSync(OWNER_UPDATE_SOURCE, { recursive: true });
  fs.writeFileSync(path.join(OWNER_UPDATE_SOURCE, 'index.mdx'), '---\ntitle: 更新通知验收\n---\n<Section id="live" title="更新">\n<Canvas frames={["s", "d", "h"]} />\n</Section>\n<div style={{height: "30000px"}} />\n<Section id="later" title="稍后">\n<Canvas frames={["late"]} />\n</Section>\n');
  for (const id of ['s', 'd']) fs.writeFileSync(path.join(OWNER_UPDATE_SOURCE, `${id}.jsx`),
    `export default function Frame() { return <div className="ios-app"><p data-update>${id} OLD</p>${id === 'd' ? '<script data-preview-script>{`root.dataset.ready = "1";`}</script>' : ''}</div>; }`);
  for (const id of ['h', 'late']) fs.writeFileSync(path.join(OWNER_UPDATE_SOURCE, `${id}.html`),
    `<!doctype html><html><body><p data-update>${id} OLD</p></body></html>`);
}
