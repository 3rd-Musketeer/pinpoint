/** mv 的可恢复写入：关键数据改动前留副本；缓存等可再生数据不参与事务。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const copyOptions = { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true };
function identity(file) {
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** 桶内逐项记录名称、类型及内容；目录的 mtime 会随本次写入变化，不能拿它代表文件内容。 */
function readContents(target, relative = '.', entries = {}) {
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return entries; throw error; }
  if (stat.isSymbolicLink()) entries[relative] = { type: 'symlink', link: fs.readlinkSync(target) };
  else if (stat.isFile()) entries[relative] = { type: 'file', sha256: digest(fs.readFileSync(target)) };
  else if (stat.isDirectory()) {
    entries[relative] = { type: 'directory' };
    for (const name of fs.readdirSync(target)) readContents(path.join(target, name), path.join(relative, name), entries);
  } else throw new Error(`无法记录桶内文件类型：${target}`);
  return entries;
}

export function beginMoveRecovery(root, targets, { followWrites = [], watchContents = [] } = {}) {
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, '.mv-recovery-'));
  const manifest = path.join(dir, 'manifest.json');
  const state = { status: 'preparing', active: null, completed: [], snapshots: [] };
  const save = () => fs.writeFileSync(manifest, JSON.stringify(state, null, 2) + '\n');
  try {
    for (const [i, target] of [...new Set(targets.filter(Boolean))].entries()) {
      const original = identity(target);
      const contents = watchContents.includes(target) ? readContents(target) : null;
      const backup = original ? path.join(dir, `backup-${i}`) : null;
      let writeThrough = null;
      if (backup && followWrites.includes(target)) {
        const realpath = fs.realpathSync(target);
        writeThrough = { realpath, identity: identity(realpath), link: fs.lstatSync(target).isSymbolicLink() ? fs.readlinkSync(target) : null };
        // 写入会跟随链接，副本必须保存真实字节，不能只是备份目录里的断链。
        fs.copyFileSync(realpath, backup);
      } else if (backup) {
        fs.cpSync(target, backup, copyOptions);
      }
      state.snapshots.push({ target, backup, original, expected: original, touched: false, writeThrough, contents });
    }
    state.status = 'running';
    save();
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const targetKey = (target) => path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  const snapshotOf = (target) => state.snapshots.find((item) => targetKey(item.target) === targetKey(target));
  const assertContents = (item, relative = '.') => {
    if (!item?.contents) return;
    const expected = subtree({ item, relative });
    const current = readContents(path.join(item.target, relative));
    for (const name of new Set([...Object.keys(expected), ...Object.keys(current)])) {
      if (JSON.stringify(current[name]) !== JSON.stringify(expected[name])) {
        throw new Error(`桶内容发生冲突，发现并发变动，保留现场：${path.join(item.target, relative, name)}`);
      }
    }
  };
  const contentLocation = (target) => {
    for (const item of state.snapshots.filter((item) => item.contents)) {
      const relative = path.relative(targetKey(item.target), targetKey(target)) || '.';
      if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return { item, relative };
    }
    return null;
  };
  const subtree = (location) => Object.fromEntries(Object.entries(location.item.contents)
    .filter(([name]) => location.relative === '.' || name === location.relative || name.startsWith(location.relative + path.sep))
    .map(([name, value]) => [path.relative(location.relative, name) || '.', value]));
  const setContents = (location, entries = {}) => {
    if (!location) return;
    const { item, relative } = location;
    for (const name of Object.keys(item.contents)) {
      if (relative === '.' || name === relative || name.startsWith(relative + path.sep)) delete item.contents[name];
    }
    for (const [name, value] of Object.entries(entries)) item.contents[path.join(relative, name)] = value;
    item.touched = true;
  };
  const assertIdentity = (item) => {
    if (!item) return;
    if (identity(item.target) !== item.expected) throw new Error(`对象身份发生变化，保留现场：${item.target}`);
    if (item.writeThrough && (fs.realpathSync(item.target) !== item.writeThrough.realpath
      || identity(item.writeThrough.realpath) !== item.writeThrough.identity)) {
      throw new Error(`链接或真实文件身份发生变化，保留现场：${item.target}`);
    }
  };
  const touch = (target) => {
    const item = snapshotOf(target);
    assertIdentity(item);
    if (item) item.touched = true;
    return item;
  };
  const operations = {
    rename(from, to) {
      const source = snapshotOf(from);
      const destination = snapshotOf(to);
      const fromContent = contentLocation(from);
      const toContent = contentLocation(to);
      assertIdentity(source);
      assertIdentity(destination);
      assertContents(fromContent?.item, fromContent?.relative);
      assertContents(toContent?.item, toContent?.relative);
      // 只转移操作前已知的文件记录，不能事后扫描并接纳其他写入方的新反馈。
      const movedContents = toContent ? (fromContent ? subtree(fromContent) : readContents(from)) : null;
      const moved = identity(from);
      fs.renameSync(from, to);
      setContents(fromContent);
      if (toContent) setContents(toContent, movedContents);
      if (source) Object.assign(source, { touched: true, expected: null });
      // 身份来自实际 rename 的源对象，不能事后把目标目录的当前身份认作本次所有。
      if (destination) Object.assign(destination, { touched: true, expected: moved });
    },
    remove(target) {
      const item = touch(target);
      const location = contentLocation(target);
      assertContents(location?.item, location?.relative);
      try { fs.rmSync(target, { recursive: true, force: true }); } finally {
        if (identity(target) === null) {
          if (item) item.expected = null;
          setContents(location);
        }
      }
    },
    writeFile(target, content) {
      touch(target);
      const location = contentLocation(target);
      assertContents(location?.item, location?.relative);
      fs.writeFileSync(target, content);
      setContents(location, { '.': { type: 'file', sha256: digest(content) } });
    },
    replaceFile(target, action) {
      const staging = fs.mkdtempSync(path.join(path.dirname(target), '.ppnt-write-'));
      try {
        const prepared = path.join(staging, 'contents');
        fs.copyFileSync(target, prepared);
        const result = action(prepared);
        operations.rename(prepared, target);
        return result;
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
    },
    step(label, action) {
      state.active = label;
      save();
      const result = action();
      state.completed.push(label);
      state.active = null;
      save();
      return result;
    },
    commit(err) {
      state.status = 'committed';
      try { save(); fs.rmSync(dir, { recursive: true, force: true }); } catch (error) {
        err(`注意：搬迁已提交，恢复副本清理失败，可删除 ${dir}：${error.message}`);
      }
    },
    rollback(error, err) {
      err(`搬迁失败：${error.message}；失败步骤：${state.active || '准备备份'}；此前已完成：${state.completed.join('、') || '无'}`);
      const failures = [];
      // 先核对全部受管路径；原本不存在不代表本次创建，身份变化就保留整个现场。
      for (const item of state.snapshots) {
        try { assertIdentity(item); assertContents(item); } catch (conflict) { failures.push(conflict.message); }
      }
      const restore = failures.length ? [] : state.snapshots.filter((item) => item.backup && item.touched);
      for (const item of restore) {
        const { target, backup } = item;
        let staging;
        try {
          assertIdentity(item);
          assertContents(item);
          if (item.writeThrough) {
            // 保留原 symlink 与真实文件 inode，按已核对的真实位置恢复原始字节。
            fs.writeFileSync(item.writeThrough.realpath, fs.readFileSync(backup));
            continue;
          }
          fs.mkdirSync(path.dirname(target), { recursive: true });
          staging = fs.mkdtempSync(path.join(path.dirname(target), '.ppnt-restore-'));
          const prepared = path.join(staging, 'original');
          fs.cpSync(backup, prepared, copyOptions);
          assertIdentity(item);
          assertContents(item);
          const restored = identity(prepared);
          const restoredContents = item.contents ? readContents(prepared) : null;
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(prepared, target);
          item.expected = restored;
          if (item.contents) item.contents = restoredContents;
        } catch (restoreError) {
          failures.push(`${target}：${restoreError.message}`);
        } finally {
          if (staging) {
            try { fs.rmSync(staging, { recursive: true, force: true }); } catch (cleanupError) { failures.push(`${staging}：${cleanupError.message}`); }
          }
        }
      }
      if (!failures.length) {
        for (const item of state.snapshots.filter((item) => !item.backup && item.touched)) {
          try { operations.remove(item.target); } catch (removeError) { failures.push(`${item.target}：${removeError.message}`); }
        }
      }
      state.status = failures.length ? 'rollback-failed' : 'rolled-back';
      state.failures = failures;
      try { save(); } catch (saveError) { failures.push(`恢复记录写入失败：${saveError.message}`); }
      if (failures.length) {
        err(`回滚未完成，保留全部恢复副本：${manifest}；先保留现有目录，核对并合并并发反馈与附件，再按 snapshots 中 target / backup 对照恢复；writeThrough 条目恢复到 realpath 并保留原链接。${failures.join('；')}`);
      } else {
        err('已回滚文章、登记表与标注桶；未执行后续缓存和重编步骤，可重试原命令。');
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { err(`注意：回滚副本待清理：${dir}`); }
      }
      return 1;
    },
  };
  return operations;
}
