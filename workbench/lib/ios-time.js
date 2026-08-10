// iOS 状态栏时间 <-> <input type="time"> 的纯格式转换。从 workbench.js 平移。
export function iosTimeFromInput(val) {
  if (!val) return '9:41';
  var p = val.split(':');
  return parseInt(p[0], 10) + ':' + p[1];
}

export function inputFromIosTime(t) {
  var p = (t || '9:41').split(':');
  var h = parseInt(p[0], 10);
  var m = p[1] || '00';
  return (h < 10 ? '0' : '') + h + ':' + m;
}
