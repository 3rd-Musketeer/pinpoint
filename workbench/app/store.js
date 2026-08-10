import { create } from 'zustand';

/**
 * Workbench chrome UI state (P0 skeleton).
 *
 * Ownership rule (goal-20260810-workbench-react-rebuild): this store holds
 * *chrome* state only — sidebar/footer/HUD/settings UI. Stage state (mounted
 * screens, iframes, minimap geometry, annotation marks) stays in the
 * imperative layer and bridges in through explicit calls. P1 wires components
 * to these fields; until then nothing subscribes.
 */
export const useWorkbenchStore = create((set) => ({
  // sidebar shell
  sideCollapsed: false,
  sideWidth: 252,
  sectionOpen: { pages: true, annotations: true },
  // board + pages
  boardMode: 'ios',
  activePageId: null,
  // annotation panel
  annFilter: 'all',
  // preview chrome
  theme: 'light',

  patch: (partial) => set(partial),
}));
