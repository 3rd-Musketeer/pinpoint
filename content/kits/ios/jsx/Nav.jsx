// Nav — props: title · size "large"(默认)|"compact" · back（compact 的返回文案）· trail（compact 的右侧钮文案）· eyebrow（large 的眉行）· sub（large 的副标题）
// DOM/class 以 components/nav/{compact,large}.html 为准（.ios-navbar / .ios-nav 大标题）。
export function Nav({ title, size = 'large', back, trail, eyebrow, sub }) {
  if (size === 'compact') {
    return (
      <div class="ios-navbar">
        {back ? <button class="ios-back ios-nav-lead"><svg><use href="#c-back" /></svg>{back}</button> : null}
        <div class="ios-nav-title">{title}</div>
        {trail ? <button class="ios-nav-trail ios-btn" style={{ color: 'var(--ios-accent)', padding: '6px 8px' }}>{trail}</button> : null}
      </div>
    );
  }
  return (
    <div class="ios-nav">
      {eyebrow ? <div class="ios-nav-eyebrow">{eyebrow}</div> : null}
      <h1>{title}</h1>
      {sub ? <div class="ios-nav-sub">{sub}</div> : null}
    </div>
  );
}
