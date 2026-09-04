# 0019 · live 代理画中画：同源路径前缀代理 + 运行时重基（阶段 4/5 落地）

Status: 现行（已落地） · Date: 2026-08-16 · Scope: `src/server/lib/site-proxy.js`、`src/shared/proxy-rebase.js`

**Decided**:

- url 条目挂 `/sites/<id>/` 同源代理（与 dir/file 同一 URL 空间）：HTTP 全透传 + 响应重写（HTML 的 src/href/action/srcset 等根绝对路径加前缀、CSS url()、3xx Location、Set-Cookie 去 Domain 加前缀、CSP/X-Frame-Options/COOP/COEP 剥离）+ 运行时重基 bootstrap（patch fetch/XHR/EventSource/WebSocket/sendBeacon 的根绝对 URL，annotate client 端点按名单豁免）+ WS upgrade 转发兜底。目标应用零感知（08-07 注入契约延伸）。
- **SPA 路由虚拟化**：my-todos 这类 router 直读 `location.pathname` 的 SPA，前缀路径会掉 catch-all；bootstrap 用 replaceState 把 URL 虚拟回应用路径。意外收获：标注账本 page key 落应用路径，与扩展在目标 origin 注入出的账本**逐字节同 key**——代理与扩展两处标注天然汇合到同一账本（活体实测：`global_u0km1e.json`）。
- url 条目进 Pages（doc 壳），`synth-board` 合成单屏板（src = `sites/<id>/`）；代理路径下 `?annotate=off` 只关标注注入，bootstrap/重写保留（是代理机制的一部分）。
- **跨域 iframe + postMessage 桥路线废弃**：同源代理使桥不必要；backlog 条目关闭。
- 已知盲区（README/AGENTS/SKILL 已录）：DOM 属性赋 URL（`img.src='/x'`）、`//` 协议相对 URL、目标路由与豁免名单撞名、同源共享 localStorage、`location.href` 硬导航跳出代理。

**证据**：my-todos 活体 13/13（内嵌渲染、assets/API/SSE 全经代理、标注落桶同扩展账本、验证后数据逐字节恢复）；unit 228→256、e2e 63→67。
