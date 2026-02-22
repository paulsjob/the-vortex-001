import { create } from 'zustand';
import type { InteractionMode } from '../types/domain';

interface StudioStore {
  canvasWidth: number;
  canvasHeight: number;
  selectedLayerId: string | null;
  interactionMode: InteractionMode;
  sidebarTab: 'layers' | 'assets';
  setCanvasSize: (w: number, h: number) => void;
  setSelectedLayerId: (id: string | null) => void;
  setInteractionMode: (mode: InteractionMode) => void;
  setSidebarTab: (tab: 'layers' | 'assets') => void;
}

export const useStudioStore = create<StudioStore>((set) => ({
  canvasWidth: 1920,
  canvasHeight: 1080,
  selectedLayerId: null,
  interactionMode: 'select',
  sidebarTab: 'layers',
  setCanvasSize: (canvasWidth, canvasHeight) => set({ canvasWidth, canvasHeight }),
  setSelectedLayerId: (selectedLayerId) => set({ selectedLayerId }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab }),
}));
