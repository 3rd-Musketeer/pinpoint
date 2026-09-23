// Chip — props: tone "blue"(默认)|"green"|"amber"|"violet"|"red" · children
// Badge — props: children（计数）
// DOM/class 以 components/chip/catalog.html 为准（.ios-chip.<tone> / .ios-badge）。
export function Chip({ tone = 'blue', children }) {
  return <span class={`ios-chip ${tone}`}>{children}</span>;
}

export function Badge({ children }) {
  return <span class="ios-badge">{children}</span>;
}
