/**
 * Astro content loaders over registered projects. Files live outside the
 * site root (absolute paths from the registry); the store keeps paths
 * relative to the site root, which Astro accepts with `../` segments.
 *
 *   projects  id <project>               { id, title, root, dir, errors[] }
 *   articles  id <project>/<article>     frontmatter + { project, article, file }   (MDX, deferred render)
 *   concepts  id <project>/<slug>        (wiki entries, docs/pinpoint/wiki/) frontmatter + { project, name, slug, file } (md, rendered at load)
 *
 * In dev every loader watches the registry file and each project's
 * docs/pinpoint/ and reloads itself on any change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjects } from './projects-source.js';
import { namespaceErrors } from '../../../src/shared/refs.js';
import { projectErrorLine } from './site-errors.js';

const posix = (p) => p.split(path.sep).join('/');

// 先完成异步读取与校验，再同步替换集合；请求不会读到只装了一半的路由表。
function replaceEntries(store, entries) {
  store.clear();
  for (const entry of entries) store.set(entry);
}

export function watchAll(ctx, source, reload) {
  if (!ctx.watcher) return;
  // 盯的目录跟着登记表走：每次重读后按新的 project 清单重算，登记之后才有的 project
  // （ppnt new project / add --project）里新建的文章也能读到。返回这次有没有新加的目录。
  let targets = [];
  const track = (next) => {
    if (!next) return false;
    const before = new Set(targets);
    targets = [next.registryPath, ...next.projects.map((p) => p.dir)];
    ctx.watcher.add(targets);
    return targets.some((t) => !before.has(t));
  };
  track(source);
  const hit = (changed) => targets.some((t) => changed === t || changed.startsWith(t + path.sep));
  // 重读一次只跑一个，跑的时候来的事件攒成跑完后再读一遍（2026-10-15，docs/debugging.md）：
  // - 交叠的两次重读里，读盘早的那次后结束会把监听清单换回旧的，新 project 的事件被 hit() 丢掉；
  // - 新目录加进监听之前就写进去的文件不会再来事件，所以加了新目录就再读一遍盘。
  let timer = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        if (track(await reload())) again = true;
      } while (again);
    } catch (e) {
      ctx.logger.error(e.message);
    } finally {
      running = false;
    }
  };
  const onChange = (changed) => {
    if (!hit(changed)) return;
    clearTimeout(timer);
    timer = setTimeout(run, 50);
  };
  ctx.watcher.on('change', onChange);
  ctx.watcher.on('add', onChange);
  ctx.watcher.on('unlink', onChange);
}

export function projectsLoader() {
  return {
    name: 'pinpoint-projects',
    load: async (ctx) => {
      const run = async () => {
        const source = await loadProjects();
        const entries = [];
        for (const p of source.projects) {
          // Layout errors stay objects (listProjects + the site's namespace check); pages print them via site-errors.js.
          const errors = [...p.errors, ...namespaceErrors(p)];
          for (const e of errors) ctx.logger.error(projectErrorLine(p.id, e));
          const data = await ctx.parseData({ id: p.id, data: { id: p.id, title: p.title, root: p.root, dir: p.dir, errors } });
          entries.push({ id: p.id, data });
        }
        replaceEntries(ctx.store, entries);
        return source;
      };
      const source = await run();
      watchAll(ctx, source, run);
    },
  };
}

export function articlesLoader() {
  return {
    name: 'pinpoint-articles',
    load: async (ctx) => {
      const root = fileURLToPath(ctx.config.root);
      const mdx = ctx.entryTypes.get('.mdx');
      if (!mdx) throw new Error('pinpoint site: @astrojs/mdx is not configured');
      const run = async () => {
        const source = await loadProjects();
        const entries = [];
        for (const p of source.projects) {
          for (const a of p.articles) {
            const contents = await fs.promises.readFile(a.file, 'utf8').catch(() => null);
            if (contents === null) { ctx.logger.warn(`cannot read ${a.file}`); continue; }
            const id = `${p.id}/${a.id}`;
            const own = { title: a.title, summary: a.summary, date: a.date, mtimeMs: a.mtimeMs, project: p.id, article: a.id, file: a.file };
            try {
              const { body, data } = await mdx.getEntryInfo({ contents, fileUrl: pathToFileURL(a.file) });
              const parsed = await ctx.parseData({
                id,
                // title / summary come from listProjects (one frontmatter parser for site, service and CLI; docs/projects.md).
                // date / mtimeMs 给首页排序（src/shared/article-feed.js）。
                data: { ...data, ...own },
                filePath: a.file,
              });
              entries.push({
                id,
                data: parsed,
                body,
                filePath: posix(path.relative(root, a.file)),
                digest: ctx.generateDigest(contents),
                deferredRender: true,
              });
            } catch (error) {
              // 这篇保留路由并显示错误，正文不送入 MDX 编译；其他文章继续载入。
              const loadError = `${a.file}: ${error.message}`;
              ctx.logger.error(loadError);
              const data = await ctx.parseData({ id, data: { ...own, loadError }, filePath: a.file });
              entries.push({ id, data, body: '' });
            }
          }
        }
        replaceEntries(ctx.store, entries);
        return source;
      };
      const source = await run();
      watchAll(ctx, source, run);
    },
  };
}

export function conceptsLoader() {
  return {
    name: 'pinpoint-concepts',
    load: async (ctx) => {
      const root = fileURLToPath(ctx.config.root);
      const md = ctx.entryTypes.get('.md');
      const render = await md.getRenderFunction(ctx.config);
      const run = async () => {
        const source = await loadProjects();
        const entries = [];
        for (const p of source.projects) {
          for (const c of p.concepts) {
            const contents = await fs.promises.readFile(c.file, 'utf8').catch(() => null);
            if (contents === null) { ctx.logger.warn(`cannot read ${c.file}`); continue; }
            const id = `${p.id}/${c.slug}`;
            try {
              const { body, data } = await md.getEntryInfo({ contents, fileUrl: pathToFileURL(c.file) });
              // name / slug / status / boundary come from listProjects, not Astro's YAML (docs/projects.md).
              const own = { name: c.name, slug: c.slug, status: c.status, boundary: c.boundary };
              const parsed = await ctx.parseData({ id, data: { ...data, ...own, project: p.id, file: c.file }, filePath: c.file });
              const digest = ctx.generateDigest(contents);
              let rendered;
              let renderError;
              try {
                rendered = await render({ id, data, body, filePath: c.file, digest });
              } catch (e) {
                ctx.logger.error(`render ${c.file}: ${e.message}`);
                // 与文章的 loadError 同一个待遇：保留路由，页面把错误亮出来，不是静默没正文。
                renderError = `${c.file}: ${e.message}`;
              }
              entries.push({ id, data: renderError ? { ...parsed, renderError } : parsed, body, filePath: posix(path.relative(root, c.file)), digest, rendered });
            } catch (error) {
              ctx.logger.error(`${c.file}: ${error.message}`);
            }
          }
        }
        replaceEntries(ctx.store, entries);
        return source;
      };
      const source = await run();
      watchAll(ctx, source, run);
    },
  };
}
