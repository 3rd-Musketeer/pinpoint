import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * P0 smoke mount (goal-20260810-workbench-react-rebuild): proves the JSX →
 * vite → React runtime pipeline inside the real page while all chrome is
 * still imperative. P1 replaces this hidden root with the actual React
 * chrome tree (sidebar / HUD / footer / dialogs) and deletes the marker.
 */
const host = document.createElement('div');
host.id = 'wb-react-root';
host.hidden = true;
document.body.appendChild(host);

createRoot(host).render(createElement('span', { 'data-react-smoke': 'p0' }));
