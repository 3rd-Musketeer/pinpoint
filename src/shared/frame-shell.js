/**
 * Frame 机壳（阶段 5 抽为共享纯函数）：画布装载（src/workbench/screen-load.js）
 * 与 /api/frame 嵌入页 + 文档导出烤图（src/server/lib/frame-doc.js）必须用同一份
 * 机壳，两端 stage 以下的 DOM 链才逐字节同构 —— 标注锚点的 frame 内归一
 * （src/shared/frame-anchor.js）依赖这个不变量。
 *
 * 纯函数、DOM-free。
 */

/** True if the fragment already includes phone chrome (legacy full-shell files). */
export function looksPhoneWrapped(html) {
  return /\bios-stage\b/.test(html) || /\bios-device\b/.test(html);
}

/**
 * Wrap screen body in shared phone chrome.
 * Agent writes only in-screen content; loader owns stage/device/bezel/statusbar/home.
 * shell: "app" (default) | "lock"
 */
export function wrapPhoneShell(bodyHtml, shell) {
  if (looksPhoneWrapped(bodyHtml)) return bodyHtml;
  var screenClass = shell === 'lock' ? 'ios-screen ios-lock' : 'ios-screen';
  return (
    '<div class="ios-stage">' +
      '<div class="ios-root screen-only" data-device="iphone-16-pro" data-theme="light">' +
        '<div class="ios-device">' +
          '<span class="ios-key act"></span><span class="ios-key vup"></span>' +
          '<span class="ios-key vdn"></span><span class="ios-key pwr"></span>' +
          '<div class="ios-bezel"><div class="' + screenClass + '">' +
            '<div class="ios-island"></div>' +
            '<div class="ios-statusbar"><span class="ios-sb-time"></span><span class="ios-sb-icons"></span></div>' +
            bodyHtml +
            '<div class="ios-home"></div>' +
          '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>'
  );
}

/** Component Library: light board, no phone chrome. Still uses .ios-root for tokens/theme. */
export function wrapCompStage(bodyHtml) {
  if (looksPhoneWrapped(bodyHtml)) return bodyHtml;
  return (
    '<div class="wb-comp-stage">' +
      '<div class="ios-root" data-theme="light">' +
        bodyHtml +
      '</div>' +
    '</div>'
  );
}

export function wrapFragmentForLibrary(html) {
  var t = (html || '').trim();
  if (!t) return '<div class="ios-app"><div class="ios-page"></div></div>';
  if (/\bios-app\b/.test(t) || /\bios-lockscreen\b/.test(t)) return t;
  return '<div class="ios-app" style="display:flex;flex-direction:column">' +
    '<div class="ios-page" style="flex:1;display:flex;flex-direction:column;gap:10px;justify-content:center">' +
    t +
    '</div></div>';
}
