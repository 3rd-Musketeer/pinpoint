function toDisposer(value, root) {
  if (typeof value === 'function') return value;
  if (value && typeof value.unmount === 'function') return () => value.unmount(root);
  return null;
}

export class BoardMountSession {
  #boardResult = null;

  constructor(generation, pageId) {
    this.generation = generation;
    this.pageId = pageId;
    this.active = true;
    // 停驻（E2）：会话仍是当前会话，但预览脚本先不挂，等浮层打开再补。
    // 和 active 分开 —— active 变 false 是会话被替换，挂了一半的要卸载；
    // suspended 只是推迟，不卸载已经挂上的。
    this.suspended = false;
    this.disposers = [];
    this.pendingTasks = new Set();
    // 只读完成标记：几何批（板几何 / spy / 首访聚焦）跑完且本会话
    // 仍是当前会话 → true；会话被替换 / 取消 → false。测试与外部调用方靠它等
    // 「板真正挂好」，不用猜 shell 就绪等于板就绪。
    this.boardSettled = new Promise((resolve) => { this._settleBoard = resolve; });
    // 预览脚本完成标记：内联脚本已执行、sidecar 已 import 并 mount（或各自失败）→ true；
    // 会话被替换 / 取消、挂载后处理抛错 → false。几何批不等它（sidecar 慢不拖住
    // navigator），要点原型交互的调用方等它。
    this.previewsSettled = new Promise((resolve) => { this._settlePreviews = resolve; });
  }

  isUsable(root) {
    return this.active && (!root || root.isConnected !== false);
  }

  // 同步消费者读同一次 boardSettled 落定；取消后的旧会话不再可供存档。
  get boardReady() {
    return this.active && this.#boardResult === true;
  }

  settleBoard(ok) {
    if (this.#boardResult !== null) return;
    this.#boardResult = !!ok;
    this._settleBoard(this.#boardResult);
  }

  settlePreviews(ok) {
    this._settlePreviews(!!ok);
  }

  defer(callback, delay = 0) {
    if (!this.active) return Promise.resolve(false);
    return new Promise((resolve) => {
      const task = {
        timer: null,
        settled: false,
        settle: (value) => {
          if (task.settled) return;
          task.settled = true;
          this.pendingTasks.delete(task);
          resolve(value);
        },
      };
      task.timer = setTimeout(() => {
        if (!this.active) {
          task.settle(false);
          return;
        }
        Promise.resolve()
          .then(callback)
          .then(() => task.settle(this.active), () => task.settle(false));
      }, delay);
      this.pendingTasks.add(task);
    });
  }

  trackDisposer(value, root) {
    const disposer = toDisposer(value, root);
    if (!disposer) return;
    if (!this.isUsable(root)) {
      try { disposer(); } catch (error) { console.error('[preview-script] stale unmount', error); }
      return;
    }
    this.disposers.push({ run: disposer, root: root || null });
  }

  /** 卸载挂在 scope 子树里的预览脚本（重置一帧时用，frame-reset.js），别的帧不动。 */
  disposeWithin(scope) {
    const keep = [];
    for (const entry of this.disposers) {
      if (entry.root && scope.contains(entry.root)) {
        try { entry.run(); } catch (error) { console.error('[preview-script] unmount', error); }
      } else {
        keep.push(entry);
      }
    }
    this.disposers = keep;
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    for (const task of this.pendingTasks) {
      clearTimeout(task.timer);
      task.settle(false);
    }
    this.pendingTasks.clear();
    this.settleBoard(false);
    this.settlePreviews(false);
    const list = this.disposers.splice(0, this.disposers.length);
    for (const entry of list) {
      try { entry.run(); } catch (error) { console.error('[preview-script] unmount', error); }
    }
  }
}

export class BoardMountManager {
  constructor() {
    this.generation = 0;
    this.current = null;
  }

  begin(pageId) {
    if (this.current) this.current.cancel();
    this.current = new BoardMountSession(++this.generation, pageId);
    return this.current;
  }

  cancel() {
    if (this.current) this.current.cancel();
    this.current = null;
  }
}
