// React 版 workbench 图标 — 与命令式挂载器 workbench-icons.js 共用
// lib/wb-icons.js 数据。出壳进 JSX 的 chrome 一律用本组件，不再走
// data-wb-icon 占位 + mountWorkbenchIcons 扫描（那条路径会把 React 管理的
// <i> 节点 replaceWith 成 svg，使 vnode 指向游离节点）。
import { ICONS, HERO_GEAR_SOLID } from '../lib/wb-icons.js';

export function WbIcon({ name, size, className }) {
  size = size || 14;
  className = className || 'wb-ico';
  if (name === 'settings') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
        viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
        <path fillRule="evenodd" clipRule="evenodd" d={HERO_GEAR_SOLID} />
      </svg>
    );
  }
  var icon = ICONS[name];
  if (!icon) return null;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {icon.map(function (node, i) {
        var Tag = node[0];
        return <Tag key={i} {...node[1]} />;
      })}
    </svg>
  );
}
