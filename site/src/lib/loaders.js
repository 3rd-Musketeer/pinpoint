/**
 * Astro content loaders over registered projects. Files live outside the
 * site root (absolute paths from the registry); the store keeps paths
 * relative to the site root, which Astro accepts with `../` segments.
 *
 *   projects  id <project>               { id, title, root, dir, errors[] }
 *   articles  id <project>/<article>     frontmatter + { project, article, file }   (MDX, deferred render)
 *   concepts  id <project>/<slug>        frontmatter + { project, name, slug, file } (md, rendered at load)
 *
 * In dev every loader watches the registry file and each project's
 * docs/pinpoint/ and reloads itself on any change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjects } from './projects-source.js';
import { namespaceErrors } from './refs.js';

const posix = (p) => p.split(path.sep).join('/');

function siteErrors(projects, upstream) {
  const errors = [...upstream];
  const ids = new Map();
  for (const p of projects) {
    if (ids.has(p.id)) errors.push(`project id "${p.id}" is registered twice (${ids.get(p.id)} and ${p.root})`);
    else ids.set(p.id, p.root);
    errors.push(...namespaceErrors(p));
  }
  return [...new Set(errors)];
}

function watchAll(ctx, source, reload) {
  if (!ctx.watcher) return;
  const targets = [source.registryPath, ...source.projects.map((p) => p.dir)];
  ctx.watcher.add(targets);
  const hit = (changed) => targets.some((t) => changed === t || changed.startsWith(t + path.sep));
  let timer = null;
  const onChange = (changed) => {
    if (!hit(changed)) return;
    clearTimeout(timer);
    timer = setTimeout(() => reload().catch((e) => ctx.logger.error(e.message)), 50);
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
        const errors = siteErrors(source.projects, source.errors);
        for (const e of errors) ctx.logger.error(e);
        ctx.store.clear();
        for (const p of source.projects) {
          const own = errors.filter((e) => e.includes(`"${p.id}"`));
          const data = await ctx.parseData({ id: p.id, data: { id: p.id, title: p.title, root: p.root, dir: p.dir, errors: own } });
          ctx.store.set({ id: p.id, data });
        }
        // Errors that name no project (bad registry JSON) ride on a sentinel entry.
        const loose = errors.filter((e) => !source.projects.some((p) => e.includes(`"${p.id}"`)));
        if (loose.length) ctx.store.set({ id: '__errors', data: await ctx.parseData({ id: '__errors', data: { id: '__errors', title: '', root: '', dir: '', errors: loose } }) });
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
        ctx.store.clear();
        for (const p of source.projects) {
          for (const a of p.articles) {
            const contents = await fs.promises.readFile(a.file, 'utf8').catch(() => null);
            if (contents === null) { ctx.logger.warn(`cannot read ${a.file}`); continue; }
            const { body, data } = await mdx.getEntryInfo({ contents, fileUrl: pathToFileURL(a.file) });
            const id = `${p.id}/${a.id}`;
            const parsed = await ctx.parseData({
              id,
              // title / summary come from listProjects (one frontmatter parser for site, service and CLI; docs/projects.md).
              data: { ...data, title: a.title, summary: a.summary, project: p.id, article: a.id, file: a.file },
              filePath: a.file,
            });
            ctx.store.set({
              id,
              data: parsed,
              body,
              filePath: posix(path.relative(root, a.file)),
              digest: ctx.generateDigest(contents),
              deferredRender: true,
            });
          }
        }
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
        ctx.store.clear();
        for (const p of source.projects) {
          for (const c of p.concepts) {
            const contents = await fs.promises.readFile(c.file, 'utf8').catch(() => null);
            if (contents === null) { ctx.logger.warn(`cannot read ${c.file}`); continue; }
            const { body, data } = await md.getEntryInfo({ contents, fileUrl: pathToFileURL(c.file) });
            const id = `${p.id}/${c.slug}`;
            // name / slug / status / boundary come from listProjects, not Astro's YAML (docs/projects.md).
            const own = { name: c.name, slug: c.slug, status: c.status, boundary: c.boundary };
            const parsed = await ctx.parseData({ id, data: { ...data, ...own, project: p.id, file: c.file }, filePath: c.file });
            const digest = ctx.generateDigest(contents);
            let rendered;
            try {
              rendered = await render({ id, data, body, filePath: c.file, digest });
            } catch (e) {
              ctx.logger.error(`render ${c.file}: ${e.message}`);
            }
            ctx.store.set({ id, data: parsed, body, filePath: posix(path.relative(root, c.file)), digest, rendered });
          }
        }
        return source;
      };
      const source = await run();
      watchAll(ctx, source, run);
    },
  };
}
