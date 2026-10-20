/* 文章页的正文评论入口。article-proxy 只给文章页注入这一份，不注入完整标注客户端。
 * 画布浮层里的工作台仍走 /annotate.js。分流条件和 annotate/boot.js 的文章页分支一致：
 * 有 __pinpointEntry 就起正文评论，不起工具条和侧栏。 */
import { startProseComments } from './prose-comments.js';

if (window.__pinpointEntry) {
  var server = '';
  var src = document.currentScript && document.currentScript.src;
  if (src) { try { server = new URL(src).origin; } catch (e) { /* 拿不到 origin 就同源 */ } }
  var start = function () {
    startProseComments({ server: server, entry: String(window.__pinpointEntry) });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
