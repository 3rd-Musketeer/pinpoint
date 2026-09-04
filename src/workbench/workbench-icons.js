import { createElement } from 'lucide';
import { HERO_GEAR_SOLID, ICONS } from './lib/wb-icons.js';

function createHeroGear(size, className) {
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill-rule', 'evenodd');
  path.setAttribute('clip-rule', 'evenodd');
  path.setAttribute('d', HERO_GEAR_SOLID);
  svg.appendChild(path);
  return svg;
}

function mountIcon(el, name, size) {
  if (!el) return;
  var className = el.className || 'wb-ico';
  var svg;
  if (name === 'settings') {
    svg = createHeroGear(size, className);
  } else {
    var icon = ICONS[name];
    if (!icon) return;
    svg = createElement(icon, {
      width: size,
      height: size,
      'stroke-width': 1.75,
      class: className,
      'aria-hidden': 'true'
    });
  }
  el.replaceWith(svg);
}

export function mountWorkbenchIcons(root) {
  var scope = root || document;
  scope.querySelectorAll('[data-wb-icon]').forEach(function (el) {
    var name = el.getAttribute('data-wb-icon');
    var size = parseInt(el.getAttribute('data-wb-icon-size') || '14', 10);
    mountIcon(el, name, size);
  });
}

mountWorkbenchIcons();
window.mountWorkbenchIcons = mountWorkbenchIcons;
