// List — props: header · footer · children（Cell 行）
// Cell — props: title · value · icon（emoji）· iconBg · tappable · chevron · children（右侧自定义，如 <Switch />）
// DOM/class 以 components/list/catalog.html 为准（.ios-section > .ios-list-header/.ios-list/.ios-list-footer，.ios-cell[.has-icon][.tappable]）。
export function List({ header, footer, children }) {
  return (
    <div class="ios-section">
      {header ? <div class="ios-list-header">{header}</div> : null}
      <div class="ios-list">{children}</div>
      {footer ? <div class="ios-list-footer">{footer}</div> : null}
    </div>
  );
}

export function Cell({ title, value, icon, iconBg, tappable = false, chevron = false, children }) {
  const cls = ['ios-cell', icon && 'has-icon', tappable && 'tappable'].filter(Boolean).join(' ');
  return (
    <div class={cls}>
      {icon ? <span class="ios-icon-tile ios-emo" style={iconBg ? { background: iconBg } : undefined}>{icon}</span> : null}
      <span class="ios-cell-body"><div class="ios-cell-title">{title}</div></span>
      {value ? <span class="ios-cell-value">{value}</span> : null}
      {children}
      {chevron ? <span class="ios-chev"><svg><use href="#c-chev" /></svg></span> : null}
    </div>
  );
}
