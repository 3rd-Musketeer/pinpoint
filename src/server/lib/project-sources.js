/**
 * project.json 的 `sources`（docs/projects.md“HTML 帧”）：project 根之外、HTML 帧可以引用的目录。
 *
 *   { "id": "hosted", "sources": { "skill": "../areta-pages/skill", "variants": "/abs/dir" } }
 *
 * 名字匹配 SOURCE_NAME_PATTERN，值是目录路径，绝对路径或相对 project 根。帧写 `src: "skill:preview.html"`。
 * 服务只出 project 根和这些目录下的文件。
 *
 * readProjectSources(root, json) → { sources: { 名: 绝对目录 }, errors }：值写坏或目录不在都是
 *   project 错误 `project_sources`（没有 path，指 project.json），这个名字不进 sources。
 * loadProjectSources(root) 自己读 project.json（编译目标用），读不到或写坏时 sources 为 {}。
 */
import fs from 'node:fs';
import path from 'node:path';

import { PROJECT_ROOT_SEGMENT, SOURCE_NAME_PATTERN } from '../../shared/project-ids.js';
import { resolveContainedFile } from './servable-file.js';

const CONTENT_DIR = path.join('docs', 'pinpoint');

const problem = (message) => ({ code: 'project_sources', message: `project.json 的 sources：${message}` });

export function readProjectSources(root, json) {
  const sources = {};
  const errors = [];
  const raw = json && json.sources;
  if (raw === undefined) return { sources, errors };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(problem('必须是对象 { "<名字>": "<目录>" }，目录写绝对路径或相对 project 根'));
    return { sources, errors };
  }
  for (const [name, value] of Object.entries(raw)) {
    if (!SOURCE_NAME_PATTERN.test(name) || name === PROJECT_ROOT_SEGMENT.slice(1)) {
      errors.push(problem(`名字 ${JSON.stringify(name)} 不合规则（必须匹配 ${SOURCE_NAME_PATTERN}，不能叫 root）`));
      continue;
    }
    if (typeof value !== 'string' || !value.trim()) {
      errors.push(problem(`"${name}" 的值必须是目录路径字符串`));
      continue;
    }
    const dir = path.resolve(root, value);
    let stat = null;
    try {
      stat = fs.statSync(dir);
    } catch { /* 不在 */ }
    if (!stat || !stat.isDirectory()) {
      errors.push(problem(`"${name}" 指的目录不存在：${value}（解析为 ${dir}）`));
      continue;
    }
    sources[name] = dir;
  }
  return { sources, errors };
}

export function loadProjectSources(root) {
  try {
    const found = resolveContainedFile(root, path.join(CONTENT_DIR, 'project.json'), { index: false });
    if (!found.file) return { sources: {}, errors: [] };
    const json = JSON.parse(fs.readFileSync(found.file, 'utf8'));
    return readProjectSources(root, json);
  } catch {
    return { sources: {}, errors: [] };
  }
}
