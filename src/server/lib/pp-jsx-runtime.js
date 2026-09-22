/**
 * pp2 帧编译的 JSX 运行时（2026-09-22 切片 1）：包一层 preact 的 jsx-dev-runtime。
 * esbuild 以 jsx automatic + jsxDev 转译帧文件，每个元素带着 __source（文件、行）
 * 调进这里的 jsxDEV：
 * - 宿主元素（type 是字符串）打 data-pp-id="<相对页目录的文件>:<行>#<n>"：
 *   n 只保证同一 文件:行 的元素互不相同（全局自增）；最终对外编号是编译器在
 *   renderToString 之后按文档顺序的重编（renumberPpIds），与 agent 读源码 /
 *   读 DOM 的直觉一致。
 * - 函数组件包一层：渲染结果是宿主元素就 cloneElement 补 data-pp-comp="<函数名>"。
 * 编译产物是静态 HTML，本模块只在编译期（node 进程内）跑，不进浏览器。
 * 帧 bundle 经编译器注入的 require 映射拿到本模块（同一个模块实例），包装缓存
 * 挂在模块顶层即可，没有第二份实例。
 */
import { cloneElement } from 'preact';
import { Fragment, jsxDEV as preactJsxDEV } from 'preact/jsx-dev-runtime';

const wrapped = new WeakMap();
let seq = 0;

/**
 * data-pp-comp 只打用户命名的组件（2026-09-22 review 1-2）：匿名默认导出经 esbuild
 * 得到 <文件>_default 的推断名，export default () => … 的 name 是 "default"，
 * 这些都不是用户起的名字，打上只是噪声。返回 null = 不包装不打标。
 */
function userCompName(fn) {
  const name = fn.displayName || fn.name || '';
  if (!name || name === 'default' || name === 'Anonymous' || name.endsWith('_default')) return null;
  return name;
}

/** 编译器包帧默认导出用：与 jsxDEV 内部同一个包装，帧根宿主元素也带 data-pp-comp。 */
export function __ppWrapComponent(fn) {
  let hit = wrapped.get(fn);
  if (!hit) {
    const name = userCompName(fn);
    if (name === null) {
      hit = fn;
    } else {
      hit = function PpStampComponent(props) {
        const out = fn(props);
        if (out && typeof out.type === 'string') {
          return cloneElement(out, { 'data-pp-comp': name });
        }
        return out;
      };
      if (fn.defaultProps) hit.defaultProps = fn.defaultProps;
    }
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
    seq += 1;
    p = { ...(p || {}), 'data-pp-id': `${file}:${source.lineNumber}#${seq}` };
  }
  return preactJsxDEV(t, p, key, isStaticChildren, source, self);
}

// esbuild jsxDev 模式只调 jsxDEV；非 dev 回退路径留同名别名兜底。
export const jsx = jsxDEV;
export const jsxs = jsxDEV;
export { Fragment };
