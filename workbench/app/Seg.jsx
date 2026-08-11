// 分段控件共享配方（goal-20260811-workbench-visual-rebuild）— V1 私有在
// SettingsView.jsx，V2 侧栏/footer 分段（#wbboard-mode/#wbann-mode/#wbann-filter/
// #wbtheme）是第二处使用，提上 app/ 共享（app/ui/ 只放 shadcn 复制件，本模块是
// 产品配方层）：
//  - 密度 28px 档：分段项 h-6 + 容器 2px 内衬 = 28px；
//  - 容器 --wb-fill 面（bg-muted）+ rounded-md；项 rounded-sm 与内衬同心；
//  - 字阶 13px；off = muted 字 + hover 浅面/前景字；on = 白面（--card）+ --wb-sh-1 + semibold；
//  - hover:data-[state=on] 复合类显式锁 on 白面 —— hover: 与 data-: 同优先级，
//    不赌生成顺序（on 项 hover 时必须保持白面）；focus 沿用 index.html 全局
//    accent catch-all；
//  - 过渡 150ms。
// 行为约定：Radix ToggleGroup single 受控，value 来自 store；点 off 项触发
// onValueChange；点已选项 Radix 报 ''，忽略（旧行为是幂等重放同值，状态等价）。
// options = [[value, label, itemExtras?]]：label 可以是 React 节点（图标+文字）；
// itemExtras 透传 ToggleGroupItem（id / title / className / onClick …）。
// 选中项补 'on' class（e2e 的 toHaveClass(/on/) 契约）。dataAttr = 该项组的
// data-* 契约名（逐组不同）。需要「点同一项再切回」语义的组（#wbann-mode）不走
// Seg.onPick，改用 itemExtras.onClick 保持旧语义（见 AnnPanel）。
import { cn } from './lib/utils.js';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group.jsx';

// min-w-0 必须：Root 在 flex 行里 min-width:auto 会按内容宽撑出侧栏
// （4 项 zoom 组实测溢出）。块级上下文里要满宽时由调用方补 w-auto/w-full
// （Root 基类 w-fit 会被后者压掉）。
var SEG = 'flex-1 min-w-0 bg-muted p-0.5';
// px-1：4 项组在 176px 可用宽里每项 ~41px，px-2 会切字（"150%" 实测被裁）。
var SEG_ITEM =
  'h-6 min-w-0 flex-1 rounded-sm px-1 text-[13px] font-medium text-muted-foreground ' +
  'transition-[color,background-color,box-shadow] duration-150 ' +
  'hover:bg-accent hover:text-accent-foreground ' +
  'data-[state=on]:bg-card data-[state=on]:text-card-foreground data-[state=on]:font-semibold ' +
  'data-[state=on]:shadow-[var(--wb-sh-1)] hover:data-[state=on]:bg-card';

export function Seg(props) {
  return (
    <ToggleGroup type="single" spacing={0.5} value={props.value} id={props.id}
      role={props.role} aria-label={props['aria-label']}
      className={cn(SEG, props.className)}
      onValueChange={function (v) { if (v) props.onPick(v); }}>
      {props.options.map(function (o) {
        var extras = o[2] || {};
        // className 走 cn 合并不透传（否则 {...itemProps} 会盖掉 SEG_ITEM）
        var itemProps = Object.assign({ [props.dataAttr]: o[0] }, extras);
        delete itemProps.className;
        return (
          <ToggleGroupItem key={o[0]} value={o[0]}
            className={cn(SEG_ITEM, extras.className, props.value === o[0] && 'on')}
            {...itemProps}>
            {o[1]}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}

export { SEG, SEG_ITEM };
