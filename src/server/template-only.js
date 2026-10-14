// PREVIEW_TEMPLATE_ONLY=1 keeps compile targets on pure template state, so e2e
// (playwright.config.js sets it) sees the same targets on every machine.
// （_index.local.json 覆盖机制已于 pp2 切片 3 退役，本函数不再为它服务。）
export function templateOnly() {
  return !!process.env.PREVIEW_TEMPLATE_ONLY;
}
