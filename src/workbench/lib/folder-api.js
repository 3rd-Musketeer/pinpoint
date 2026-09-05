// 登记表分组层的写侧客户端（ADR 0032）：左栏的拖放不绕 CLI，打的是服务端那
// 三条 PUT（契约与错误口径见 docs/registry.md「workbench 的三条写接口」）。
//
// 每条接口的应答就是重载后的完整 /registry 载荷——所以这里写完直接把载荷灌回
// react-query 的 registry-sites 缓存并重建 page manifest，左栏当场重排，不必等
// HMR 的 registry:update 绕一圈（那条广播照旧会到，它顺带重摆当前板）。
//
// 坏输入服务端一律 400 + 一句人话，登记表一个字节不动。这里把那句话原样抛出去，
// 调用方负责让人看见——静默失败会让一次拖放看起来「什么都没发生」。
import { refreshRegistry } from '../pages.js';

async function put(path, body) {
  var response = await fetch(path, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  var payload = null;
  try { payload = await response.json(); } catch (e) { payload = null; }
  if (!response.ok) {
    throw new Error((payload && payload.message) || (payload && payload.error) || String(response.status));
  }
  await refreshRegistry(payload);
  return payload;
}

/** 整表替换：建夹 / 改名 / 删夹 / 折叠 / 重排共用这一条。 */
export function putFolders(folders) {
  return put('/registry/folders', { folders: folders });
}

/** 一个页进夹 / 出夹（folder = null 就是拖成散页）。 */
export function putPageFolder(pageId, folder, order) {
  var body = { folder: folder == null ? null : folder };
  if (Number.isFinite(order)) body.order = order;
  return put('/registry/entries/' + encodeURIComponent(pageId) + '/folder', body);
}

/** 按给定顺序写 order 0、1、2…（夹内手动排序，只在「默认」档用得上）。 */
export function putPageOrder(ids) {
  return put('/registry/order', { ids: ids });
}
