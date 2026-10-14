# e2e/html-site

HTML 帧的固件（e2e/html-frames.spec.js）：project `e2e-html`，一篇 `pages`，常驻 e2e 的共享 registry（e2e/registry-fixture.js）。

- `long-page.html` 在文章目录里，引用 `assets/page.css`；页面很长，`#deep-pill` 在 y > 5000 处。
- `catalog` 写成 `{ id, src }`，指 project 根下的 `shared/catalog.html`，它引用 `catalog.css` 和 `img/dot.svg`（相对它自己的目录）。
- `widget` 写成 `{ id: "widget", src: "kit:widget.html" }`：`project.json` 的 `sources` 把 `kit` 登记成 `../html-source`（即 `e2e/html-source/`，在 project 根外面）。
- `phone-card.jsx` 是一个手机 JSX 帧。

第二篇 `docs-only`（e2e/ppnt-html-shots.spec.js）只有 HTML 帧，画布那一行是空的：

- `lazy-page.html` 很长，第一屏之外有一个 `loading="lazy"` 的 iframe `nested/outer.html`（整块绿），它里面往下 500px 又嵌一个懒加载的 `nested/inner.html`（整块粉）；再往下是一张懒加载的图片 `nested/block.svg`（整块蓝）。截图里三种颜色都在，才说明三样都加载出来了。
- `short-page.html` 只有一屏。
