import { create } from 'zustand';
import type { Layer } from '../types/domain';
import { getManifestFormat, type VortexPackage } from '../features/packages/loadVortexPackage';
import { revokeVortexAssetUrls } from '../features/packages/vortexAssetResolver';
import { clearVortexFontCache } from '../features/packages/vortexFontGate';
import { useAssetStore } from './useAssetStore';
import { usePlayoutStore } from './usePlayoutStore';

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

export type TemplateListItem = {
  id: string;
  name: string;
  source: 'native' | 'vortex';
  formatId?: string;
  width?: number;
  height?: number;
  variantGroupId?: string;
  updatedAt?: string;
  previewUrl?: string;
};

type SelectedTemplate = {
  source: 'native' | 'vortex';
  id: string;
};

export type SelectedTemplateRef = SelectedTemplate;

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
  vortexPackages: Record<string, VortexPackage>;
  vortexPreviewUrls: Record<string, string | undefined>;
  selectedTemplate: SelectedTemplate | null;
  addFolder: (name: string, parentId: string) => void;
  deleteFolder: (folderId: string) => void;
  renameFolder: (folderId: string, name: string) => void;
  toggleExpanded: (folderId: string) => void;
  saveTemplate: (input: { name: string; folderId: string; canvasWidth: number; canvasHeight: number; layers: Layer[] }) => string | null;
  updateTemplate: (templateId: string, input: { name: string; folderId: string; canvasWidth: number; canvasHeight: number; layers: Layer[] }) => void;
  deleteTemplate: (templateId: string) => void;
  getTemplatesInFolder: (folderId: string) => SavedTemplate[];
  getTemplateById: (templateId: string) => SavedTemplate | undefined;
  getFolderById: (folderId: string) => TemplateFolder | undefined;
  getRootFolder: () => TemplateFolder;
  registerVortexPackage: (pkg: VortexPackage) => void;
  removeVortexPackage: (templateId: string) => void;
  getVortexPackage: (templateId: string) => VortexPackage | undefined;
  listAllTemplates: () => TemplateListItem[];
  selectTemplate: (selection: SelectedTemplate) => void;
}

const initial = load();

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  ...initial,
  expanded: { [initial.rootId]: true },
  vortexPackages: {},
  vortexPreviewUrls: {},
  selectedTemplate: null,
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
  renameFolder: (folderId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const folders = structuredClone(get().folders);
    const folder = folders.find((f) => f.id === folderId);
    if (!folder) return;
    folder.name = trimmed;
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
    const template: SavedTemplate = {
      id,
      name: trimmed,
      folderId,
      canvasWidth,
      canvasHeight,
      layers: structuredClone(layers),
      createdAt: new Date().toISOString(),
    };
    const templates = [template, ...get().templates];
    const next = { rootId: get().rootId, folders: get().folders, templates };
    persist(next);
    set({ templates });
    useAssetStore.getState().upsertTemplateAsset(template);
    return id;
  },
  updateTemplate: (templateId, { name, folderId, canvasWidth, canvasHeight, layers }) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let updatedTemplate: SavedTemplate | null = null;
    const templates = get().templates.map((template) => (
      template.id === templateId
        ? (() => {
          updatedTemplate = { ...template, name: trimmed, folderId, canvasWidth, canvasHeight, layers: structuredClone(layers), updatedAt: new Date().toISOString() };
          return updatedTemplate;
        })()
        : template
    ));
    const next = { rootId: get().rootId, folders: get().folders, templates };
    persist(next);
    set({ templates });
    if (updatedTemplate) useAssetStore.getState().upsertTemplateAsset(updatedTemplate);
  },
  deleteTemplate: (templateId) => {
    const templates = get().templates.filter((template) => template.id !== templateId);
    const next = { rootId: get().rootId, folders: get().folders, templates };
    persist(next);
    set({ templates });
    useAssetStore.getState().removeTemplateAsset(templateId);
  },
  getTemplatesInFolder: (folderId) => get().templates.filter((t) => t.folderId === folderId),
  getTemplateById: (templateId) => get().templates.find((t) => t.id === templateId),
  getFolderById: (folderId) => get().folders.find((f) => f.id === folderId),
  getRootFolder: () => get().folders.find((f) => f.id === get().rootId) || get().folders[0],
  registerVortexPackage: (pkg) => {
    const templateId = pkg.manifest.templateId;
    revokeVortexAssetUrls(templateId);
    clearVortexFontCache(templateId);
    const previewBlob = pkg.files.previews['previews/poster.png'];
    const previewUrl = previewBlob ? URL.createObjectURL(previewBlob) : undefined;
    const previousPreview = get().vortexPreviewUrls[templateId];
    if (previousPreview) {
      URL.revokeObjectURL(previousPreview);
    }
    set((state) => ({
      vortexPackages: { ...state.vortexPackages, [templateId]: pkg },
      vortexPreviewUrls: { ...state.vortexPreviewUrls, [templateId]: previewUrl },
    }));
  },
  removeVortexPackage: (templateId) => {
    const state = get();
    revokeVortexAssetUrls(templateId);
    clearVortexFontCache(templateId);
    const previewUrl = state.vortexPreviewUrls[templateId];
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    const { [templateId]: _removedPackage, ...vortexPackages } = state.vortexPackages;
    const { [templateId]: _removedPreview, ...vortexPreviewUrls } = state.vortexPreviewUrls;
    usePlayoutStore.getState().clearBindings(templateId);
    set({
      vortexPackages,
      vortexPreviewUrls,
      selectedTemplate: state.selectedTemplate?.id === templateId && state.selectedTemplate.source === 'vortex'
        ? null
        : state.selectedTemplate,
    });
  },
  getVortexPackage: (templateId) => get().vortexPackages[templateId],
  listAllTemplates: () => {
    const state = get();
    const nativeTemplates: TemplateListItem[] = state.templates.map((template) => ({
      id: template.id,
      name: template.name,
      source: 'native',
      width: template.canvasWidth,
      height: template.canvasHeight,
      updatedAt: template.updatedAt ?? template.createdAt,
    }));
    const vortexTemplates: TemplateListItem[] = Object.values(state.vortexPackages).map((pkg) => ({
      ...(() => {
        const format = getManifestFormat(pkg.manifest);
        return {
          formatId: format.formatId,
          width: format.width,
          height: format.height,
        };
      })(),
      id: pkg.manifest.templateId,
      name: pkg.manifest.templateName,
      source: 'vortex',
      variantGroupId: typeof pkg.manifest.variantGroupId === 'string' ? pkg.manifest.variantGroupId : undefined,
      updatedAt: typeof pkg.manifest.updatedAt === 'string' ? pkg.manifest.updatedAt : undefined,
      previewUrl: state.vortexPreviewUrls[pkg.manifest.templateId],
    }));
    return [...nativeTemplates, ...vortexTemplates];
  },
  selectTemplate: (selection) => set({ selectedTemplate: selection }),
}));
