import { create } from 'zustand';
import type { Layer, TextLayer } from '../types/domain';
import type { SavedTemplate } from './useTemplateStore';

interface LayerTemplate {
  id: string;
  name: string;
  layerIds: string[];
  canvasWidth: number;
  canvasHeight: number;
  createdAt: string;
}

interface LayerStore {
  layers: Layer[];
  canvasWidth: number;
  canvasHeight: number;
  templates: LayerTemplate[];
  loadedTemplateId: string | null;
  addText: () => void;
  addShape: () => void;
  addAssetLayer: (assetId: string, dimensions?: { width: number; height: number }) => void;
  duplicateLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Layer>) => void;
  renameLayer: (id: string, name: string) => void;
  deleteLayer: (id: string) => void;
  setZOrder: (id: string, direction: 'up' | 'down') => void;
  moveLayer: (sourceId: string, targetId: string) => void;
  setCanvasSize: (canvasWidth: number, canvasHeight: number) => void;
  saveTemplate: (name: string) => void;
  loadTemplate: (template: SavedTemplate) => void;
  clearLoadedTemplate: () => void;
  setLoadedTemplateId: (templateId: string | null) => void;
}

const DEFAULT_TRANSFORM = {
  anchorX: 0,
  anchorY: 0,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
  visible: true,
  locked: false,
};

const withTextDefaults = (layer: TextLayer): TextLayer => ({
  ...layer,
  fontFamily: layer.fontFamily || 'Inter',
  dataBindingSource: layer.dataBindingSource || 'manual',
  dataBindingField: layer.dataBindingField || '',
  textAlign: layer.textAlign || 'left',
  textMode: layer.textMode || 'point',
});

export const useLayerStore = create<LayerStore>((set) => ({
  layers: [],
  canvasWidth: 1920,
  canvasHeight: 1080,
  templates: [],
  loadedTemplateId: null,
  addText: () => set((s) => ({
    layers: [...s.layers, {
      id: `text-${Date.now()}`,
      kind: 'text',
      name: `Text ${s.layers.length + 1}`,
      text: 'New Text Layer',
      x: 32,
      y: 64,
      zIndex: s.layers.length,
      opacity: 100,
      color: '#ffffff',
      size: 56,
      fontFamily: 'Inter',
      dataBindingSource: 'manual',
      dataBindingField: '',
      textAlign: 'left',
      textMode: 'point',
      ...DEFAULT_TRANSFORM,
    }],
  })),
  addShape: () => set((s) => ({
    layers: [...s.layers, {
      id: `shape-${Date.now()}`,
      kind: 'shape',
      name: `Shape ${s.layers.length + 1}`,
      x: 120,
      y: 120,
      zIndex: s.layers.length,
      opacity: 100,
      shapeType: 'rectangle',
      width: 320,
      height: 120,
      fill: '#1d4ed8',
      ...DEFAULT_TRANSFORM,
    }],
  })),
  addAssetLayer: (assetId, dimensions) => set((s) => {
    const sourceWidth = Math.max(1, dimensions?.width ?? s.canvasWidth);
    const sourceHeight = Math.max(1, dimensions?.height ?? s.canvasHeight);
    const fitScale = Math.min(s.canvasWidth / sourceWidth, s.canvasHeight / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * fitScale));
    const height = Math.max(1, Math.round(sourceHeight * fitScale));
    return {
      layers: [...s.layers, {
        id: `asset-${Date.now()}`,
        kind: 'asset',
        name: `Asset ${s.layers.length + 1}`,
        assetId,
        x: 0,
        y: 0,
        zIndex: s.layers.length,
        opacity: 100,
        width,
        height,
        ...DEFAULT_TRANSFORM,
      }],
    };
  }),
  duplicateLayer: (id) => set((s) => {
    const target = s.layers.find((layer) => layer.id === id);
    if (!target) return s;
    const nextZ = Math.max(-1, ...s.layers.map((layer) => layer.zIndex)) + 1;
    const clone: Layer = {
      ...structuredClone(target),
      id: `${target.kind}-${Date.now()}`,
      name: `${target.name} Copy`,
      x: target.x + 10,
      y: target.y + 10,
      zIndex: nextZ,
      visible: true,
      locked: false,
    };
    return { layers: [...s.layers, clone] };
  }),
  updateLayer: (id, patch) => set((s) => ({ layers: s.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)) })),
  renameLayer: (id, name) => set((s) => ({ layers: s.layers.map((l) => (l.id === id ? { ...l, name } : l)) })),
  deleteLayer: (id) => set((s) => ({ layers: s.layers.filter((l) => l.id !== id).map((l, i) => ({ ...l, zIndex: i })) })),
  setZOrder: (id, direction) => set((s) => {
    const sorted = [...s.layers].sort((a, b) => a.zIndex - b.zIndex);
    const idx = sorted.findIndex((l) => l.id === id);
    const t = direction === 'up' ? idx + 1 : idx - 1;
    if (idx < 0 || t < 0 || t >= sorted.length) return s;
    [sorted[idx], sorted[t]] = [sorted[t], sorted[idx]];
    return { layers: sorted.map((l, i) => ({ ...l, zIndex: i })) };
  }),

  moveLayer: (sourceId, targetId) => set((s) => {
    if (sourceId === targetId) return s;
    const sorted = [...s.layers].sort((a, b) => a.zIndex - b.zIndex);
    const from = sorted.findIndex((l) => l.id === sourceId);
    const to = sorted.findIndex((l) => l.id === targetId);
    if (from < 0 || to < 0) return s;
    const [moved] = sorted.splice(from, 1);
    sorted.splice(to, 0, moved);
    return { layers: sorted.map((l, i) => ({ ...l, zIndex: i })) };
  }),
  setCanvasSize: (canvasWidth, canvasHeight) => set({ canvasWidth, canvasHeight }),
  saveTemplate: (name) => set((s) => ({
    templates: [{ id: `tpl-${Date.now()}`, name, layerIds: s.layers.map((l) => l.id), canvasWidth: s.canvasWidth, canvasHeight: s.canvasHeight, createdAt: new Date().toISOString() }, ...s.templates],
  })),
  loadTemplate: (template) => set({
    loadedTemplateId: template.id,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    layers: structuredClone(template.layers).map((layer) => {
      const base = { ...DEFAULT_TRANSFORM, ...layer } as Layer;
      if (base.kind === 'text') return withTextDefaults(base as TextLayer);
      if (base.kind === 'shape') return { ...base, shapeType: base.shapeType ?? 'rectangle' };
      return base;
    }),
  }),
  clearLoadedTemplate: () => set({ loadedTemplateId: null }),
  setLoadedTemplateId: (templateId) => set({ loadedTemplateId: templateId }),
}));
