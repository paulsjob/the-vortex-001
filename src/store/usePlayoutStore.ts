import { create } from 'zustand';
import type { SavedTemplate } from './useTemplateStore';

interface PlayoutStore {
  previewTemplate: SavedTemplate | null;
  programTemplate: SavedTemplate | null;
  lastTakeAt: string | null;
  setPreviewTemplate: (template: SavedTemplate | null) => void;
  takeToProgram: () => void;
  clearProgram: () => void;
}

export const usePlayoutStore = create<PlayoutStore>((set, get) => ({
  previewTemplate: null,
  programTemplate: null,
  lastTakeAt: null,
  setPreviewTemplate: (template) => set({ previewTemplate: template }),
  takeToProgram: () => {
    const preview = get().previewTemplate;
    if (!preview) return;
    set({
      programTemplate: preview,
      lastTakeAt: new Date().toISOString(),
    });
  },
  clearProgram: () => set({ programTemplate: null }),
}));

