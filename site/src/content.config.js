import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { projectsLoader, articlesLoader, conceptsLoader } from './lib/loaders.js';

// 内容不在站点里：来自 registry 里登记的 project（common.md §1–§3），见 lib/loaders.js。

const projects = defineCollection({
  loader: projectsLoader(),
  schema: z.object({
    id: z.string(),
    title: z.string(),
    root: z.string(),
    dir: z.string(),
    errors: z.array(z.string()),
  }),
});

// article frontmatter: title（缺省用 id）、summary（popup 与列表里的一句话）、order（列表次序，可省）。
const articles = defineCollection({
  loader: articlesLoader(),
  schema: z.looseObject({
    title: z.string(),
    summary: z.string().optional(),
    order: z.number().optional(),
    project: z.string(),
    article: z.string(),
    file: z.string(),
  }),
});

// concept frontmatter（CONTEXT.md concept 词条，docs/projects.md）：name（缺省用文件名）、status（占位 / 收敛中 / 已固定）、
// boundary（一句边界）。这几项由 listProjects 读出，slug 是文件名（URL 段）。
const concepts = defineCollection({
  loader: conceptsLoader(),
  schema: z.looseObject({
    name: z.string(),
    slug: z.string(),
    status: z.enum(['占位', '收敛中', '已固定']).optional(),
    boundary: z.string().optional(),
    project: z.string(),
    file: z.string(),
  }),
});

export const collections = { projects, articles, concepts };
