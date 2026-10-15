import { loadSite, assertBuildClean, projectEmptyRefs, emptyRefSourceLabel } from '../../lib/site-data.js';

// Agent 视图：一个 project 的全部文章原文（MDX，保留 [[ ]]）和 wiki 词条。
export async function getStaticPaths() {
  const site = await loadSite();
  assertBuildClean(site);
  return [...site.projects.keys()].map((id) => ({ params: { project: id }, props: { projectId: id } }));
}

const stripEsm = (body) => String(body || '').replace(/^(import|export)\s[^\n]*\n/gm, '').trim();

export async function GET({ props }) {
  const site = await loadSite();
  const p = site.projects.get(props.projectId);
  const out = [
    `# ${p.title}`,
    '',
    `pinpoint project \`${p.id}\`。源文件在 project 根的 docs/pinpoint/。[[名字]] 引用本 project 的文章（按 id）或 wiki 词条（按名字），[[project:名字]] 引用别的 project；找不到的是空 ref。`,
    '',
    '## 文章',
    '',
    ...p.articles.map((a) => `- [[${a.id}]] ${a.title}（${a.href}）${a.summary ? `：${a.summary}` : ''}`),
    '',
    '## wiki',
    '',
    ...p.concepts.map((c) => `- **${c.name}**（${c.status}）：${c.definition || '（没有定义）'} 用到它的文章：${c.usedBy.map((a) => a.title).join('、') || '无'}。`),
    '',
    '## 空 ref',
    '',
    ...projectEmptyRefs(p).map(({ name, sources }) => `- ${name}：${sources.map(emptyRefSourceLabel).join('、')}`),
    '',
  ];
  for (const a of p.articles) {
    out.push(`## 文章：${a.title}（[[${a.id}]]）`, '', stripEsm(a.entry.body), '');
  }
  for (const c of p.concepts) {
    if (c.entry.body?.trim()) out.push(`## wiki：${c.name}`, '', c.entry.body.trim(), '');
  }
  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
