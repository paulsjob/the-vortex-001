import { create } from 'zustand';
import type { SavedTemplate } from './useTemplateStore';
import type { BindingSchema, VortexBindingState } from '../features/playout/vortexBindings';
import { createInitialBindingValues, validateBindingValues } from '../features/playout/vortexBindings';

export type FontOverride = {
  enabled: boolean;
  fallbackFamily: string;
  timestamp: string;
};

export type TransitionType = 'cut' | 'fade' | 'ftb' | 'luma';

export type PlayoutSnapshot = {
  snapshotId: string;
  template: SavedTemplate;
  sponsor: string | null;
  createdAt: string;
};

interface PlayoutStore {
  vortexBindings: Record<string, VortexBindingState | undefined>;
  previewTemplate: SavedTemplate | null;
  programTemplate: SavedTemplate | null;
  previewSnapshot: PlayoutSnapshot | null;
  programSnapshot: PlayoutSnapshot | null;
  outputSnapshotId: string | null;
  previewSponsor: string | null;
  programSponsor: string | null;
  transitionType: TransitionType;
  transitionDurationMs: number;
  lastTakeAt: string | null;
  fontOverrides: Record<string, FontOverride | undefined>;
  vortexBindingSchemas: Record<string, BindingSchema | undefined>;
  setPreviewTemplate: (template: SavedTemplate | null) => void;
  setPreviewSponsor: (sponsor: string | null) => void;
  setTransitionType: (type: TransitionType) => void;
  setTransitionDurationMs: (ms: number) => void;
  takeToProgram: () => void;
  clearProgram: () => void;
  activateProgramTemplate: (template: SavedTemplate | null) => void;
  resetPlayoutState: () => void;
  setOutputSnapshotId: (snapshotId: string | null) => void;
  setFontOverride: (templateId: string, override: FontOverride) => void;
  clearFontOverride: (templateId: string) => void;

  initializeBindings: (templateId: string, bindingsSchema: BindingSchema, options?: { force?: boolean }) => void;
  setBindingValue: (templateId: string, key: string, value: unknown) => void;
  setBindingValues: (templateId: string, values: Record<string, unknown>) => void;
  validateBindings: (templateId: string) => void;
  clearBindings: (templateId: string) => void;
  setBindingFontGateSatisfied: (templateId: string, satisfied: boolean) => void;
  getBindingState: (templateId: string) => VortexBindingState | undefined;
  getBindingSchema: (templateId: string) => BindingSchema | undefined;
}

