/**
 * Escape a value for interpolation into HTML text or double-quoted attributes.
 * Shared by the workbench chrome and the export dialogs.
 */
export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
