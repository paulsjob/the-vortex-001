import { create } from 'zustand';
import type { Layer } from '../types/domain';

const STORAGE_KEY = 'renderless.savedDesignTemplates.v1';

type TemplateFolder = {
  id: string;
  name: string;
  parentId: string | null;
  children: string[];
  createdAt: string;
};

export type SavedTemplate = {
  id: string;
  name: string;
  folderId: string;
  canvasWidth: number;
  canvasHeight: number;
  layers: Layer[];
  createdAt: string;
  updatedAt?: string;
};

type PersistedTemplateState = {
  rootId: string;
  folders: TemplateFolder[];
  templates: SavedTemplate[];
};

const defaultState = (): PersistedTemplateState => ({
  rootId: 'template-root',
  folders: [{ id: 'template-root', name: 'Templates', parentId: null, children: [], createdAt: new Date().toISOString() }],
  templates: [],
});

const load = (): PersistedTemplateState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as PersistedTemplateState;
    if (!parsed?.rootId || !Array.isArray(parsed.folders) || !Array.isArray(parsed.templates)) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
};

const persist = (state: PersistedTemplateState) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

interface TemplateStore extends PersistedTemplateState {
  expanded: Record<string, boolean>;
  addFolder: (name: string, parentId: string) => void;
  deleteFolder: (folderId: string) => void;
  toggleExpanded: (folderId: string) => void;
  saveTemplate: (input: { name: string; folderId: string; canvasWidth: number; canvasHeight: number; layers: Layer[] }) => string | null;
  updateTemplate: (templateId: string, input: { name: string; folderId: string; canvasWidth: number; canvasHeight: number; layers: Layer[] }) => void;
  deleteTemplate: (templateId: string) => void;
  getTemplatesInFolder: (folderId: string) => SavedTemplate[];
  getTemplateById: (templateId: string) => SavedTemplate | undefined;
  getFolderById: (folderId: string) => TemplateFolder | undefined;
  getRootFolder: () => TemplateFolder;
}

const initial = load();

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  ...initial,
  expanded: { [initial.rootId]: true },
  addFolder: (name, parentId) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const folders = structuredClone(get().folders);
    const parent = folders.find((f) => f.id === parentId);
    if (!parent) return;
    const id = `tpl-folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    parent.children.push(id);
    folders.push({ id, name: trimmed, parentId, children: [], createdAt: new Date().toISOString() });
    const next = { rootId: get().rootId, folders, templates: get().templates };
    persist(next);
    set({ folders });
  },
  deleteFolder: (folderId) => {
    if (folderId === get().rootId) return;
    const doomed = new Set<string>();
    const folders = structuredClone(get().folders);
    const templates = structuredClone(get().templates);
    const walk = (id: string) => {
      doomed.add(id);
      const folder = folders.find((f) => f.id === id);
      if (!folder) return;
      folder.children.forEach(walk);
    };
    walk(folderId);
    const nextFolders = folders.filter((f) => !doomed.has(f.id)).map((f) => ({ ...f, children: f.children.filter((c) => !doomed.has(c)) }));
    const nextTemplates = templates.filter((t) => !doomed.has(t.folderId));
    const next = { rootId: get().rootId, folders: nextFolders, templates: nextTemplates };
    persist(next);
    set({ folders: nextFolders, templates: nextTemplates });
  },
  toggleExpanded: (folderId) => set((s) => ({ expanded: { ...s.expanded, [folderId]: !s.expanded[folderId] } })),
  saveTemplate: ({ name, folderId, canvasWidth, canvasHeight, layers }) => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const id = `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const templates = [{
      id,
      name: trimmed,
      folderId,
      canvasWidth,
      canvasHeight,
      layers: structuredClone(layers),
      createdAt: new Date().toISOString(),
    }, ...get().templates];
    const next = { rootId: get().rootId, folders: get().folders, templates };
    persist(next);
    set({ templates });
    return id;
  },
  updateTemplate: (templateId, { name, folderId, canvasWidth, canvasHeight, layers }) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const templates = get().templates.map((template) => (
      template.id === templateId
        ? { ...template, name: trimmed, folderId, canvasWidth, canvasHeight, layers: structuredClone(layers), updatedAt: new Date().toISOString() }
        : template
    ));
    const next = { rootId: get().rootId, folders: get().folders, templates };
    persist(next);
    set({ templates });
  },
  deleteTemplate: (templateId) => {
    const templates = get().templates.filter((template) => template.id !== templateId);
    const next = { rootId: get().rootId, folders: get().folders, templates };
    persist(next);
    set({ templates });
  },
  getTemplatesInFolder: (folderId) => get().templates.filter((t) => t.folderId === folderId),
  getTemplateById: (templateId) => get().templates.find((t) => t.id === templateId),
  getFolderById: (folderId) => get().folders.find((f) => f.id === folderId),
  getRootFolder: () => get().folders.find((f) => f.id === get().rootId) || get().folders[0],
}));