const cloneTemplate = (template: SavedTemplate): SavedTemplate => structuredClone(template);
const createSnapshotId = () => `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const cloneSnapshotTemplate = (snapshot: PlayoutSnapshot): SavedTemplate => cloneTemplate(snapshot.template);

const templatesMatch = (left: SavedTemplate | null, right: SavedTemplate | null): boolean => {
  if (!left || !right) return left === right;
  return JSON.stringify(left) === JSON.stringify(right);
};

export const usePlayoutStore = create<PlayoutStore>((set, get) => ({
  previewSponsor: 'Renderless Sports',
  programSponsor: null,
  transitionType: 'cut',
  transitionDurationMs: 300,
  previewTemplate: null,
  previewSnapshot: null,
  vortexBindings: {},
  programTemplate: null,
  programSnapshot: null,
  outputSnapshotId: null,
  lastTakeAt: null,
  fontOverrides: {},
  vortexBindingSchemas: {},
  setPreviewTemplate: (template) => set((state) => {
    if (!template) {
      return { previewTemplate: null, previewSnapshot: null };
    }
    // Preview always works on an immutable snapshot cloned away from Design state.
    const snapshot: PlayoutSnapshot = {
      snapshotId: createSnapshotId(),
      template: cloneTemplate(template),
      sponsor: state.previewSponsor,
      createdAt: new Date().toISOString(),
    };
    return {
      previewTemplate: cloneSnapshotTemplate(snapshot),
      previewSnapshot: snapshot,
    };
  }),
  setPreviewSponsor: (sponsor) => set((state) => ({
    previewSponsor: sponsor,
    previewSnapshot: state.previewSnapshot
      ? {
        ...state.previewSnapshot,
        sponsor,
      }
      : null,
  })),
  setTransitionType: (type) => set({ transitionType: type }),
  setTransitionDurationMs: (ms) => set({ transitionDurationMs: ms }),
  takeToProgram: () => {
    const preview = get().previewTemplate;
    const program = get().programTemplate;
    const previewSnapshot = get().previewSnapshot;
    const previewSponsor = previewSnapshot?.sponsor ?? get().previewSponsor;
    if (!preview) return;
    if (templatesMatch(program, preview) && get().programSponsor === previewSponsor) return;
    const programSnapshot: PlayoutSnapshot = {
      snapshotId: createSnapshotId(),
      template: cloneTemplate(preview),
      sponsor: previewSponsor,
      createdAt: new Date().toISOString(),
    };
    set({
      // TAKE creates a new Program snapshot to prevent shared mutable references.
      programTemplate: cloneSnapshotTemplate(programSnapshot),
      programSnapshot,
      programSponsor: previewSponsor,
      lastTakeAt: new Date().toISOString(),
    });
  },
  clearProgram: () => set({ programTemplate: null, programSnapshot: null, outputSnapshotId: null, programSponsor: null }),
  activateProgramTemplate: (template) => set((state) => {
    if (!template) return state;
    const nextProgramSnapshot: PlayoutSnapshot = {
      snapshotId: createSnapshotId(),
      template: cloneTemplate(template),
      sponsor: state.programSponsor,
      createdAt: new Date().toISOString(),
    };
    const nextProgram = cloneSnapshotTemplate(nextProgramSnapshot);
    if (templatesMatch(state.programTemplate, nextProgram)) return state;
    return {
      programTemplate: nextProgram,
      programSnapshot: nextProgramSnapshot,
      lastTakeAt: new Date().toISOString(),
    };
  }),
  resetPlayoutState: () => set({
    previewTemplate: null,
    previewSnapshot: null,
    programTemplate: null,
    programSnapshot: null,
    outputSnapshotId: null,
    previewSponsor: 'Renderless Sports',
    programSponsor: null,
    transitionType: 'cut',
    transitionDurationMs: 300,
    lastTakeAt: null,
    vortexBindings: {},
    vortexBindingSchemas: {},
    fontOverrides: {},
  }),
  setOutputSnapshotId: (snapshotId) => set({ outputSnapshotId: snapshotId }),
  setFontOverride: (templateId, override) => set((state) => ({
    fontOverrides: { ...state.fontOverrides, [templateId]: override },
  })),
  clearFontOverride: (templateId) => set((state) => {
    const { [templateId]: _removed, ...rest } = state.fontOverrides;
    return { fontOverrides: rest };
  }),
  initializeBindings: (templateId, bindingsSchema, options) => {
    const existingBindingState = get().vortexBindings[templateId];
    const existingSchema = get().vortexBindingSchemas[templateId];
    if (existingBindingState && existingSchema && !options?.force) return;

    const values = createInitialBindingValues(bindingsSchema);
    const baseState: VortexBindingState = {
      templateId,
      values,
      validation: {
        isValid: true,
        missingRequired: [],
        errors: [],
      },
      readyToAir: false,
      fontGateSatisfied: false,
    };
    const validated = validateBindingValues(bindingsSchema, values, baseState.fontGateSatisfied);
    set((state) => ({
      vortexBindings: {
        ...state.vortexBindings,
        [templateId]: {
          ...baseState,
          ...validated,
        },
      },
      vortexBindingSchemas: {
        ...state.vortexBindingSchemas,
        [templateId]: bindingsSchema,
      },
    }));
  },
  setBindingValue: (templateId, key, value) => {
    const schema = get().vortexBindingSchemas[templateId];
    const bindingState = get().vortexBindings[templateId];
    if (!schema || !bindingState) return;
    const values = { ...bindingState.values, [key]: value };
    const validated = validateBindingValues(schema, values, bindingState.fontGateSatisfied);
    set((state) => ({
      vortexBindings: {
        ...state.vortexBindings,
        [templateId]: {
          ...bindingState,
          values,
          ...validated,
        },
      },
    }));
  },
  setBindingValues: (templateId, nextValues) => {
    const schema = get().vortexBindingSchemas[templateId];
    const bindingState = get().vortexBindings[templateId];
    if (!schema || !bindingState) return;
    const values = { ...bindingState.values, ...nextValues };
    const validated = validateBindingValues(schema, values, bindingState.fontGateSatisfied);
    set((state) => ({
      vortexBindings: {
        ...state.vortexBindings,
        [templateId]: {
          ...bindingState,
          values,
          ...validated,
        },
      },
    }));
  },
  validateBindings: (templateId) => {
    const schema = get().vortexBindingSchemas[templateId];
    const bindingState = get().vortexBindings[templateId];
    if (!schema || !bindingState) return;
    const validated = validateBindingValues(schema, bindingState.values, bindingState.fontGateSatisfied);
    set((state) => ({
      vortexBindings: {
        ...state.vortexBindings,
        [templateId]: {
          ...bindingState,
          ...validated,
        },
      },
    }));
  },
  clearBindings: (templateId) => set((state) => {
    const { [templateId]: _removedBinding, ...vortexBindings } = state.vortexBindings;
    const { [templateId]: _removedSchema, ...vortexBindingSchemas } = state.vortexBindingSchemas;
    return { vortexBindings, vortexBindingSchemas };
  }),
  setBindingFontGateSatisfied: (templateId, satisfied) => {
    const schema = get().vortexBindingSchemas[templateId];
    const bindingState = get().vortexBindings[templateId];
    if (!schema || !bindingState) return;
    const validated = validateBindingValues(schema, bindingState.values, satisfied);
    set((state) => ({
      vortexBindings: {
        ...state.vortexBindings,
        [templateId]: {
          ...bindingState,
          fontGateSatisfied: satisfied,
          ...validated,
        },
      },
    }));
  },
  getBindingState: (templateId) => get().vortexBindings[templateId],
  getBindingSchema: (templateId) => get().vortexBindingSchemas[templateId],
}));
