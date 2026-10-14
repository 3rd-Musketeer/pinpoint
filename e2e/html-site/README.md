# e2e/html-site

HTML 帧的固件（e2e/html-frames.spec.js）：project `e2e-html`，一篇 `pages`，常驻 e2e 的共享 registry（e2e/registry-fixture.js）。

- `long-page.html` 在文章目录里，引用 `assets/page.css`；页面很长，`#deep-pill` 在 y > 5000 处。
- `catalog` 写成 `{ id, src }`，指 project 根下的 `shared/catalog.html`，它引用 `catalog.css` 和 `img/dot.svg`（相对它自己的目录）。
- `phone-card.jsx` 是一个手机 JSX 帧。
