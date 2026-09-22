// Button — props: variant "filled"|"tinted"|"gray"|"plain"(默认) · size "sm"|"md"(默认)|"lg" · destructive · pill · block · disabled · children
// DOM/class 以 components/button/catalog.html 为准（.ios-btn 族）。
export function Button({ variant = 'plain', size = 'md', destructive = false, pill = false, block = false, disabled = false, children }) {
  const cls = [
    'ios-btn',
    variant !== 'plain' && variant,
    destructive && 'destructive',
    size !== 'md' && size,
    pill && 'pill',
    block && 'block',
  ].filter(Boolean).join(' ');
  return <button class={cls} disabled={disabled || undefined}>{children}</button>;
}
