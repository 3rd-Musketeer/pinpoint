// 文章页的弹层栈（[[ ]] popup、画布浮层）：Esc 只关最上面一层。
// 约定：处理了 Esc 的一方 preventDefault；别的监听（注入的正文评论客户端 src/client/prose-comments.js）
// 见 e.defaultPrevented 就不动，所以关 popup 不会顺手扔掉正在写的评论。契约在 site/README.md「弹层与 Esc」。

/** 纯的栈，便于单测：push 返回释放函数；escape(e) 有层就关最上面一层并 preventDefault。 */
export function createLayerStack() {
  const stack = [];
  const remove = (entry) => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
  return {
    push(name, close) {
      const entry = { name, close };
      stack.push(entry);
      return () => remove(entry);
    },
    top: () => (stack.length ? stack[stack.length - 1].name : ''),
    names: () => stack.map((e) => e.name),
    /** 关掉所有叫 name 的层（例如浮层打开时收起 popup）。 */
    dismiss(name) {
      for (const entry of stack.filter((e) => e.name === name)) { remove(entry); entry.close(); }
    },
    escape(e) {
      if (!stack.length || e?.defaultPrevented) return false;
      const entry = stack.pop();
      e?.preventDefault?.();
      entry.close();
      return true;
    },
  };
}

export const layers = createLayerStack();

let installed = false;
/** document 捕获阶段接 Esc：早于页面上其他 keydown 监听，先交给最上层。 */
export function installLayerKeys(doc = document) {
  if (installed) return;
  installed = true;
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') layers.escape(e); }, true);
}
