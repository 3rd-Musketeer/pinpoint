// PREVIEW_TEMPLATE_ONLY=1 hides instance-local content (components outside
// kits/ios/components/_index.json) so checks see the same board set on every
// machine — e2e and release verification run against pure template state.
// （_index.local.json 覆盖机制已于 pp2 切片 3 退役，本函数不再为它服务。）
export function templateOnly() {
  return !!process.env.PREVIEW_TEMPLATE_ONLY;
}
