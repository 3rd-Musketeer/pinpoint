/**
 * Frame 机壳与 include 展开（阶段 5 抽为共享纯函数）：画布装载
 * （workbench/screen-load.js）与 /api/frame 嵌入页 + 文档导出烤图
 * （server/lib/frame-doc.js）必须用同一份机壳，两端 stage 以下的 DOM 链才逐字节
 * 同构 —— 标注锚点的 frame 内归一（lib/frame-anchor.js）依赖这个不变量。
 *
 * 纯函数、DOM-free；loader 注入让 client（fetch）与 server（fs）各带自己的取数。
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

export function parseIncludeRef(ref) {
  var m = String(ref || '').trim().match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)$/);
  return m ? { component: m[1], variant: m[2] } : null;
}

// ref 已经 parseIncludeRef 白名单校验（[a-zA-Z0-9_-]），失败分支的转义只是兜底。
function escapeRefText(ref) {
  return String(ref).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Expand <div data-ios-include="comp/variant" data-text="…"> placeholders.
 * loadVariant({ component, variant }) → Promise<string|null>：取不到的 include
 * 渲染为 .wb-screen-err 错误块（与画布装载同约）。applyIncludeSlots 逻辑留在
 * workbench/lib/include-slots.js（本函数的调用方各传）。
 */
export function expandIncludeRefs(html, loadVariant, applySlots) {
  var re = /<([a-zA-Z0-9]+)([^>]*?)\bdata-ios-include=(["'])([^"']+)\3([^>]*)>(?:\s*<\/\1>)?/gi;
  var refs = [];
  var m;
  while ((m = re.exec(html))) {
    if (refs.indexOf(m[4]) < 0) refs.push(m[4]);
  }
  if (!refs.length) return Promise.resolve(html);
  return Promise.all(refs.map(function (ref) {
    var parsed = parseIncludeRef(ref);
    if (!parsed) return Promise.resolve({ ref: ref, html: null });
    return Promise.resolve(loadVariant(parsed)).then(
      function (frag) { return { ref: ref, html: frag }; },
      function () { return { ref: ref, html: null }; }
    );
  })).then(function (rows) {
    var byRef = {};
    rows.forEach(function (row) { byRef[row.ref] = row.html; });
    return html.replace(re, function (full, tag, pre, q, ref, post) {
      var attrs = (pre || '') + (post || '');
      var fetched = byRef[ref];
      if (typeof fetched !== 'string') {
        return '<div class="wb-screen-err">include 失败 · ' + escapeRefText(ref) + '</div>';
      }
      var frag = fetched.trim();
      frag = applySlots(frag, attrs);
      // Mark include root for annotate → component source routing
      if (/^<([a-zA-Z0-9]+)/.test(frag)) {
        frag = frag.replace(/^<([a-zA-Z0-9]+)/, '<$1 data-ios-from="' + ref + '"');
      }
      return frag;
    });
  });
}
