/** mv 的可恢复写入：关键数据改动前留副本；缓存等可再生数据不参与事务。 */
import fs from 'node:fs';
import path from 'node:path';

const copyOptions = { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true };
const exists = (file) => { try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };

export function beginMoveRecovery(root, targets) {
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, '.mv-recovery-'));
  const manifest = path.join(dir, 'manifest.json');
  const state = { status: 'preparing', active: null, completed: [], snapshots: [] };
  const save = () => fs.writeFileSync(manifest, JSON.stringify(state, null, 2) + '\n');
  try {
    for (const [i, target] of [...new Set(targets.filter(Boolean))].entries()) {
      const backup = exists(target) ? path.join(dir, `backup-${i}`) : null;
      if (backup) fs.cpSync(target, backup, copyOptions);
      state.snapshots.push({ target, backup });
    }
    state.status = 'running';
    save();
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return {
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
      // 先恢复原本存在的数据，再删除本次新增的目标；恢复失败时保留全部目标与备份。
      for (const { target, backup } of state.snapshots.filter((item) => item.backup)) {
        let staging;
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          staging = fs.mkdtempSync(path.join(path.dirname(target), '.ppnt-restore-'));
          const prepared = path.join(staging, 'original');
          fs.cpSync(backup, prepared, copyOptions);
          fs.rmSync(target, { recursive: true, force: true });
          fs.renameSync(prepared, target);
        } catch (restoreError) {
          failures.push(`${target}：${restoreError.message}`);
        } finally {
          if (staging) {
            try { fs.rmSync(staging, { recursive: true, force: true }); } catch (cleanupError) { failures.push(`${staging}：${cleanupError.message}`); }
          }
        }
      }
      if (!failures.length) {
        for (const { target } of state.snapshots.filter((item) => !item.backup)) {
          try { fs.rmSync(target, { recursive: true, force: true }); } catch (removeError) { failures.push(`${target}：${removeError.message}`); }
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
}
