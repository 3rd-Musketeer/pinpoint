// Esc 在捕获段记录归属，冒泡段才退出当前层，避免一次按键关掉两层。
import { wbGet } from './app/store.js';
import { annotateApi } from './ann-bridge.js';

/** 按键所在文档的输入、标注框、提及、箭头或标注模式占着这一下 Esc。 */
export function annotationEscapeIsTaken(doc, api, target) {
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return true;
  if (doc.querySelector('#ann-mention, #ann-box, #ann-lasso')) return true;
  if (api && typeof api.hasActiveDraft === 'function' && api.hasActiveDraft()) return true;
  return !!(api && typeof api.getState === 'function' && api.getState().mode);
}

/** 工作台的面板、菜单、对话框与当前文档的标注层共用一份判断；画布选中不算一层。 */
export function workbenchEscapeIsTaken(doc, target) {
  var s = wbGet();
  if (s.sectionNavOpen || s.minimapOpen || s.annListOpen) return true;
  if (document.querySelector('#wboutline-pop, [role="menu"], dialog[open]')) return true;
  var api = doc === document ? annotateApi() : doc.defaultView && doc.defaultView.pinpoint;
  if (annotationEscapeIsTaken(doc, api, target)) return true;
  // 在子 iframe 里按键时，工作台自己的草稿也有优先权。
  return doc !== document && annotationEscapeIsTaken(document, annotateApi(), null);
}
