# 0008 · 设计语言锚：扁平 / Linear 风 / light theme（owner 审美准则）

Status: 部分被取代（准则本体仍现行） · Date: 2026-08-11 · Scope: `src/workbench/`、`src/client/annotate.js`、`docs/design.md`

Superseded-by: ADR 0010（accent 值与功能色微调）、ADR 0031（反模式清单里的“毛玻璃”一条，其余准则不动）

**Decided**（owner 钦定，本 repo 一切 UI 工作的验收尺）: chrome 与注入端一律扁平 Linear 系 light 风。具体表现形式：
- **色彩**：中性灰阶低饱和；分层靠明度差不靠边框；唯一强调色 accent #007aff（主行动/选中态），功能色 danger/琥珀（标注武装）/绿（成功回显）各一枚；无渐变、无彩色图标。
- **边界**：禁 1px 描边卡片；分区靠留白与明度差，浮层靠阴影阶梯（--wb-sh-1..4）；描边只作功能信号（锚点框/套索/focus 环）；圆角控件 6 / 面板 12 / 模态 20，药丸只属于 badge/tag。
- **控件**：ghost 优先（透明底 + hover 浅灰填充），主行动才给实心色面；分段控件 = 灰槽 + 白面选中项；28px 高、13/12/10.5px 字阶、4 的倍数间距；hover/focus-visible/active/disabled 全态；过渡 ≤150ms，尊重 reduced-motion。
- **字体图标**：系统字栈；字重四档；读数 tabular-nums；区头 10.5px semibold 大写加字距；lucide 线性图标（1.75 描边，12/14/16 三档）；emoji 不当图标。
- **反馈**：状态变化用填充/字色不用描边；即时回显低打扰（ok 态消退，不弹 toast）；危险动作用 danger 浅面克制写法；键盘可达（roving focus / Esc / focus 还原）。
- **布局**：信息密度优先于呼吸感；画布内容永远是视觉重心，chrome 退后；严格左对齐与控件网格。
- **反模式**：hairline 卡片、渐变、毛玻璃、彩色阴影、大圆角卡片、emoji 图标、多强调色、满 bleed 色块。
**Why**: owner 对 V0-V4 换皮的终审反馈——灰槽 + 发丝边卡片是「AI 味」模板脸；此前配方太保守导致「改了这么多视觉没变化」。
**Consequences**: `--wb-sh-line` 叠用与各处 border-border 在 2026-08-11 扁平化试点中清除（侧栏/浮层/舞台/对话框）；后续新增 UI 一律按此验收。
