// Callout — props: tone "amber"(默认，无附加 class)|"blue"|"green" · title · children
// DOM/class 以 components/callout/catalog.html 为准（.ios-callout[.<tone>] > .ios-callout-h + .ios-callout-b）。
export function Callout({ tone = 'amber', title, children }) {
  const cls = tone === 'amber' ? 'ios-callout' : `ios-callout ${tone}`;
  return (
    <div class={cls}>
      <div class="ios-callout-h">{title}</div>
      <div class="ios-callout-b">{children}</div>
    </div>
  );
}
