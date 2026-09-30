/* pinpoint annotate 客户端的样式表（从 annotate.js 拆出，原样搬家、不改一条规则）。
 * 注入端是单文件，读不到 workbench 的 --wb-*，所以 token 用 var(--wb-*, 兜底) 或字面量；层级走
 * --wb-z 阶梯（layering.test.js 扫这份文件）。规则顺序有意义（暗色块在钉子规则之后等），别重排。 */
import { bubbleCss } from '../shared/annotate-bubble.js';
import ANN_LIST_CSS from '../shared/ann-list.css';

export function annotateCss() {
  return [
    // V4（goal-20260811-workbench-visual-rebuild）：--wb-* 钉值从 #ann-sidebar 提升到
    // [data-ann-ui] 基规则 —— 工具条/composer/气泡/mention/侧栏消费同一套 token（命名与值
    // 跟随 workbench/wb-tokens.css）；钉在注入 UI 根上，宿主页面的同名变量渗不进来。
    // #ann-sidebar 规则上的钉值保留原样：共享行样式入参 + 三向守卫锚点（与本规则同值）。
    // --ann-st-* 状态色板（2026-09-23）：SSOT = src/shared/ann-status.js，workbench
    // 侧同值钉在 index.html 的 #wbann-pop 上（ann-status.test.js 三向比对）。
    // 画布钉子、弹层/侧栏行首序号圆消费同一组变量，三处颜色一致。
    '[data-ann-ui]{font-family:var(--wb-font,-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif);box-sizing:border-box;--wb-surface:#fff;--wb-side:#f6f6f7;--wb-fg:#1c2024;--wb-muted:#6b6b70;--wb-faint:#8d8d8d;--wb-line:rgba(0,0,0,.07);--wb-hover:rgba(0,0,0,.04);--wb-fill:rgba(0,0,0,.055);--wb-accent:#5b7fa6;--wb-danger:#b84230;--wb-ok:#1d7144;--wb-ok-soft:#edf8f1;--ann-st-open:#5b7fa6;--ann-st-check:#b87c14;--ann-st-done:#2f9e63;--ann-st-close:#858e99;--wb-on-accent:#fff;--wb-glass:rgba(255,255,255,.88);--wb-glass-hi:rgba(255,255,255,.6);--wb-seam:rgba(0,0,0,.09);--ann-amber-bg:color-mix(in srgb,#f5a623 16%,#fff);--ann-amber-fg:#8a5a00;--ann-ink:#111;--ann-ink-hover:#292929;--ann-on-ink:#fff;--wb-r-1:4px;--wb-r-2:6px;--wb-r-3:8px;--wb-r-4:12px;--wb-w-medium:500;--wb-w-semibold:600;--wb-w-bold:700;--wb-sh-1:0 1px 2px rgba(0,0,0,.06),0 0 0 0.5px rgba(0,0,0,.04);--wb-sh-2:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.1);--wb-sh-3:0 1px 2px rgba(0,0,0,.06),0 14px 38px rgba(0,0,0,.16);--wb-font:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC",system-ui,sans-serif;--wb-font-mono:ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace;--wb-dur:.2s;--wb-ease:cubic-bezier(.25,0,0,1);}',
    '[data-ann-ui] *,[data-ann-ui] *::before,[data-ann-ui] *::after{box-sizing:border-box;}',
    /* 悬浮工具条与标注面板：2026-09-04 外壳重设计（ADR 0031）「注入端 #ann-sidebar
       换同一档玻璃，两端材质一致」。F2 磨砂的配方在这里是字面量，不是 token ——
       client 是注进任意页面的单文件，读不到 workbench 的 --wb-*（同一个理由让
       [data-ann-ui] 上钉了一整套 --wb-* 值），所以玻璃这四个数也钉在规则里：
       白 88% + blur 20 saturate 1.2 + 圆角 14 + sh-3 + 0.5px 上缘内高光。
       改这四个数要连 src/workbench/wb-tokens.css 的 --wb-glass / --wb-glass-blur /
       --wb-r-glass / --wb-sh-3 一起改，双端材质不许分家。 */
    '#ann-sidebar,#ann-toolbar{background:var(--wb-glass,rgba(255,255,255,.88));-webkit-backdrop-filter:blur(20px) saturate(1.2);backdrop-filter:blur(20px) saturate(1.2);border-radius:14px;box-shadow:inset 0 .5px 0 var(--wb-glass-hi,rgba(255,255,255,.6)),0 1px 2px rgba(0,0,0,.06),0 14px 38px rgba(0,0,0,.16);}',
    // 客座层：注入到别人页面时与宿主的 z-index 竞争，workbench 里 hidden。数字保留，不进 --wb-z 阶梯。
    '#ann-toolbar{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;padding:7px 12px;}',
    '#ann-toolbar button{border:none;cursor:pointer;font-size:12px;font-weight:var(--wb-w-medium,500);height:28px;padding:0 10px;border-radius:var(--wb-r-2,6px);background:transparent;color:var(--wb-muted,#6b6b70);transition:background var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1)),color var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1)),box-shadow var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1));}',
    '#ann-toolbar button:hover{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg,#1c2024);}',
    '#ann-toolbar button.on{background:var(--ann-amber-bg,color-mix(in srgb,#f5a623 16%,#fff));color:var(--ann-amber-fg,#8a5a00);font-weight:var(--wb-w-semibold,600);box-shadow:inset 0 0 0 1px color-mix(in srgb,#f5a623 35%,transparent);}',
    '#ann-toolbar button[hidden]{display:none;}',
    '#ann-toolbar button.ok{background:var(--wb-ok-soft,#edf8f1);color:var(--wb-ok,#1d7144);}',
    '#ann-count{font-size:11px;color:var(--wb-muted,#6b6b70);}',
    '#ann-status{font-size:10px;color:var(--wb-faint,#8d8d8d);}',
    '#ann-status.err{color:var(--wb-danger,#b84230);}',
    'html.ann-sidebar-open #ann-toolbar{right:304px;}',
    // 标注面板：材质走上面与工具条共用的玻璃规则。它从贴边满高的实色面改成浮在
    // 页面上的玻璃板 —— 四缘留 12px，overflow:hidden 让滚动区不冒出圆角。
    // 宽度 280 不变，工具条让位的 304 = 12 + 280 + 12。
    // 本规则上的 --wb-* 钉值是共享行样式（src/shared/ann-list.css）的主题入参 + 三向守卫锚点，
    // 与 [data-ann-ui] 基规则的钉值同值；宿主页面即便定义了同名变量也渗不进来。
    // 客座层：与 #ann-toolbar 同理，数字保留，不进 --wb-z 阶梯。
    '#ann-sidebar{position:fixed;top:12px;right:12px;bottom:12px;width:280px;z-index:2147483645;overflow:hidden;display:flex;flex-direction:column;--wb-surface:#fff;--wb-fill:rgba(0,0,0,.055);--wb-fg:#1c2024;--wb-muted:#6b6b70;--wb-faint:#8d8d8d;--wb-hover:rgba(0,0,0,.04);--wb-danger:#b84230;--wb-r-2:6px;--wb-r-3:8px;--wb-w-medium:500;--wb-w-semibold:600;--wb-w-bold:700;--wb-sh-1:0 1px 2px rgba(0,0,0,.06),0 0 0 0.5px rgba(0,0,0,.04);--wb-font-mono:ui-monospace,SFMono-Regular,Menlo,"PingFang SC",monospace;--wb-dur:.2s;--wb-ease:cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar[hidden]{display:none;}',
    '#ann-sidebar .ann-sb-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px 10px;}',
    '#ann-sidebar .ann-sb-title{flex:1;font-size:13px;font-weight:var(--wb-w-semibold);color:var(--wb-fg);}',
    '#ann-sidebar .ann-sb-count{font-size:11px;color:var(--wb-faint);font-variant-numeric:tabular-nums;}',
    '#ann-sidebar .ann-sb-close{flex:none;width:26px;height:26px;padding:0;border:none;border-radius:var(--wb-r-2);background:transparent;cursor:pointer;font:inherit;font-size:14px;line-height:26px;text-align:center;color:var(--wb-faint);transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-close:hover{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg);}',
    // 「交互 | 标注」segmented：同 workbench 的 .wb-board-mode / .wb-ann-filter .ctl
    // 语言 —— 灰槽 + 白色凸起选中态；「标注」选中时沿用 workbench 标注开关的橙色强调。
    '#ann-sidebar .ann-sb-modes{flex:none;display:flex;gap:2px;margin:10px 12px 4px;padding:2px;border-radius:var(--wb-r-3);background:var(--wb-fill,rgba(0,0,0,.055));}',
    '#ann-sidebar .ann-sb-modes button{flex:1;border:0;border-radius:var(--wb-r-2);cursor:pointer;background:transparent;color:var(--wb-muted);font:inherit;font-size:11.5px;font-weight:var(--wb-w-semibold);letter-spacing:.02em;padding:6px 8px;transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1),box-shadow .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-modes button:hover{color:var(--wb-fg);}',
    '#ann-sidebar .ann-sb-modes button.on{background:var(--wb-surface,#fff);color:var(--wb-fg);box-shadow:var(--wb-sh-1);}',
    '#ann-sidebar .ann-sb-modes button.on[data-ann-mode="annotate"]{background:var(--ann-amber-bg,color-mix(in srgb,#f5a623 16%,#fff));color:var(--ann-amber-fg,#8a5a00);box-shadow:inset 0 0 0 1px color-mix(in srgb,#f5a623 35%,transparent);}',
    // 状态筛选分段（pp2：取代「已关闭 n」折叠段）：同 .ann-sb-modes 的灰槽 +
    // 白色凸起语言，密度低一档（五段挤一行）；计数为 0 的段弱化但仍可点。
    '#ann-sidebar .ann-sb-filters{flex:none;display:flex;gap:2px;margin:6px 12px 2px;padding:2px;border-radius:var(--wb-r-3);background:var(--wb-fill,rgba(0,0,0,.055));}',
    '#ann-sidebar .ann-sb-filters[hidden]{display:none;}',
    '#ann-sidebar .ann-sb-filters button{flex:1;min-width:0;border:0;border-radius:var(--wb-r-2);cursor:pointer;background:transparent;color:var(--wb-muted);font:inherit;font-size:10.5px;font-weight:var(--wb-w-semibold);letter-spacing:.02em;padding:4px 2px;white-space:nowrap;font-variant-numeric:tabular-nums;transition:background .2s cubic-bezier(.25,0,0,1),color .2s cubic-bezier(.25,0,0,1),box-shadow .2s cubic-bezier(.25,0,0,1);}',
    '#ann-sidebar .ann-sb-filters button:hover{color:var(--wb-fg);}',
    '#ann-sidebar .ann-sb-filters button.on{background:var(--wb-surface,#fff);color:var(--wb-fg);box-shadow:var(--wb-sh-1);}',
    '#ann-sidebar .ann-sb-filters button.dim{opacity:.45;}',
    '#ann-sidebar .ann-sb-body{flex:1;overflow-y:auto;padding:6px 8px 8px;}',
    // 行/失效态/空态的共享视觉 = src/shared/ann-list.css，serve 时内联为 ANN_LIST_CSS
    // （行类名统一为 .wb-ann-*）。workbench 父页已 link 同一份：再内联一份会排在
    // index.html 的弹出列表皮肤之后、同权重盖掉它，所以文档里已有这份 link 就不内联。
    document.querySelector('link[href$="/shared/ann-list.css"]') ? '' : ANN_LIST_CSS,
    // 以下为 client 侧结构增量，与 workbench 侧有意不同、不进共享层：行 flex 壳、
    // min-width 序号徽标、失效徽标描边色、broken-tag 对齐、空态盒边距/边框、操作列。
    '#ann-sidebar .wb-ann-empty{margin:6px 4px;border:1px dashed var(--wb-seam,rgba(0,0,0,.12));}',
    '#ann-sidebar .wb-ann-empty-title{margin:0 0 6px;}',
    '#ann-sidebar .wb-ann-item{display:flex;gap:2px;align-items:stretch;}',
    '#ann-sidebar .wb-ann-num{min-width:18px;padding:0 5px;}',
    '#ann-sidebar .wb-ann-item--broken .wb-ann-num{box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);}',
    '#ann-sidebar .wb-ann-broken-tag{align-self:flex-start;}',
    '#ann-sidebar .ann-sb-acts{flex:none;display:flex;flex-direction:column;gap:2px;padding:4px 4px 4px 0;opacity:0;pointer-events:none;}',
    '#ann-sidebar .wb-ann-item:hover .ann-sb-acts,#ann-sidebar .wb-ann-item:focus-within .ann-sb-acts{opacity:1;pointer-events:auto;}',
    '#ann-sidebar .ann-sb-acts button{min-width:32px;height:24px;padding:0;border:none;border-radius:var(--wb-r-2);background:transparent;cursor:pointer;font:inherit;font-size:12px;line-height:24px;text-align:center;color:var(--wb-faint);}',
    '#ann-sidebar .ann-sb-acts button:hover{background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg);}',
    'html.ann-mode-on #wbstage{cursor:crosshair;}',
    /* 层级走 --wb-z 阶梯（src/workbench/wb-tokens.css，ADR 0034）：#ann-overlay 静止 --wb-z-marks、
       抬升 --wb-z-marks-active；#ann-chrome（lasso / tip / 输入框）--wb-z-composer，压过横条。
       兜底数给不加载 wb-tokens.css 的独立文档页，必须与 token 同值（layering.test.js 比对）。
       其余 z-index（1–6）只在 #ann-overlay 或 #ann-chrome 内部比，不进阶梯。 */
    '#ann-overlay{position:absolute;inset:0;pointer-events:none;z-index:var(--wb-z-marks,10);overflow:hidden;margin:0;padding:0;border:0;width:auto;height:auto;background:transparent;color:inherit;}#ann-overlay::backdrop{background:transparent;pointer-events:none}',
    '#ann-overlay[data-ann-viewport]{position:fixed;}',
    '#ann-marks,#ann-hover-layer{position:absolute;inset:0;pointer-events:none;z-index:1;}',
    /* 画布模式：#ann-marks 是 #wbstage 滚动内容的孩子，跟画布一起被浏览器原生滚动（不再由 JS 补 translate，
       拖动时钉子 / 框与 frame 同帧）。它自己进 --wb-z 阶梯：静止 marks 档，钉子点亮 / 定位闪烁抬到 marks-active。 */
    '#wbstage>#ann-marks{z-index:var(--wb-z-marks,10);}',
    '#wbstage>#ann-marks:has(.ann-badge--on),#wbstage>#ann-marks:has(.ann-flash){z-index:var(--wb-z-marks-active,50);}',
    '.ann-mark-group{position:absolute;inset:0;pointer-events:none;}',
    '.wb-stage-wrap #ann-bubbles .ann-bubble:not(.ann-bubble--show){display:none;}',
    '#ann-chrome{position:absolute;inset:0;pointer-events:none;z-index:var(--wb-z-composer,70);overflow:visible;}',
    // 锚点框/套索/序号徽章：琥珀是标注功能色（双端同值），只把圆角/阴影收进 token 阶梯。
    '.ann-hover-ghost{position:absolute;box-sizing:border-box;border:2px solid #f5a623;border-radius:var(--wb-r-1,4px);background:rgba(245,166,35,.07);pointer-events:none;z-index:1;}',
    '.ann-hover-ghost[hidden]{display:none;}',
    /* 序号钉（2026-09-04 评审板 H 批注 1：「不够明显，需要跟下面的画面有高对比」）：
       22px 实心圆 + 白字 + 2px 白描边 + 投影 —— 白环把钉子从任何底色里
       切出来（深色屏、彩色卡片、白纸都成立），所以它可以常显不打折。
       底色即状态色（--ann-st 板，SSOT = src/shared/ann-status.js）：owner
       2026-09-23「在 pin 上面打标记有点奇怪，不如用颜色标识」—— 角标退役，
       颜色本身就是状态。琥珀仍是「正在圈选」的功能色（hover ghost / target /
       lasso 不变），不再给已落下的钉子。 */
    '.ann-badge{--ann-st:var(--ann-st-open,#5b7fa6);position:absolute;width:22px;height:22px;border-radius:50%;background:var(--ann-st);color:#fff;font-size:11px;font-weight:var(--wb-w-semibold,600);font-family:var(--wb-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff,0 1px 3px rgba(0,0,0,.35);pointer-events:auto;cursor:pointer;z-index:3;transition:box-shadow .12s ease;}',
    '.ann-badge.ann-badge--on{box-shadow:0 0 0 2px #fff,0 0 0 5px color-mix(in srgb,var(--ann-st) 32%,transparent),0 1px 3px rgba(0,0,0,.35);}',
    /* 状态只换 --ann-st 一跳，点亮环跟着同色 mix。 */
    '.ann-badge.ann-badge--check{--ann-st:var(--ann-st-check,#b87c14);}',
    '.ann-badge.ann-badge--done{--ann-st:var(--ann-st-done,#2f9e63);}',
    '.ann-badge.ann-badge--close{--ann-st:var(--ann-st-close,#858e99);}',
    /* 幽灵框：锚点解析失败但有 lastRect 时，在 lastRect 处画虚线框 + 序号钉。 */
    '.ann-ghost-rect{position:absolute;box-sizing:border-box;border:2px dashed var(--wb-faint,#8d8d8d);background:transparent;border-radius:var(--wb-r-1,4px);pointer-events:none;z-index:1;}',
    /* 关闭 / 撤销的 toast（注入端与工作台共用注入侧样式） */
    '#ann-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:var(--wb-z-float-2,2147483647);display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:rgba(28,32,36,.92);color:#fff;font:500 12.5px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.28);}',
    '#ann-toast[hidden]{display:none;}',
    '#ann-toast button{border:0;background:transparent;color:#9ec2f0;cursor:pointer;font:600 12.5px system-ui;padding:2px 4px;}',
    /* 评论卡只在 hover 钉子（或该条被定位）时出（批注 1 的后半句「hover 时显示，
       不然有点挡视野」）。这里只切可见性，不动 [hidden] —— [hidden] 归「锚点在
       视口外」那条既有规矩，两个语义不许合并。 */
    '#ann-bubbles .ann-bubble{opacity:0;pointer-events:none;transform:translateY(2px);transition:opacity .12s ease,transform .12s ease;}',
    '#ann-bubbles .ann-bubble.ann-bubble--show{opacity:1;pointer-events:auto;transform:none;}',
    /* 弹出的标注列表不能盖住被定位的气泡（ADR 0031）：钉子点亮 / 气泡显示 / 定位闪烁时整个 overlay
       升到 --wb-z-marks-active，越过面板、停靠槽与 HUD；横条仍在其上。输入框不靠这条，见 #ann-chrome。 */
    '#ann-overlay:has(.ann-badge--on),#ann-overlay:has(.ann-bubble--show),#ann-overlay:has(.ann-flash){z-index:var(--wb-z-marks-active,50);}',
    '.ann-target{position:absolute;box-sizing:border-box;border:2px solid rgba(245,166,35,.85);border-radius:var(--wb-r-1,4px);background:rgba(245,166,35,.05);pointer-events:none;z-index:1;}',
    '.ann-frame{position:absolute;box-sizing:border-box;border:2px dashed #f5a623;background:rgba(245,166,35,.06);border-radius:var(--wb-r-2,6px);pointer-events:none;z-index:1;}',
    '#ann-lasso{position:absolute;border:2px dashed #f5a623;background:rgba(245,166,35,.1);border-radius:var(--wb-r-1,4px);pointer-events:none;}',
    // 悬停提示：反色气泡，与 vendored tooltip（bg-foreground/text-background）同语言。
    '#ann-tip{position:absolute;z-index:2;max-width:min(280px,calc(100% - 24px));background:var(--wb-fg,#1c2024);color:var(--wb-surface,#fff);font-size:12px;line-height:1.4;padding:7px 12px;border-radius:var(--wb-r-2,6px);pointer-events:none;word-break:break-word;}',
    // composer：V4 收编浮层白面语言（白面 + 发丝 + sh-3 + r-4），摘掉 backdrop blur 与重阴影。
    '#ann-box{position:absolute;z-index:5;left:24px;right:24px;bottom:72px;top:auto;width:auto;max-width:460px;max-height:calc(100vh - 24px);margin:0 auto;overflow:auto;background:var(--wb-surface,#fff);color:var(--wb-fg,#1c2024);border:1px solid var(--wb-seam,rgba(0,0,0,.08));border-radius:26px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:20px;pointer-events:auto;}',
    '[data-ann-ui],[data-ann-ui] *{scrollbar-width:none}[data-ann-ui]::-webkit-scrollbar,[data-ann-ui] *::-webkit-scrollbar{display:none}',
    '#ann-box{cursor:grab}#ann-box.ann-dragging{cursor:grabbing;user-select:none}#ann-box button{cursor:pointer}#ann-input{cursor:text}',
    '#ann-input{display:block;min-height:24px;max-height:min(240px,calc(100vh - 150px));overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;line-height:24px;font-size:15px;padding:0;margin-top:0;border:0;border-radius:0;background:transparent;box-shadow:none}',
    '#ann-box #ann-input:hover,#ann-box #ann-input:focus{background:transparent;box-shadow:none;outline:none}',
    '#ann-input:empty:before{content:attr(data-placeholder);color:var(--wb-muted,#888);pointer-events:none}',
    '#ann-input .ann-inline-target{display:inline-flex;vertical-align:baseline;align-items:center;max-width:120px;border-radius:6px;padding:0 6px;background:var(--wb-fill,rgba(0,0,0,.045));color:var(--wb-muted,#555);line-height:22px;font-size:12px;white-space:nowrap}',
    '#ann-input .ann-inline-target>span{overflow:hidden;text-overflow:ellipsis}#ann-input .ann-inline-remove{background:none;padding:0 0 0 4px;opacity:0}#ann-input .ann-inline-target:hover .ann-inline-remove,#ann-input .ann-inline-target:focus-within .ann-inline-remove{opacity:1}',
    '#ann-box .acts{justify-content:space-between;align-items:center}#ann-box .ann-tools{position:relative;display:flex;align-items:center;gap:6px}#ann-box #ann-plus{font-size:22px;padding:0;width:30px;height:30px;background:transparent}',
    '#ann-tools-menu{position:absolute;bottom:36px;left:0;background:var(--wb-surface,#fff);box-shadow:var(--wb-sh-3);border-radius:10px;padding:4px;min-width:140px;z-index:6}#ann-tools-menu:not([hidden]){display:flex;flex-direction:column}#ann-tools-menu button{display:flex;gap:8px;align-items:center;background:transparent;text-align:left}',
    '#ann-mode-pills{display:flex;gap:4px}#ann-box .ann-mode-pill{border-radius:999px;font-size:11px}#ann-box .ann-mode-pill span{opacity:0;margin-left:5px}#ann-box .ann-mode-pill:hover span,#ann-box .ann-mode-pill:focus-visible span{opacity:1}',
    '#ann-imgs{margin-top:0;margin-bottom:12px}#ann-imgs:empty{display:none}',
    '#ann-box .t{font-size:11px;color:var(--wb-faint,#8d8d8d);line-height:1.45;margin-right:32px}',
    '#ann-box #ann-close{position:absolute;top:10px;right:10px;display:grid;place-items:center;width:28px;height:28px;padding:0;border-radius:999px;color:var(--wb-muted,#555);background:transparent}#ann-box #ann-close:hover{color:var(--wb-fg,#1c2024);background:rgba(0,0,0,.05)}#ann-box #ann-close svg{width:16px;height:16px}#ann-box #ann-input{padding-right:24px}#ann-box #ann-del{display:grid;place-items:center;width:32px;height:36px;padding:0;color:var(--wb-muted,#555);background:transparent}#ann-box #ann-del:hover{color:var(--wb-danger,#b84230);background:rgba(0,0,0,.04)}#ann-box #ann-del svg{width:18px;height:18px}#ann-box #ann-close-mark{display:grid;place-items:center;width:32px;height:36px;padding:0;color:var(--wb-muted,#555);background:transparent}#ann-box #ann-close-mark:hover{color:var(--ann-st-done,#2f9e63);background:rgba(0,0,0,.04)}#ann-box #ann-close-mark svg{width:18px;height:18px}',
    '#ann-box .ann-submit-actions{display:flex;align-items:center;gap:8px}',
    '.ann-target.ann-draft-target{border-color:#f5a623;background:rgba(245,166,35,.11);box-shadow:0 0 0 2px rgba(245,166,35,.13);}',
    '#ann-box .acts{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:6px;margin-top:28px;}',
    '#ann-box button{border:none;cursor:pointer;font-size:12px;padding:6px 10px;border-radius:var(--wb-r-2,6px);background:var(--wb-hover,rgba(0,0,0,.04));color:var(--wb-fg,#1c2024);white-space:nowrap;transition:background var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1)),color var(--wb-dur,.2s) var(--wb-ease,cubic-bezier(.25,0,0,1));}',
    '#ann-box button:hover{background:var(--wb-fill,rgba(0,0,0,.055));}',
    '#ann-box button.dark{background:var(--wb-accent,#5b7fa6);color:var(--wb-on-accent,#fff);font-weight:var(--wb-w-semibold,600);}',
    '#ann-box button.dark:hover{background:color-mix(in srgb,var(--wb-accent,#5b7fa6) 90%,transparent);}',
    '#ann-box button.warn{color:var(--wb-danger,#b84230);background:transparent;}',
    '#ann-box button.warn:hover{background:color-mix(in srgb,var(--wb-danger,#b84230) 10%,transparent);color:var(--wb-danger,#b84230);}',
    '#ann-box button:disabled{opacity:.4;cursor:not-allowed;}',
    '#ann-box button:disabled:hover{background:var(--wb-hover,rgba(0,0,0,.04));}',
    '#ann-box .hint{font-size:10px;color:var(--wb-faint,#8d8d8d);margin-top:6px;}',
    '#ann-mention{position:absolute;z-index:6;min-width:200px;max-width:min(280px,calc(100% - 24px));max-height:180px;overflow:auto;background:var(--wb-surface,#fff);border-radius:var(--wb-r-4,12px);box-shadow:var(--wb-sh-3,0 1px 2px rgba(0,0,0,.06),0 14px 38px rgba(0,0,0,.16));border:0;padding:4px;pointer-events:auto;}',
    '#ann-mention .ann-men-item{display:flex;gap:8px;align-items:flex-start;width:100%;border:0;background:transparent;text-align:left;font:inherit;padding:7px 8px;border-radius:var(--wb-r-3,8px);cursor:pointer;color:var(--wb-fg,#1c2024);}',
    '#ann-mention .ann-men-item.on,#ann-mention .ann-men-item:hover{background:var(--wb-hover,rgba(0,0,0,.04));}',
    '#ann-mention .ann-men-n{flex:none;font-size:11px;font-weight:var(--wb-w-bold,700);color:#f5a623;min-width:1.5em;}',
    '#ann-mention .ann-men-body{flex:1;min-width:0;font-size:12px;line-height:1.35;color:var(--wb-muted,#6b6b70);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}',
    '#ann-mention .ann-men-empty{padding:10px 8px;font-size:12px;color:var(--wb-faint,#8d8d8d);}',
    '#ann-imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;}',
    '#ann-imgs:empty{display:none;margin:0;}',
    '#ann-imgs .im{position:relative;width:56px;height:56px;border-radius:var(--wb-r-3,8px);overflow:hidden;border:0;}',
    '#ann-imgs .im img{width:100%;height:100%;object-fit:cover;display:block;}',
    '#ann-imgs .im .x{position:absolute;top:1px;right:1px;width:16px;height:16px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:11px;line-height:16px;text-align:center;cursor:pointer;}',
    '@keyframes annFlash{0%,100%{background:rgba(245,166,35,.07);box-shadow:none}15%,85%{background:rgba(245,166,35,.2);box-shadow:0 0 0 4px rgba(245,166,35,.22)}}',
    '.ann-hover-ghost.ann-flash{animation:annFlash 1.5s ease-out}',
    // a11y 基线：注入的每个控件都要有可见 focus 态；reduced-motion 下关掉全部过渡/动画。
    // focus 环与 workbench 全局 catch-all 同式（accent color-mix，V4 起双端一致）。
    '[data-ann-ui] :is(button,a,input,textarea,select,[tabindex]):focus-visible{outline:2px solid color-mix(in srgb,var(--wb-accent,#5b7fa6) 55%,transparent);outline-offset:1px;}',
    // 暗色（2026-09-23）：跟随系统 prefers-color-scheme，与宿主页是否暗色无关 ——
    // 输入框、面板、评论卡的底与字同时换，文字不会再落在白底上看不见。值与
    // src/workbench/wb-tokens.css 的暗色段同值（改一边连另一边）；状态色与 accent 不换。
    // 本条必须排在 #ann-sidebar 钉值规则之后：同优先级靠后者生效，且守卫测试取第一条 #ann-sidebar{。
    '@media (prefers-color-scheme: dark){[data-ann-ui],#ann-sidebar{--wb-surface:#272a2d;--wb-side:#212225;--wb-fg:#edeef0;--wb-muted:#b0b4ba;--wb-faint:#777b84;--wb-line:rgba(255,255,255,.08);--wb-seam:rgba(255,255,255,.1);--wb-hover:rgba(255,255,255,.06);--wb-fill:rgba(255,255,255,.08);--wb-danger:#e5735f;--wb-ok:#4cc38a;--wb-ok-soft:rgba(76,195,138,.14);--wb-glass:rgba(33,34,37,.88);--wb-glass-hi:rgba(255,255,255,.06);--ann-amber-bg:color-mix(in srgb,#f5a623 20%,#272a2d);--ann-amber-fg:#f5b94a;--ann-ink:#edeef0;--ann-ink-hover:#d7d9dd;--ann-on-ink:#111;--wb-sh-1:0 1px 2px rgba(0,0,0,.4),0 0 0 0.5px rgba(255,255,255,.06);--wb-sh-2:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.45);--wb-sh-3:0 1px 2px rgba(0,0,0,.4),0 14px 38px rgba(0,0,0,.55);}}',
    '@media (prefers-reduced-motion: reduce){[data-ann-ui],[data-ann-ui] *,[data-ann-ui] *::before,[data-ann-ui] *::after{transition:none !important;animation:none !important;}}',
    // mention 空态不渲染盒子 Chrome —— 带边框阴影的空态看起来像坏掉的输入框。
    '#ann-mention:has(.ann-men-empty){min-width:0;border:0;box-shadow:none;background:transparent;}',
    '#ann-mention .ann-men-empty{padding:6px 8px;}',
    // composer / 侧栏动作钮里的线性图标（lucide 风格内联 SVG，替代 emoji）。
    '#ann-box button svg{display:inline-block;width:13px;height:13px;vertical-align:-2px;}',
    '#ann-box .acts button{display:inline-flex;align-items:center;gap:5px;}',
    '#ann-sidebar .ann-sb-acts button svg{display:block;width:12px;height:12px;margin:auto;}',
    bubbleCss()
  ].join('\n');
}
