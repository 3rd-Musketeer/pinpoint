// 各 spec 共用的 workbench 前置（2026-09-05 抽出：之前四个文件各抄一份）。

/**
 * 模板页（Component Library / Example Library / Example HTML）2026-09-04 起默认
 * 不显示（ADR 0032，开关在预览设置）。要在这三页上断言的 spec 进 workbench 之前
 * 先把开关打开——init script 在页面脚本之前跑，合并写进同一份 prefs，不动其它偏好。
 */
export async function seedTemplatePagesVisible(page) {
  await page.addInitScript(() => {
    try {
      const key = 'pinpoint-wb';
      const prefs = JSON.parse(localStorage.getItem(key) || '{}');
      prefs.showTemplatePages = true;
      localStorage.setItem(key, JSON.stringify(prefs));
    } catch { /* 读不到 localStorage 时让断言自己失败，不在这里吞 */ }
  });
}
