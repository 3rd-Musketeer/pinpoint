/** mv 的可恢复写入：关键数据改动前留副本；缓存等可再生数据不参与事务。 */
import fs from 'node:fs';
import path from 'node:path';

const copyOptions = { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true };
function identity(file) {
  try {
    const stat = fs.lstatSync(file, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function beginMoveRecovery(root, targets, { followWrites = [] } = {}) {
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, '.mv-recovery-'));
  const manifest = path.join(dir, 'manifest.json');
  const state = { status: 'preparing', active: null, completed: [], snapshots: [] };
  const save = () => fs.writeFileSync(manifest, JSON.stringify(state, null, 2) + '\n');
  try {
    for (const [i, target] of [...new Set(targets.filter(Boolean))].entries()) {
      const original = identity(target);
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
      state.snapshots.push({ target, backup, original, expected: original, touched: false, writeThrough });
    }
    state.status = 'running';
    save();
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  const targetKey = (target) => path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
  const snapshotOf = (target) => state.snapshots.find((item) => targetKey(item.target) === targetKey(target));
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
      assertIdentity(source);
      assertIdentity(destination);
      const moved = identity(from);
      fs.renameSync(from, to);
      if (source) Object.assign(source, { touched: true, expected: null });
      // 身份来自实际 rename 的源对象，不能事后把目标目录的当前身份认作本次所有。
      if (destination) Object.assign(destination, { touched: true, expected: moved });
    },
    remove(target) {
      const item = touch(target);
      try { fs.rmSync(target, { recursive: true, force: true }); } finally {
        if (item && identity(target) === null) item.expected = null;
      }
    },
    writeFile(target, content) {
      touch(target);
      fs.writeFileSync(target, content);
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
        try { assertIdentity(item); } catch (conflict) { failures.push(conflict.message); }
      }
      const restore = failures.length ? [] : state.snapshots.filter((item) => item.backup && item.touched);
      for (const item of restore) {
        const { target, backup } = item;
        let staging;
        try {
          assertIdentity(item);
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
          const restored = identity(prepared);
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(prepared, target);
          item.expected = restored;
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
        err(`回滚未完成，保留全部恢复副本：${manifest}；按 snapshots 中 target / backup 对照恢复，恢复前保留现有目录。${failures.join('；')}`);
      } else {
        err('已回滚文章、登记表与标注桶；未执行后续缓存和重编步骤，可重试原命令。');
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch { err(`注意：回滚副本待清理：${dir}`); }
      }
      return 1;
    },
  };
  return operations;
}
