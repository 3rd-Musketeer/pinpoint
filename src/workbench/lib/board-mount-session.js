function toDisposer(value, root) {
  if (typeof value === 'function') return value;
  if (value && typeof value.unmount === 'function') return () => value.unmount(root);
  return null;
}

export class BoardMountSession {
  constructor(generation, pageId) {
    this.generation = generation;
    this.pageId = pageId;
    this.active = true;
    this.disposers = [];
    this.pendingTasks = new Set();
  }

  isUsable(root) {
    return this.active && (!root || root.isConnected !== false);
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
    this.disposers.push(disposer);
  }

  cancel() {
    if (!this.active) return;
    this.active = false;
    for (const task of this.pendingTasks) {
      clearTimeout(task.timer);
      task.settle(false);
    }
    this.pendingTasks.clear();
    const list = this.disposers.splice(0, this.disposers.length);
    for (const disposer of list) {
      try { disposer(); } catch (error) { console.error('[preview-script] unmount', error); }
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
