/**
 * pp2 帧编译的 JSX 运行时（2026-09-22 切片 1）：包一层 preact 的 jsx-dev-runtime。
 * esbuild 以 jsx automatic + jsxDev 转译帧文件，每个元素带着 __source（文件、行）
 * 调进这里的 jsxDEV：
 * - 宿主元素（type 是字符串）打 data-pp-id="<相对页目录的文件>:<行>#<n>"，
 *   n = 本次渲染同一 文件:行 的第几次（1 起）；编译器每渲一帧调一次 __ppReset 归零。
 * - 函数组件包一层：渲染结果是宿主元素就 cloneElement 补 data-pp-comp="<函数名>"。
 * 编译产物是静态 HTML，本模块只在编译期（node 进程内）跑，不进浏览器。
 * esbuild 产出的 bundle 以 file URL 外部引用本文件，与编译器 import 的是同一个
 * 模块实例 —— 计数器与包装缓存是进程内共享状态，__ppReset 的时机因此可靠。
 */
import { cloneElement } from 'preact';
import { Fragment, jsxDEV as preactJsxDEV } from 'preact/jsx-dev-runtime';

let counts = new Map();
const wrapped = new WeakMap();

/** 每渲染一帧调一次：data-pp-id 的 #n 计数归零。 */
export function __ppReset() {
  counts = new Map();
}

/** 编译器包帧默认导出用：与 jsxDEV 内部同一个包装，帧根宿主元素也带 data-pp-comp。 */
export function __ppWrapComponent(fn) {
  let hit = wrapped.get(fn);
  if (!hit) {
    const name = fn.displayName || fn.name || 'Anonymous';
    hit = function PpStampComponent(props) {
      const out = fn(props);
      if (out && typeof out.type === 'string') {
        return cloneElement(out, { 'data-pp-comp': name });
      }
      return out;
    };
    if (fn.defaultProps) hit.defaultProps = fn.defaultProps;
    wrapped.set(fn, hit);
  }
  return hit;
}

export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  let t = type;
  let p = props;
  if (typeof t === 'function') {
    t = __ppWrapComponent(t);
  } else if (typeof t === 'string' && source && source.fileName) {
    const file = String(source.fileName).replace(/\\/g, '/');
    const fl = `${file}:${source.lineNumber}`;
    const n = (counts.get(fl) || 0) + 1;
    counts.set(fl, n);
    p = { ...(p || {}), 'data-pp-id': `${fl}#${n}` };
  }
  return preactJsxDEV(t, p, key, isStaticChildren, source, self);
}

// esbuild jsxDev 模式只调 jsxDEV；非 dev 回退路径留同名别名兜底。
export const jsx = jsxDEV;
export const jsxs = jsxDEV;
export { Fragment };
