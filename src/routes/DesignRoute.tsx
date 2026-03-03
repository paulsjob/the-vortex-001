import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { useAssetStore } from '../store/useAssetStore';
import { useDataEngineStore } from '../store/useDataEngineStore';
import { useLayerStore } from '../store/useLayerStore';
import { useTemplateStore } from '../store/useTemplateStore';
import type { ExplorerNode, Layer } from '../types/domain';
import { buildTemplateFeedUrl } from '../features/playout/publicUrl';
import { buildNormalizedPayload, buildTeamMetrics } from '../features/simulation/derived';
import { StageViewportFrame } from '../components/stage/StageViewportFrame';
import { DataInspectorPanel } from '../components/design/DataInspectorPanel';
import { TemplateSceneSvg } from '../features/playout/TemplateSceneSvg';
import {
  formatPreviewValue,
  getFieldCatalog,
  getMetricOptions,
  getPlayersForSide,
  groupMetricOptions,
  parseBindingPathToSelection,
  resolvePathValue,
  resolveTextLayerBindingValue,
  type BindingContext,
  type BindingFilterContext,
  type FieldLevel,
  type FieldSide,
} from '../components/design/dataBindingPaths';

const TEMPLATE_FORMATS = [
  { id: '16:9', value: '1920x1080', label: '16:9 (1920x1080)', width: 1920, height: 1080 },
  { id: '1:1', value: '1080x1080', label: '1:1 (1080x1080)', width: 1080, height: 1080 },
  { id: '4:5', value: '1080x1350', label: '4:5 (1080x1350)', width: 1080, height: 1350 },
  { id: '9:16', value: '1080x1920', label: '9:16 (1080x1920)', width: 1080, height: 1920 },
] as const;

type TemplateFormatId = typeof TEMPLATE_FORMATS[number]['id'];
type FormatLayoutVariant = { canvasWidth: number; canvasHeight: number; layers: Layer[] };

const FONT_OPTIONS = ['Inter', 'Arial', 'Helvetica', 'Roboto', 'Montserrat', 'Oswald', 'Georgia', 'Times New Roman'];
const transformDefaults = { anchorX: 0, anchorY: 0, scaleX: 100, scaleY: 100, rotation: 0 };
const RULER_SIZE = 24;
const RULER_TARGET_MAJOR_SPACING = 90;
const GUIDE_SESSION_KEY = 'design-route-guides-v2';
type AssetBin = 'graphics' | 'videos' | 'templates';

type Guide = {
  id: string;
  axis: 'x' | 'y';
  position: number;
};

const pickRulerMajorStep = (scale: number) => {
  const targetUnits = RULER_TARGET_MAJOR_SPACING / Math.max(scale, 0.001);
  const exponent = Math.floor(Math.log10(targetUnits));
  const magnitude = 10 ** exponent;
  const candidates = [1, 2, 5, 10].map((factor) => factor * magnitude);
  return candidates.reduce((closest, candidate) => (
    Math.abs(candidate - targetUnits) < Math.abs(closest - targetUnits) ? candidate : closest
  ), candidates[0]);
};

const pickRulerMinorStep = (majorStep: number, scale: number) => {
  const divisors = [10, 5, 2];
  for (const divisor of divisors) {
    const step = majorStep / divisor;
    if (step * scale >= 8) return step;
  }
  return majorStep;
};

const buildRulerTicks = (canvasSpan: number, scale: number) => {
  const majorStep = pickRulerMajorStep(scale);
  const minorStep = pickRulerMinorStep(majorStep, scale);
  const tickCount = Math.ceil(canvasSpan / minorStep);
  return Array.from({ length: tickCount + 1 }, (_, index) => {
    const value = Math.min(canvasSpan, Math.round(index * minorStep * 1000) / 1000);
    const major = Math.abs((value / majorStep) - Math.round(value / majorStep)) < 0.0005 || value === canvasSpan;
    return { value, position: value * scale, major };
  });
};

const getFormatBySize = (width: number, height: number) => (
  TEMPLATE_FORMATS.find((format) => format.width === width && format.height === height)
);

const scaleLayerForCanvas = (layer: Layer, scaleX: number, scaleY: number): Layer => {
  const scaled = {
    ...structuredClone(layer),
    x: Math.round(layer.x * scaleX),
    y: Math.round(layer.y * scaleY),
    anchorX: Math.round((layer.anchorX ?? 0) * scaleX),
    anchorY: Math.round((layer.anchorY ?? 0) * scaleY),
  } as Layer;

  if (scaled.kind === 'shape' || scaled.kind === 'asset') {
    scaled.width = Math.max(1, Math.round(scaled.width * scaleX));
    scaled.height = Math.max(1, Math.round(scaled.height * scaleY));
  }

  if (scaled.kind === 'text' && scaled.textMode === 'area') {
    scaled.width = Math.max(8, Math.round((scaled.width ?? 420) * scaleX));
    scaled.height = Math.max(8, Math.round((scaled.height ?? (scaled.size * 1.2)) * scaleY));
  }

  return scaled;
};

export function DesignRoute() {
  const assetStore = useAssetStore();
  const templateStore = useTemplateStore();
  const engineGame = useDataEngineStore((s) => s.game);
  const activeSport = useDataEngineStore((s) => s.activeSport);
  const engineHistoryLength = useDataEngineStore((s) => s.history.length);
  const {
    layers,
    canvasWidth,
    canvasHeight,
    addText,
    addShape,
    addAssetLayer,
    duplicateLayer,
    setCanvasSize,
    setZOrder,
    deleteLayer,
    renameLayer,
    updateLayer,
    loadedTemplateId,
    setLoadedTemplateId,
    moveLayer,
    loadTemplate,
  } = useLayerStore();

  const [folderId, setFolderId] = useState(assetStore.brandedExplorer.rootId);
  const [search, setSearch] = useState('');
  const [assetBin, setAssetBin] = useState<AssetBin>('graphics');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerValue, setEditingLayerValue] = useState('');
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [lastClickedLayerId, setLastClickedLayerId] = useState<string | null>(null);
  const [lockScale, setLockScale] = useState(true);
  const [leftPanelTab, setLeftPanelTab] = useState<'layers' | 'assets'>('layers');
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>('select');
  const [stageViewport, setStageViewport] = useState({ width: 0, height: 0 });
  const [stageTextEditId, setStageTextEditId] = useState<string | null>(null);
  const [stageTextEditValue, setStageTextEditValue] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [alignScope, setAlignScope] = useState<'selection' | 'canvas' | 'key'>('selection');
  const [keyObjectId, setKeyObjectId] = useState<string | null>(null);
  const [distributeSpacingValue, setDistributeSpacingValue] = useState('20');
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [stageZoom, setStageZoom] = useState(1);
  const [showRulers, setShowRulers] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showSafeZones, setShowSafeZones] = useState(false);
  const [dataBindingBetaEnabled, setDataBindingBetaEnabled] = useState(false);
  const [bindingContext, setBindingContext] = useState<BindingContext>('live');
  const [bindingLevel, setBindingLevel] = useState<FieldLevel>('game');
  const [bindingSide, setBindingSide] = useState<FieldSide>('home');
  const [bindingPlayerId, setBindingPlayerId] = useState('');
  const [bindingMetricQuery, setBindingMetricQuery] = useState('');
  const [bindingPlayerQuery, setBindingPlayerQuery] = useState('');
  const [bindingAdvancedOpen, setBindingAdvancedOpen] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null);
  const [guideReadout, setGuideReadout] = useState<{ x: number; y: number; value: number } | null>(null);
  const [fontStatusByFamily, setFontStatusByFamily] = useState<Record<string, 'loading' | 'ready' | 'error'>>({});
  const [currentFormatId, setCurrentFormatId] = useState<TemplateFormatId>(() => getFormatBySize(1920, 1080)?.id ?? '16:9');
  const [layoutVariants, setLayoutVariants] = useState<Partial<Record<TemplateFormatId, FormatLayoutVariant>>>({});

  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; base: Map<string, { x: number; y: number }> } | null>(null);
  const resizeRef = useRef<{
    layerId: string;
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
  } | null>(null);
  const guideDragRef = useRef<{ id: string; axis: 'x' | 'y' } | null>(null);
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const assetById = useMemo(() => new Map(assetStore.assets.map((a) => [a.id, a])), [assetStore.assets]);
  const layerById = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const stackLayers = useMemo(() => [...layers].sort((a, b) => b.zIndex - a.zIndex), [layers]);
  const canvasLayers = useMemo(() => [...layers].filter((layer) => layer.visible !== false).sort((a, b) => a.zIndex - b.zIndex), [layers]);
  const selectedLayers = useMemo(() => selectedLayerIds.map((id) => layerById.get(id)).filter(Boolean) as Layer[], [selectedLayerIds, layerById]);
  const selectedPrimary = selectedLayers[0] || null;
  const loadedTemplate = useMemo(() => (loadedTemplateId ? templateStore.getTemplateById(loadedTemplateId) : undefined), [loadedTemplateId, templateStore.templates]);
  const activeFormatId = useMemo<TemplateFormatId>(() => (
    getFormatBySize(canvasWidth, canvasHeight)?.id ?? currentFormatId
  ), [canvasWidth, canvasHeight, currentFormatId]);
  const textFontFamilies = useMemo(() => {
    const families = new Set<string>();
    layers.forEach((layer) => {
      if (layer.kind === 'text' && layer.fontFamily) families.add(layer.fontFamily);
    });
    return [...families];
  }, [layers]);
  const hasSimulationData = engineHistoryLength > 0;
  const livePayload = hasSimulationData ? engineGame : null;
  const derivedPayload = useMemo(() => {
    if (!hasSimulationData) return null;
    return {
      teamMetrics: buildTeamMetrics(engineGame),
      advancedMetrics: engineGame.advancedMetrics,
      consistencyIssues: engineGame.consistencyIssues ?? [],
      sport: engineGame.sport,
    };
  }, [engineGame, hasSimulationData]);
  const scorebugPayload = useMemo(() => (
    hasSimulationData ? buildNormalizedPayload(engineGame, 'live-scorebug') : null
  ), [engineGame, hasSimulationData]);

  const bindingCatalog = useMemo(() => (
    getFieldCatalog({ sport: activeSport, context: bindingContext })
  ), [activeSport, bindingContext]);
  const hasSimulationPayload = hasSimulationData ? (bindingContext === 'live' ? livePayload : bindingContext === 'derived' ? derivedPayload : scorebugPayload) : null;
  const playerOptions = useMemo(() => (
    getPlayersForSide(hasSimulationPayload, bindingSide)
      .filter((player) => !bindingPlayerQuery.trim() || player.label.toLowerCase().includes(bindingPlayerQuery.trim().toLowerCase()))
  ), [hasSimulationPayload, bindingSide, bindingPlayerQuery]);
  const bindingFilterContext = useMemo<BindingFilterContext>(() => ({
    source: bindingContext,
    sport: activeSport,
    level: bindingLevel,
    side: bindingLevel !== 'game' ? bindingSide : undefined,
    playerId: bindingLevel === 'player' ? bindingPlayerId : undefined,
  }), [bindingContext, activeSport, bindingLevel, bindingSide, bindingPlayerId]);
  const metricOptions = useMemo(() => (
    getMetricOptions(bindingCatalog, bindingLevel, bindingMetricQuery, {
      side: bindingLevel !== 'game' ? bindingSide : undefined,
      playerId: bindingLevel === 'player' ? bindingPlayerId : undefined,
    }, bindingFilterContext)
  ), [bindingCatalog, bindingLevel, bindingMetricQuery, bindingSide, bindingPlayerId, bindingFilterContext]);
  const groupedMetricOptions = useMemo(() => groupMetricOptions(metricOptions), [metricOptions]);
  const currentBindingPayload = bindingContext === 'live' ? livePayload : bindingContext === 'derived' ? derivedPayload : scorebugPayload;
  const selectedTextBindingField = selectedPrimary?.kind === 'text' ? selectedPrimary.dataBindingField : '';
  const previewValue = selectedPrimary?.kind === 'text'
    ? resolvePathValue(currentBindingPayload, selectedPrimary.dataBindingField)
    : undefined;
  const previewText = formatPreviewValue(previewValue);

  const ensureFontLoaded = useCallback((fontFamily: string, size = 56) => {
    if (typeof document === 'undefined' || !('fonts' in document) || !fontFamily) return;
    const descriptor = `700 ${size}px "${fontFamily}"`;
    if (document.fonts.check(descriptor)) {
      setFontStatusByFamily((prev) => (prev[fontFamily] === 'ready' ? prev : { ...prev, [fontFamily]: 'ready' }));
      return;
    }
    setFontStatusByFamily((prev) => ({ ...prev, [fontFamily]: 'loading' }));
    document.fonts.load(descriptor)
      .then(() => {
        setFontStatusByFamily((prev) => ({ ...prev, [fontFamily]: 'ready' }));
      })
      .catch(() => {
        setFontStatusByFamily((prev) => ({ ...prev, [fontFamily]: 'error' }));
      });
  }, []);


  useEffect(() => {
    if (!measureCtxRef.current) {
      const canvas = document.createElement('canvas');
      measureCtxRef.current = canvas.getContext('2d');
    }
  }, []);

  useEffect(() => {
    textFontFamilies.forEach((fontFamily) => ensureFontLoaded(fontFamily));
  }, [textFontFamilies, ensureFontLoaded]);

  useEffect(() => {
    if (!selectedPrimary || selectedPrimary.kind !== 'text') return;
    const matched = parseBindingPathToSelection(bindingCatalog, selectedPrimary.dataBindingField);
    if (!matched) return;
    setBindingLevel(matched.descriptor.level);
    if (matched.selections.side) setBindingSide(matched.selections.side);
    if (matched.selections.playerId) setBindingPlayerId(matched.selections.playerId);
  }, [selectedPrimary?.id, selectedPrimary?.kind, selectedTextBindingField, bindingCatalog]);

  useEffect(() => {
    if (bindingLevel !== 'player') setBindingPlayerId('');
  }, [bindingLevel]);

  useEffect(() => {
    setCurrentFormatId(activeFormatId);
  }, [activeFormatId]);

  useEffect(() => {
    setLayoutVariants({
      [activeFormatId]: {
        canvasWidth,
        canvasHeight,
        layers: structuredClone(layers),
      },
    });
  }, [loadedTemplateId]);

  useEffect(() => {
    const guideStateKey = loadedTemplateId ?? '__untitled__';
    try {
      const raw = window.sessionStorage.getItem(GUIDE_SESSION_KEY);
      if (!raw) {
        setGuides([]);
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, Guide[]>;
      const list = Array.isArray(parsed) ? parsed : parsed?.[guideStateKey];
      if (!Array.isArray(list)) {
        setGuides([]);
        return;
      }
      setGuides(list
        .filter((guide) => guide && (guide.axis === 'x' || guide.axis === 'y') && Number.isFinite(guide.position))
        .map((guide) => ({
          id: guide.id || `guide-${Date.now()}-${Math.random()}`,
          axis: guide.axis,
          position: clampGuidePosition(guide.axis, guide.position),
        })));
    } catch {
      setGuides([]);
    }
  }, [loadedTemplateId]);

  useEffect(() => {
    setGuides((prev) => prev.map((guide) => ({ ...guide, position: clampGuidePosition(guide.axis, guide.position) })));
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const guideStateKey = loadedTemplateId ?? '__untitled__';
    let payload: Record<string, Guide[]> = {};
    try {
      const raw = window.sessionStorage.getItem(GUIDE_SESSION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, Guide[]>;
        if (parsed && !Array.isArray(parsed)) payload = parsed;
      }
    } catch {
      payload = {};
    }
    payload[guideStateKey] = guides;
    window.sessionStorage.setItem(GUIDE_SESSION_KEY, JSON.stringify(payload));
  }, [guides, loadedTemplateId]);


  useEffect(() => {
    const node = stageViewportRef.current;
    if (!node) return;

    const update = () => {
      const rect = node.getBoundingClientRect();
      const style = window.getComputedStyle(node);
      const paddingX = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const paddingY = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
      setStageViewport({
        width: Math.max(0, rect.width - paddingX),
        height: Math.max(0, rect.height - paddingY),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener('resize', update);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    setSelectedLayerIds((ids) => ids.filter((id) => layerById.has(id)));
  }, [stackLayers, layerById]);


  useEffect(() => {
    if (!keyObjectId || !selectedLayerIds.includes(keyObjectId)) {
      setKeyObjectId(selectedLayerIds[0] ?? null);
    }
  }, [selectedLayerIds, keyObjectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'Escape') {
        setSelectedLayerIds([]);
        setSelectedGuideId(null);
        return;
      }
      if ((event.key === 'Backspace' || event.key === 'Delete') && selectedGuideId) {
        event.preventDefault();
        setGuides((prev) => prev.filter((guide) => guide.id !== selectedGuideId));
        setSelectedGuideId(null);
        return;
      }
      if (!selectedLayerIds.length) return;
      const step = event.shiftKey ? 10 : 1;
      const patches: Record<string, Partial<Layer>> = {};
      if (event.key === 'ArrowLeft') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l && !l.locked) patches[id] = { x: l.x - step }; });
      if (event.key === 'ArrowRight') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l && !l.locked) patches[id] = { x: l.x + step }; });
      if (event.key === 'ArrowUp') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l && !l.locked) patches[id] = { y: l.y - step }; });
      if (event.key === 'ArrowDown') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l && !l.locked) patches[id] = { y: l.y + step }; });
      const ids = Object.keys(patches);
      if (!ids.length) return;
      event.preventDefault();
      ids.forEach((id) => updateLayer(id, patches[id]));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedLayerIds, layerById, updateLayer, selectedGuideId]);

  const getNode = (id: string) => assetStore.brandedExplorer.nodes.find((n) => n.id === id);
  const folderChildren = useMemo(() => {
    const folder = getNode(folderId);
    if (!folder || folder.type !== 'folder') return [];
    return folder.children.map(getNode).filter(Boolean) as ExplorerNode[];
  }, [folderId, assetStore.brandedExplorer]);

  const fileMatchesBin = (node: ExplorerNode, bin: Exclude<AssetBin, 'templates'>) => {
    if (node.type !== 'file') return false;
    const normalized = `${node.name} ${node.src}`.toLowerCase();
    const videoHints = ['.mp4', '.mov', '.webm', '.m4v', '.avi', 'video/'];
    const isVideo = videoHints.some((hint) => normalized.includes(hint));
    return bin === 'videos' ? isVideo : !isVideo;
  };

  const filtered = useMemo(() => (
    folderChildren.filter((node) => {
      const matchesSearch = node.name.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;
      if (assetBin === 'templates') return false;
      if (node.type === 'folder') return true;
      return fileMatchesBin(node, assetBin);
    })
  ), [folderChildren, search, assetBin]);

  const filteredTemplates = useMemo(() => (
    templateStore.templates.filter((template) => template.name.toLowerCase().includes(search.toLowerCase()))
  ), [templateStore.templates, search]);

  const getTextContent = (layer: Extract<Layer, { kind: 'text' }>) => resolveTextLayerBindingValue(layer, {
    liveFeedPayload: livePayload,
    derivedPayload,
    scorebugPayload,
  });

  const clampGuidePosition = (axis: 'x' | 'y', value: number) => {
    const max = axis === 'x' ? canvasWidth : canvasHeight;
    return Math.max(0, Math.min(max, Math.round(value)));
  };

  const getGuidePositionFromPointer = (axis: 'x' | 'y', clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const raw = axis === 'x'
      ? (clientX - rect.left) / stageScale
      : (clientY - rect.top) / stageScale;
    return clampGuidePosition(axis, raw);
  };

  const updateGuidePosition = (id: string, position: number) => {
    setGuides((prev) => prev.map((guide) => (guide.id === id ? { ...guide, position } : guide)));
  };

  const beginGuidePointerMove = (guideId: string, axis: 'x' | 'y') => {
    guideDragRef.current = { id: guideId, axis };
    const onMove = (move: globalThis.MouseEvent) => {
      if (!guideDragRef.current) return;
      const nextPosition = getGuidePositionFromPointer(axis, move.clientX, move.clientY);
      if (nextPosition === null) return;
      updateGuidePosition(guideId, nextPosition);
      setGuideReadout({ x: move.clientX + 10, y: move.clientY + 10, value: nextPosition });
    };
    const onUp = (upEvent: globalThis.MouseEvent) => {
      const stage = stageRef.current;
      if (stage) {
        const rect = stage.getBoundingClientRect();
        const shouldDelete = axis === 'x'
          ? upEvent.clientX <= rect.left
          : upEvent.clientY <= rect.top;
        if (shouldDelete) {
          setGuides((prev) => prev.filter((guide) => guide.id !== guideId));
          if (selectedGuideId === guideId) setSelectedGuideId(null);
        }
      }
      guideDragRef.current = null;
      setGuideReadout(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const startGuideFromRuler = (axis: 'x' | 'y', event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startPosition = getGuidePositionFromPointer(axis, event.clientX, event.clientY);
    if (startPosition === null) return;
    const guideId = `guide-${Date.now()}`;
    setGuides((prev) => [...prev, { id: guideId, axis, position: startPosition }]);
    beginGuidePointerMove(guideId, axis);
  };

  const onGuideMouseDown = (guide: Guide, event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedGuideId(guide.id);
    beginGuidePointerMove(guide.id, guide.axis);
  };

  const onGuideDoubleClick = (guide: Guide, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const next = window.prompt(`Set ${guide.axis === 'x' ? 'vertical' : 'horizontal'} guide position in pixels`, String(guide.position));
    if (next === null) return;
    const parsed = Number(next);
    if (!Number.isFinite(parsed)) return;
    updateGuidePosition(guide.id, clampGuidePosition(guide.axis, parsed));
  };

  const onGuideContextMenu = (guide: Guide, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedGuideId(guide.id);
    const shouldDelete = window.confirm('Delete this guide?');
    if (!shouldDelete) return;
    setGuides((prev) => prev.filter((item) => item.id !== guide.id));
    setSelectedGuideId((prev) => (prev === guide.id ? null : prev));
  };

  const isAreaTextLayer = (layer: Layer): layer is Extract<Layer, { kind: 'text' }> => (
    layer.kind === 'text' && layer.textMode === 'area'
  );

  const measureTextBounds = (layer: Extract<Layer, { kind: 'text' }>) => {
    if (layer.textMode === 'area') {
      return { width: Math.max(8, (layer as unknown as { width?: number }).width ?? 420), height: Math.max(8, (layer as unknown as { height?: number }).height ?? layer.size * 1.2) };
    }
    const ctx = measureCtxRef.current;
    const displayText = getTextContent(layer) || ' ';
    if (!ctx) return { width: Math.max(16, displayText.length * layer.size * 0.55), height: Math.max(8, layer.size) };
    ctx.font = `700 ${layer.size}px ${layer.fontFamily}`;
    const metrics = ctx.measureText(displayText);
    const width = Math.max(16, metrics.width);
    const height = Math.max(8, ((metrics.actualBoundingBoxAscent || layer.size * 0.8) + (metrics.actualBoundingBoxDescent || layer.size * 0.25)) * 1.15);
    return { width, height };
  };

  const getLayerBounds = (layer: Layer) => {
    if (layer.kind === 'asset' || layer.kind === 'shape') return { width: layer.width, height: layer.height };
    return measureTextBounds(layer);
  };

  const getTransform = (layer: Layer) => ({
    anchorX: layer.anchorX ?? 0,
    anchorY: layer.anchorY ?? 0,
    scaleX: layer.scaleX ?? 100,
    scaleY: layer.scaleY ?? 100,
    rotation: layer.rotation ?? 0,
  });

  const getLayerRect = (layer: Layer) => {
    const { width, height } = getLayerBounds(layer);
    const left = layer.kind === 'shape' ? layer.x : (layer.x - (layer.anchorX ?? 0));
    const top = layer.kind === 'shape' ? layer.y : (layer.y - (layer.anchorY ?? 0));
    return { layer, width, height, left, top, right: left + width, bottom: top + height, centerX: left + width / 2, centerY: top + height / 2 };
  };

  const getSelectionRect = () => {
    if (!selectedLayers.length) return null;
    const rects = selectedLayers.map(getLayerRect);
    return {
      left: Math.min(...rects.map((r) => r.left)),
      top: Math.min(...rects.map((r) => r.top)),
      right: Math.max(...rects.map((r) => r.right)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    };
  };

  const applyToSelected = (patchFactory: (layer: Layer) => Partial<Layer>) => {
    selectedLayerIds.forEach((id) => {
      const layer = layerById.get(id);
      if (!layer || layer.locked) return;
      updateLayer(id, patchFactory(layer));
    });
  };

  const setNumeric = (key: string, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    if ((key === 'x' || key === 'y') && selectedLayerIds.length > 1) {
      const selectionRect = getSelectionRect();
      if (!selectionRect) return;
      const delta = parsed - (key === 'x' ? selectionRect.left : selectionRect.top);
      applyToSelected((layer) => ({ [key]: layer[key] + delta } as Partial<Layer>));
      return;
    }
    applyToSelected(() => ({ [key]: parsed } as Partial<Layer>));
  };

  const updateScale = (axis: 'x' | 'y', value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    applyToSelected(() => axis === 'x'
      ? ({ scaleX: parsed, ...(lockScale ? { scaleY: parsed } : {}) } as Partial<Layer>)
      : ({ scaleY: parsed, ...(lockScale ? { scaleX: parsed } : {}) } as Partial<Layer>));
  };

  const setAnchorPreset = (xFactor: number, yFactor: number) => {
    if (!selectedPrimary) return;
    const { width, height } = getLayerBounds(selectedPrimary);
    applyToSelected(() => ({ anchorX: Math.round(width * xFactor), anchorY: Math.round(height * yFactor) } as Partial<Layer>));
  };

  const resetSelectedTransform = () => applyToSelected(() => transformDefaults as Partial<Layer>);

  const duplicateTemplateToEditableCopy = (templateId: string) => {
    const template = templateStore.getTemplateById(templateId);
    if (!template) return;
    const duplicatedId = templateStore.saveTemplate({
      name: `${template.name} Copy`,
      folderId: template.folderId,
      canvasWidth: template.canvasWidth,
      canvasHeight: template.canvasHeight,
      layers: template.layers,
    });
    if (!duplicatedId) return;
    const duplicatedTemplate = templateStore.getTemplateById(duplicatedId);
    if (!duplicatedTemplate) return;
    loadTemplate(duplicatedTemplate);
    setTemplateName(duplicatedTemplate.name);
    setSaveNotice(`Duplicated template “${duplicatedTemplate.name}” and loaded it for editing.`);
  };

  const saveCurrentTemplate = (mode: 'new' | 'update' = 'new') => {
    const name = templateName.trim() || loadedTemplate?.name || `Template ${new Date().toLocaleTimeString()}`;
    if (mode === 'update' && loadedTemplateId) {
      templateStore.updateTemplate(loadedTemplateId, {
        name,
        folderId: loadedTemplate?.folderId ?? templateStore.rootId,
        canvasWidth,
        canvasHeight,
        layers,
      });
      setSaveNotice(`Updated “${name}” at ${new Date().toLocaleTimeString()}.`);
    } else {
      const newId = templateStore.saveTemplate({
        name,
        folderId: templateStore.rootId,
        canvasWidth,
        canvasHeight,
        layers,
      });
      if (newId) {
        setLoadedTemplateId(newId);
        setSaveNotice(`Saved new template “${name}” at ${new Date().toLocaleTimeString()}.`);
      }
    }
    setTemplateName(name);
  };

  const getTemplatePublicUrl = () => {
    if (!loadedTemplate) return '';
    return buildTemplateFeedUrl(window.location.origin, loadedTemplate);
  };

  const copyTemplatePublicUrl = async () => {
    const url = getTemplatePublicUrl();
    if (!url) {
      setSaveNotice('Save or load a template first to copy its URL.');
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setSaveNotice('Copied template public URL to clipboard.');
    } catch (error) {
      console.error('Failed to copy template public URL.', error);
      setSaveNotice(`Could not copy automatically. Template URL: ${url}`);
    }
  };

  const exportTemplateImage = async (format: 'jpg' | 'png') => {
    const exportTemplate = {
      id: loadedTemplateId ?? 'design-export-template',
      name: templateName || loadedTemplate?.name || 'template',
      canvasWidth,
      canvasHeight,
      layers: structuredClone(layers),
    };

    const offscreenContainer = document.createElement('div');
    offscreenContainer.style.position = 'fixed';
    offscreenContainer.style.left = '-99999px';
    offscreenContainer.style.top = '0';
    offscreenContainer.style.width = `${canvasWidth}px`;
    offscreenContainer.style.height = `${canvasHeight}px`;
    offscreenContainer.style.pointerEvents = 'none';
    offscreenContainer.style.opacity = '0';
    document.body.appendChild(offscreenContainer);

    const root = createRoot(offscreenContainer);
    try {
      root.render(
        <TemplateSceneSvg
          template={exportTemplate}
          className="h-full w-full"
        />,
      );

      await document.fonts.ready;
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined)));

      const svgElement = offscreenContainer.querySelector('svg');
      if (!svgElement) {
        setSaveNotice('Export failed: render surface unavailable.');
        return;
      }

      svgElement.setAttribute('width', String(canvasWidth));
      svgElement.setAttribute('height', String(canvasHeight));
      const serializedSvg = new XMLSerializer().serializeToString(svgElement);
      const svgBlob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = svgUrl;
      });
      URL.revokeObjectURL(svgUrl);

      const canvas = document.createElement('canvas');
      // Export always targets template-native resolution independent of UI zoom / DPR.
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setSaveNotice('Export failed: canvas unavailable.');
        return;
      }

      if (format === 'jpg') {
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((nextBlob) => resolve(nextBlob), mime, 0.95);
      });
      if (!blob) {
        setSaveNotice('Export failed: unable to serialize image.');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (templateName || loadedTemplate?.name || 'template').replace(/\s+/g, '-').toLowerCase();
      a.href = url;
      a.download = `${safeName}.${format === 'jpg' ? 'jpg' : 'png'}`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSaveNotice(`Exported ${format.toUpperCase()} at ${canvasWidth}×${canvasHeight}.`);
    } finally {
      root.unmount();
      offscreenContainer.remove();
    }
  };

  const handleFormatSwitch = (nextFormatId: TemplateFormatId) => {
    if (nextFormatId === activeFormatId) return;
    const nextFormat = TEMPLATE_FORMATS.find((format) => format.id === nextFormatId);
    if (!nextFormat) return;

    const currentSnapshot: FormatLayoutVariant = {
      canvasWidth,
      canvasHeight,
      layers: structuredClone(layers),
    };

    const existingVariant = layoutVariants[nextFormatId];
    const nextVariant = existingVariant || {
      canvasWidth: nextFormat.width,
      canvasHeight: nextFormat.height,
      layers: currentSnapshot.layers.map((layer) => scaleLayerForCanvas(layer, nextFormat.width / canvasWidth, nextFormat.height / canvasHeight)),
    };

    setLayoutVariants((prev) => ({
      ...prev,
      [activeFormatId]: currentSnapshot,
      [nextFormatId]: nextVariant,
    }));
    setCanvasSize(nextVariant.canvasWidth, nextVariant.canvasHeight);
    loadTemplate({
      id: loadedTemplateId ?? `format-variant-${nextFormatId}`,
      name: templateName.trim() || loadedTemplate?.name || 'Working Template',
      folderId: loadedTemplate?.folderId ?? templateStore.rootId,
      canvasWidth: nextVariant.canvasWidth,
      canvasHeight: nextVariant.canvasHeight,
      layers: structuredClone(nextVariant.layers),
      createdAt: loadedTemplate?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setLoadedTemplateId(loadedTemplateId);
    setCurrentFormatId(nextFormatId);
  };

  useEffect(() => {
    if (!saveNotice) return;
    const timeoutId = window.setTimeout(() => setSaveNotice(null), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [saveNotice]);

  const startStageTextEdit = (layer: Extract<Layer, { kind: 'text' }>) => {
    setStageTextEditId(layer.id);
    setStageTextEditValue(layer.text);
  };

  const commitStageTextEdit = () => {
    if (!stageTextEditId) return;
    updateLayer(stageTextEditId, { text: stageTextEditValue });
    setStageTextEditId(null);
  };

  const parseAssetDimensions = (dimension?: string) => {
    if (!dimension) return null;
    const [w, h] = dimension.split('x').map(Number);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { width: w, height: h };
  };


  const selectLayer = (layerId: string, event?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const additive = !!event?.metaKey || !!event?.ctrlKey;
    const additiveShift = !!event?.shiftKey;
    if (additiveShift) {
      setSelectedLayerIds((prev) => (prev.includes(layerId) ? prev : [...prev, layerId]));
      setLastClickedLayerId(layerId);
      return;
    }
    if (additive) {
      setSelectedLayerIds((prev) => prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId]);
      setLastClickedLayerId(layerId);
      return;
    }
    if (selectedLayerIds.includes(layerId) && selectedLayerIds.length > 1) {
      setKeyObjectId(layerId);
      return;
    }
    setSelectedLayerIds([layerId]);
    setLastClickedLayerId(layerId);
  };

  const onLayerPointerDown = (layer: Layer, event: ReactPointerEvent<HTMLDivElement>) => {
    selectLayer(layer.id, event);
    if (event.button !== 0 || layer.locked) return;
    const stage = stageRef.current;
    if (!stage) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const base = new Map<string, { x: number; y: number }>();
    const isAlreadySelected = selectedLayerIds.includes(layer.id);
    const activeIds = (event.metaKey || event.ctrlKey)
      ? (isAlreadySelected ? selectedLayerIds : [...selectedLayerIds, layer.id])
      : (isAlreadySelected ? selectedLayerIds : [layer.id]);
    activeIds.forEach((id) => {
      const l = layerById.get(id);
      if (l && !l.locked) base.set(id, { x: l.x, y: l.y });
    });
    if (!base.size) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, base };
    const onMove = (move: globalThis.PointerEvent) => {
      if (!dragRef.current) return;
      const rawDx = (move.clientX - dragRef.current.startX) / stageScale;
      const rawDy = (move.clientY - dragRef.current.startY) / stageScale;
      let dx = rawDx;
      let dy = rawDy;
      if (move.shiftKey) {
        if (Math.abs(rawDx) >= Math.abs(rawDy)) dy = 0;
        else dx = 0;
      }
      dragRef.current.base.forEach((start, id) => {
        const nextX = Math.round(start.x + dx);
        const nextY = Math.round(start.y + dy);
        const snappedX = snapToGrid ? Math.round(nextX / 10) * 10 : nextX;
        const snappedY = snapToGrid ? Math.round(nextY / 10) * 10 : nextY;
        updateLayer(id, { x: snappedX, y: snappedY });
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };


  const startAreaTextResize = (
    layer: Extract<Layer, { kind: 'text' }>,
    handle: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw',
    event: ReactMouseEvent
  ) => {
    if (event.button !== 0 || layer.locked || layer.textMode !== 'area') return;
    event.preventDefault();
    event.stopPropagation();
    const rect = getLayerRect(layer);
    resizeRef.current = {
      layerId: layer.id,
      handle,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      anchorX: layer.anchorX ?? 0,
      anchorY: layer.anchorY ?? 0,
    };

    const onMove = (move: globalThis.MouseEvent) => {
      if (!resizeRef.current) return;
      const session = resizeRef.current;
      const active = layerById.get(session.layerId);
      if (!active || active.kind !== 'text' || active.textMode !== 'area') return;
      const dx = (move.clientX - session.startX) / stageScale;
      const dy = (move.clientY - session.startY) / stageScale;

      const minSize = 16;
      const nextLeft = session.left + ((session.handle.includes('w')) ? Math.min(dx, session.width - minSize) : 0);
      const nextTop = session.top + ((session.handle.includes('n')) ? Math.min(dy, session.height - minSize) : 0);
      const nextWidth = Math.max(minSize, session.width + (session.handle.includes('e') ? dx : 0) - (session.handle.includes('w') ? dx : 0));
      const nextHeight = Math.max(minSize, session.height + (session.handle.includes('s') ? dy : 0) - (session.handle.includes('n') ? dy : 0));

      updateLayer(session.layerId, {
        x: Math.round(nextLeft + session.anchorX),
        y: Math.round(nextTop + session.anchorY),
        width: Math.round(nextWidth),
        height: Math.round(nextHeight),
      } as Partial<Layer>);
    };

    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const alignLayers = (mode: 'left' | 'hCenter' | 'right' | 'top' | 'vCenter' | 'bottom') => {
    if (!selectedLayers.length) return;
    const rects = selectedLayers.map(getLayerRect);
    const keyRect = keyObjectId ? rects.find((r) => r.layer.id === keyObjectId) : undefined;
    const minX = Math.min(...rects.map((r) => r.left));
    const maxX = Math.max(...rects.map((r) => r.right));
    const minY = Math.min(...rects.map((r) => r.top));
    const maxY = Math.max(...rects.map((r) => r.bottom));

    const ref = {
      left: alignScope === 'canvas' ? 0 : alignScope === 'key' && keyRect ? keyRect.left : minX,
      right: alignScope === 'canvas' ? canvasWidth : alignScope === 'key' && keyRect ? keyRect.right : maxX,
      top: alignScope === 'canvas' ? 0 : alignScope === 'key' && keyRect ? keyRect.top : minY,
      bottom: alignScope === 'canvas' ? canvasHeight : alignScope === 'key' && keyRect ? keyRect.bottom : maxY,
    };

    rects.forEach((rect) => {
      if (alignScope === 'key' && keyRect && rect.layer.id === keyRect.layer.id) return;
      if (mode === 'left') updateLayer(rect.layer.id, { x: rect.layer.x + (ref.left - rect.left) });
      if (mode === 'right') updateLayer(rect.layer.id, { x: rect.layer.x + (ref.right - rect.right) });
      if (mode === 'hCenter') updateLayer(rect.layer.id, { x: rect.layer.x + (((ref.left + ref.right) / 2) - rect.centerX) });
      if (mode === 'top') updateLayer(rect.layer.id, { y: rect.layer.y + (ref.top - rect.top) });
      if (mode === 'bottom') updateLayer(rect.layer.id, { y: rect.layer.y + (ref.bottom - rect.bottom) });
      if (mode === 'vCenter') updateLayer(rect.layer.id, { y: rect.layer.y + (((ref.top + ref.bottom) / 2) - rect.centerY) });
    });
  };

  const distributeCenters = (axis: 'x' | 'y') => {
    if (selectedLayers.length < 3) return;
    const rects = selectedLayers.map(getLayerRect).sort((a, b) => axis === 'x' ? a.centerX - b.centerX : a.centerY - b.centerY);
    const first = rects[0];
    const last = rects[rects.length - 1];
    const total = axis === 'x' ? (last.centerX - first.centerX) : (last.centerY - first.centerY);
    const step = total / (rects.length - 1);
    rects.forEach((rect, i) => {
      if (i === 0 || i === rects.length - 1) return;
      const target = (axis === 'x' ? first.centerX : first.centerY) + (step * i);
      if (axis === 'x') updateLayer(rect.layer.id, { x: rect.layer.x + (target - rect.centerX) });
      else updateLayer(rect.layer.id, { y: rect.layer.y + (target - rect.centerY) });
    });
  };

  const distributeEdges = (axis: 'x' | 'y') => {
    if (selectedLayers.length < 3) return;
    const rects = selectedLayers.map(getLayerRect).sort((a, b) => axis === 'x' ? a.left - b.left : a.top - b.top);
    const first = rects[0];
    const last = rects[rects.length - 1];
    const total = axis === 'x' ? (last.left - first.left) : (last.top - first.top);
    const step = total / (rects.length - 1);
    rects.forEach((rect, i) => {
      if (i === 0 || i === rects.length - 1) return;
      const target = (axis === 'x' ? first.left : first.top) + (step * i);
      if (axis === 'x') updateLayer(rect.layer.id, { x: rect.layer.x + (target - rect.left) });
      else updateLayer(rect.layer.id, { y: rect.layer.y + (target - rect.top) });
    });
  };

  const distributeSpacing = (axis: 'x' | 'y') => {
    if (selectedLayers.length < 2) return;
    const spacing = Number(distributeSpacingValue);
    if (!Number.isFinite(spacing)) return;
    const rects = selectedLayers.map(getLayerRect).sort((a, b) => axis === 'x' ? a.left - b.left : a.top - b.top);
    let cursor = axis === 'x' ? rects[0].right + spacing : rects[0].bottom + spacing;
    rects.slice(1).forEach((rect) => {
      if (axis === 'x') {
        updateLayer(rect.layer.id, { x: rect.layer.x + (cursor - rect.left) });
        cursor += rect.width + spacing;
      } else {
        updateLayer(rect.layer.id, { y: rect.layer.y + (cursor - rect.top) });
        cursor += rect.height + spacing;
      }
    });
  };

  const renderFolderTree = (id: string, depth = 0): JSX.Element | null => {
    const node = getNode(id);
    if (!node || node.type !== 'folder') return null;
    const children = node.children.map(getNode).filter((x): x is ExplorerNode => !!x && x.type === 'folder');
    const isOpen = assetStore.expandedBranded[id] ?? depth === 0;
    return (
      <div key={id} style={{ marginLeft: depth * 12 }} className="space-y-1">
        <div className="flex items-center gap-1">
          {children.length > 0 ? (
            <button className="h-5 w-5 rounded border border-slate-700 bg-slate-800 text-xs" onClick={() => assetStore.toggleExpanded(id, 'branded')}>{isOpen ? '▾' : '▸'}</button>
          ) : <span className="inline-block h-5 w-5" />}
          <button onClick={() => setFolderId(id)} onDoubleClick={() => setFolderId(id)} className={`w-full rounded border px-2 py-1 text-left ${folderId === id ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`}>{node.name}</button>
        </div>
        {isOpen && children.map((child) => renderFolderTree(child.id, depth + 1))}
      </div>
    );
  };

  const actionBtn = 'h-8 w-8 rounded border border-slate-600 text-sm text-slate-200 hover:bg-slate-700';


  const fitScale = useMemo(() => {
    const safeW = Math.max(1, stageViewport.width);
    const safeH = Math.max(1, stageViewport.height);
    return Math.max(0.01, Math.min(safeW / canvasWidth, safeH / canvasHeight));
  }, [stageViewport, canvasWidth, canvasHeight]);

  const stageScale = fitScale * stageZoom;
  const rulerOffset = showRulers ? RULER_SIZE : 0;
  const horizontalRulerTicks = useMemo(() => buildRulerTicks(canvasWidth, stageScale), [canvasWidth, stageScale]);
  const verticalRulerTicks = useMemo(() => buildRulerTicks(canvasHeight, stageScale), [canvasHeight, stageScale]);

  const resetViewport = () => setStageZoom(1);


  useEffect(() => {
    const viewport = stageViewportRef.current;
    if (!viewport) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = -event.deltaY * 0.0015;
      setStageZoom((prev) => Math.min(3, Math.max(0.3, prev + delta)));
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, []);

  const renderLayerPreview = (layer: Layer) => {
    const transform = getTransform(layer);
    const bounds = getLayerBounds(layer);
    const left = ((layer.kind === 'shape' ? layer.x : (layer.x - transform.anchorX)) / canvasWidth) * 100;
    const top = ((layer.kind === 'shape' ? layer.y : (layer.y - transform.anchorY)) / canvasHeight) * 100;
    const style = {
      left: `${left}%`,
      top: `${top}%`,
      opacity: layer.opacity / 100,
      transformOrigin: `${transform.anchorX}px ${transform.anchorY}px`,
      transform: `scale(${transform.scaleX / 100}, ${transform.scaleY / 100}) rotate(${transform.rotation}deg)`,
      width: `${(bounds.width / canvasWidth) * 100}%`,
      height: `${(bounds.height / canvasHeight) * 100}%`,
    };

    return (
      <div key={layer.id} data-layer-node="true" className={`absolute select-none ${selectedLayerIds.includes(layer.id) ? 'outline outline-2 outline-blue-400' : 'outline outline-1 outline-slate-500/40'} ${layer.locked ? 'cursor-not-allowed' : 'cursor-move'}`} style={style} onPointerDown={(event) => onLayerPointerDown(layer, event)}>
        {layer.kind === 'asset' && <img src={assetById.get(layer.assetId)?.src} alt={layer.name} className="h-full w-full object-contain" draggable={false} />}
        {layer.kind === 'shape' && (
          <div className="h-full w-full" style={{ background: layer.fill, borderRadius: layer.shapeType === 'ellipse' ? '9999px' : '0' }} />
        )}
        {layer.kind === 'text' && (
          stageTextEditId === layer.id ? (
            <textarea
              className="h-full w-full resize-none bg-slate-950/90 p-1 text-white outline-none"
              style={{ fontSize: `${layer.size}px`, fontFamily: layer.fontFamily, lineHeight: 1.15 }}
              value={stageTextEditValue}
              autoFocus
              onChange={(e) => setStageTextEditValue(e.target.value)}
              onBlur={commitStageTextEdit}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitStageTextEdit(); } }}
            />
          ) : (
            <div className="h-full w-full" onDoubleClick={(e) => { e.stopPropagation(); startStageTextEdit(layer); }} style={{ fontSize: `${layer.size}px`, color: layer.color, fontWeight: 700, fontFamily: layer.fontFamily, textAlign: layer.textAlign, lineHeight: 1.15, whiteSpace: layer.textMode === 'point' ? 'pre' : 'pre-wrap', overflow: layer.textMode === 'point' ? 'visible' : 'hidden', display: 'flex', justifyContent: layer.textAlign === 'left' ? 'flex-start' : layer.textAlign === 'center' ? 'center' : 'flex-end' }}>{getTextContent(layer)}</div>
          )
        )}
        <div className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400" style={{ left: `${(transform.anchorX / bounds.width) * 100}%`, top: `${(transform.anchorY / bounds.height) * 100}%` }} />
        {isAreaTextLayer(layer) && selectedLayerIds.length === 1 && selectedLayerIds.includes(layer.id) && (
          <>
            {[
              { key: 'nw', left: '0%', top: '0%', cursor: 'nwse-resize' },
              { key: 'n', left: '50%', top: '0%', cursor: 'ns-resize' },
              { key: 'ne', left: '100%', top: '0%', cursor: 'nesw-resize' },
              { key: 'e', left: '100%', top: '50%', cursor: 'ew-resize' },
              { key: 'se', left: '100%', top: '100%', cursor: 'nwse-resize' },
              { key: 's', left: '50%', top: '100%', cursor: 'ns-resize' },
              { key: 'sw', left: '0%', top: '100%', cursor: 'nesw-resize' },
              { key: 'w', left: '0%', top: '50%', cursor: 'ew-resize' },
            ].map((handle) => (
              <button
                key={handle.key}
                type="button"
                className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-blue-300 bg-slate-950"
                style={{ left: handle.left, top: handle.top, cursor: handle.cursor }}
                onMouseDown={(event) => startAreaTextResize(layer, handle.key as 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw', event)}
              />
            ))}
          </>
        )}
      </div>
    );
  };

  return (
    <section className="h-full min-h-0">
      <section className="grid h-full min-h-0 grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 xl:grid-cols-[360px_minmax(0,1fr)_320px] 2xl:grid-cols-[400px_minmax(0,1fr)_360px] overflow-hidden">
        <aside className="flex min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-950 p-3">
          <div className="grid grid-cols-2 border-b border-slate-700 text-xs font-bold uppercase tracking-wider">
            <button className={`px-3 py-2 ${leftPanelTab === 'layers' ? 'border-b-2 border-blue-500 text-slate-100' : 'text-slate-400'}`} onClick={() => setLeftPanelTab('layers')}>Layer Stack</button>
            <button className={`px-3 py-2 ${leftPanelTab === 'assets' ? 'border-b-2 border-blue-500 text-slate-100' : 'text-slate-400'}`} onClick={() => setLeftPanelTab('assets')}>Assets</button>
          </div>

          <div className="mt-3 min-h-0 flex-1 overflow-auto pr-1">
            <div className="mb-3">
              <h3 className="text-sm font-bold tracking-[0.2em] text-zinc-100">STAGE PRO</h3>
              <p className="text-[10px] tracking-[0.25em] text-zinc-400">STUDIO EDITOR</p>
            </div>
            <div className="mb-3 grid grid-cols-4 gap-1 text-[10px]">
              <button className="rounded bg-zinc-800 px-1 py-2 text-zinc-100 hover:bg-zinc-700" onClick={addText}>T<br/>TEXT</button>
              <button className="rounded bg-zinc-800 px-1 py-2 text-zinc-100" onClick={addShape}>☆<br/>SHAPE</button>
              <button className="rounded bg-zinc-800 px-1 py-2 text-zinc-500">∞<br/>FIGMA</button>
              <button className="rounded bg-zinc-800 px-1 py-2 text-zinc-500">▶<br/>RIVE</button>
            </div>
            <div className="mb-3 flex rounded-full bg-zinc-800 p-1 text-xs">
              <button className={`flex-1 rounded-full px-3 py-1 ${interactionMode === 'select' ? 'bg-blue-900 text-blue-300' : 'text-zinc-400'}`} onClick={() => setInteractionMode('select')}>SELECT</button>
              <button className={`flex-1 rounded-full px-3 py-1 ${interactionMode === 'pan' ? 'bg-blue-900 text-blue-300' : 'text-zinc-400'}`} onClick={() => setInteractionMode('pan')}>PAN</button>
            </div>

            {leftPanelTab === 'layers' ? (
              <>
          {!stackLayers.length ? <p className="text-slate-400">No layers yet.</p> : <div className="flex min-h-[220px] flex-col space-y-2" onClick={(event) => { if (event.target === event.currentTarget) { setSelectedLayerIds([]); setSelectedGuideId(null); } }}>{stackLayers.map((layer) => (
            <div key={layer.id} draggable className={`select-none rounded border p-2 ${selectedLayerIds.includes(layer.id) ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`} onClick={(event) => selectLayer(layer.id, event)} onDragStart={() => setDragLayerId(layer.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (dragLayerId) moveLayer(dragLayerId, layer.id); setDragLayerId(null); }} onDragEnd={() => setDragLayerId(null)}>
              <div className="flex items-center gap-2">
                <button className={actionBtn} onClick={(event) => { event.stopPropagation(); setZOrder(layer.id, 'up'); }} title="Move up">↑</button>
                <button className={actionBtn} onClick={(event) => { event.stopPropagation(); setZOrder(layer.id, 'down'); }} title="Move down">↓</button>
                {editingLayerId === layer.id ? (
                  <input className="flex-1 rounded border border-blue-500 bg-slate-950 px-2 py-1" value={editingLayerValue} onChange={(e) => setEditingLayerValue(e.target.value)} onClick={(event) => event.stopPropagation()} onBlur={() => { renameLayer(layer.id, editingLayerValue.trim() || layer.name); setEditingLayerId(null); setEditingLayerValue(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { renameLayer(layer.id, editingLayerValue.trim() || layer.name); setEditingLayerId(null); setEditingLayerValue(''); } }} autoFocus />
                ) : (
                  <strong className="flex-1 truncate" onDoubleClick={() => { setEditingLayerId(layer.id); setEditingLayerValue(layer.name); }}>{layer.name}</strong>
                )}
                <button className={actionBtn} onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }); }} title={layer.visible ? 'Hide layer' : 'Show layer'}>{layer.visible ? '👁' : '🚫'}</button>
                <button className={actionBtn} onClick={(event) => { event.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }} title={layer.locked ? 'Unlock layer' : 'Lock layer'}>{layer.locked ? '🔒' : '🔓'}</button>
                <button className={actionBtn} onClick={(event) => { event.stopPropagation(); duplicateLayer(layer.id); }} title="Duplicate">⧉</button>
                <button className={`${actionBtn} border-red-700 text-red-300`} onClick={(event) => { event.stopPropagation(); deleteLayer(layer.id); }} title="Delete">🗑</button>
              </div>
            </div>
          ))}</div>}
              </>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets" className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm" />
                  <label className="cursor-pointer rounded bg-blue-700 px-3 py-2 text-sm">Upload<input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple className="hidden" onChange={async (event) => { const upload = Array.from(event.target.files || []); if (upload.length) await assetStore.uploadFiles(upload, folderId, 'branded'); event.currentTarget.value = ''; }} /></label>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button className={`rounded border px-2 py-2 font-semibold ${assetBin === 'graphics' ? 'border-blue-500 bg-blue-900/30 text-blue-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300'}`} onClick={() => setAssetBin('graphics')}>Graphics</button>
                  <button className={`rounded border px-2 py-2 font-semibold ${assetBin === 'videos' ? 'border-blue-500 bg-blue-900/30 text-blue-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300'}`} onClick={() => setAssetBin('videos')}>Videos</button>
                  <button className={`rounded border px-2 py-2 font-semibold ${assetBin === 'templates' ? 'border-blue-500 bg-blue-900/30 text-blue-300' : 'border-zinc-700 bg-zinc-900 text-zinc-300'}`} onClick={() => setAssetBin('templates')}>Templates</button>
                </div>
                {assetBin !== 'templates' && (
                  <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
                    <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Folders</div>
                    {renderFolderTree(assetStore.brandedExplorer.rootId)}
                  </div>
                )}
                {assetBin !== 'templates' ? (
                  <div className="grid grid-cols-2 gap-2">
                    {filtered.map((item) => {
                      const dims = item.type === 'file' ? parseAssetDimensions(item.dimension) : null;
                      return (
                        <button
                          key={item.id}
                          className="rounded border border-zinc-700 bg-zinc-900 p-1 text-left hover:border-blue-500/60"
                          onClick={() => {
                            if (item.type === 'folder') setFolderId(item.id);
                            else addAssetLayer(item.id, dims ?? undefined);
                          }}
                          onDoubleClick={() => {
                            const next = window.prompt('Rename item', item.name)?.trim();
                            if (next && next !== item.name) assetStore.renameNode(item.id, next, 'branded');
                          }}
                        >
                          {item.type === 'file' ? (
                            <img src={item.src} alt={item.name} className="mb-1 h-20 w-full rounded object-cover" />
                          ) : (
                            <div className="mb-1 grid h-20 w-full place-items-center rounded border border-dashed border-zinc-600 bg-zinc-950 text-3xl">📁</div>
                          )}
                          <span className="block truncate text-xs text-zinc-300">{item.type === 'folder' ? `📁 ${item.name}` : item.name}</span>
                        </button>
                      );
                    })}
                    {!filtered.length && <p className="text-sm text-zinc-500">No matching {assetBin} in this folder.</p>}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredTemplates.map((template) => (
                      <article key={template.id} className="rounded border border-zinc-700 bg-zinc-900 p-2">
                        <p className="truncate text-sm font-semibold text-zinc-100">🧩 {template.name}</p>
                        <p className="text-[11px] text-zinc-400">{template.canvasWidth} × {template.canvasHeight} · {template.layers.length} layers</p>
                        <div className="mt-2 flex gap-2 text-xs">
                          <button className="rounded bg-blue-700 px-2 py-1" onClick={() => { loadTemplate(template); setTemplateName(template.name); }}>Load</button>
                          <button className="rounded border border-blue-700 px-2 py-1 text-blue-300" onClick={() => duplicateTemplateToEditableCopy(template.id)}>Duplicate</button>
                        </div>
                      </article>
                    ))}
                    {!filteredTemplates.length && <p className="text-sm text-zinc-500">No matching templates.</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Canvas · {canvasWidth} × {canvasHeight}</h3>
            <div className="ml-auto flex min-w-0 items-center justify-end gap-2 overflow-x-auto">
              <input className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
              <select className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" value={activeFormatId} onChange={(e) => handleFormatSwitch(e.target.value as TemplateFormatId)}>
                {TEMPLATE_FORMATS.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}
              </select>
              <button className="rounded bg-blue-700 px-3 py-1 text-xs font-semibold" onClick={() => saveCurrentTemplate('new')}>Save Template</button>
              <button className="rounded border border-blue-700 px-3 py-1 text-xs font-semibold text-blue-300 disabled:opacity-50" disabled={!loadedTemplateId} onClick={() => saveCurrentTemplate('update')}>Update</button>
              <details className="group relative">
                <summary className="list-none rounded border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 marker:content-none">Export</summary>
                <div className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col gap-1 rounded border border-slate-700 bg-slate-900 p-2 text-xs shadow-lg shadow-black/40">
                  <button className="rounded border border-slate-700 px-2 py-1 text-left" onClick={() => exportTemplateImage('png')}>Export</button>
                  <button className="rounded border border-slate-700 px-2 py-1 text-left" onClick={() => exportTemplateImage('jpg')}>Export JPG</button>
                  <button className="rounded border border-slate-700 px-2 py-1 text-left" onClick={() => exportTemplateImage('png')}>Export PNG</button>
                  <button className="rounded bg-emerald-700 px-2 py-1 text-left font-semibold" onClick={copyTemplatePublicUrl}>Copy Public URL</button>
                </div>
              </details>
              <button className="shrink-0 rounded bg-emerald-700 px-3 py-1 text-xs font-semibold" onClick={copyTemplatePublicUrl}>Copy Public URL</button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-slate-400">Stage Align & Distribute</span>
            <button className={`rounded border px-2 py-1 ${alignScope === 'selection' ? 'border-blue-500 text-blue-300' : 'border-slate-700 text-slate-300'}`} onClick={() => setAlignScope('selection')}>Selection</button>
            <button className={`rounded border px-2 py-1 ${alignScope === 'key' ? 'border-blue-500 text-blue-300' : 'border-slate-700 text-slate-300'}`} onClick={() => setAlignScope('key')}>Key Object</button>
            <button className={`rounded border px-2 py-1 ${alignScope === 'canvas' ? 'border-blue-500 text-blue-300' : 'border-slate-700 text-slate-300'}`} onClick={() => setAlignScope('canvas')}>Stage</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('left')}>Left</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('hCenter')}>H Center</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('right')}>Right</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('top')}>Top</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('vCenter')}>V Middle</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('bottom')}>Bottom</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeCenters('x')}>Dist Ctr H</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeCenters('y')}>Dist Ctr V</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeEdges('x')}>Dist Edge H</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeEdges('y')}>Dist Edge V</button>
            <input className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1" value={distributeSpacingValue} onChange={(e) => setDistributeSpacingValue(e.target.value)} aria-label="Distribution spacing" />
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeSpacing('x')}>Space H</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeSpacing('y')}>Space V</button>
          </div>
          {saveNotice && <p className="rounded border border-emerald-700 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200">{saveNotice}</p>}
          <div className="flex items-center justify-between rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Feature Flags</span>
            <button
              type="button"
              className={`rounded border px-2 py-1 ${dataBindingBetaEnabled ? 'border-cyan-500 text-cyan-300' : 'border-slate-700 text-slate-400'}`}
              onClick={() => setDataBindingBetaEnabled((v) => !v)}
            >
              Data Binding (Beta)
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-2 text-xs text-slate-300">
            <button className={`rounded border px-2 py-1 ${showRulers ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setShowRulers((v) => !v)}>Rulers</button>
            <button className={`rounded border px-2 py-1 ${showGuides ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setShowGuides((v) => !v)}>Guides</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => { setGuides([]); setSelectedGuideId(null); }}>Clear Guides</button>
            <button className={`rounded border px-2 py-1 ${showGrid ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setShowGrid((v) => !v)}>Grid</button>
            <button className={`rounded border px-2 py-1 ${snapToGrid ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setSnapToGrid((v) => !v)}>Snap</button>
            <button className={`rounded border px-2 py-1 ${showSafeZones ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setShowSafeZones((v) => !v)}>Safe Zones</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={resetViewport}>Fit to View</button>
            <div className="ml-1 flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200">
              <button className="rounded border border-slate-700 px-2 py-1" onClick={() => setStageZoom((z) => Math.max(0.3, z - 0.1))} aria-label="Zoom out">-</button>
              <span aria-live="polite">{Math.round(stageZoom * 100)}%</span>
              <button className="rounded border border-slate-700 px-2 py-1" onClick={() => setStageZoom((z) => Math.min(3, z + 0.1))} aria-label="Zoom in">+</button>
            </div>
            <span className="text-slate-500">Ctrl + wheel to zoom canvas.</span>
          </div>
          <StageViewportFrame ref={stageViewportRef}>
            <div className="relative" style={{ width: `${canvasWidth * stageScale + rulerOffset}px`, height: `${canvasHeight * stageScale + rulerOffset}px` }}>
              {showRulers && (
                <div className="pointer-events-none absolute inset-0 z-20 text-[10px] text-slate-300/90">
                  <div className="absolute left-0 top-0 border-b border-r border-slate-600/80 bg-slate-900/95" style={{ width: `${RULER_SIZE}px`, height: `${RULER_SIZE}px` }} />
                  <div
                    className="pointer-events-auto absolute top-0 overflow-hidden border-b border-slate-600/80 bg-slate-900/95"
                    style={{ left: `${RULER_SIZE}px`, width: `${canvasWidth * stageScale}px`, height: `${RULER_SIZE}px` }}
                    onMouseDown={(event) => startGuideFromRuler('y', event)}
                  >
                    {horizontalRulerTicks.map((tick) => (
                      <div key={`hx-${tick.value}`} className="pointer-events-none absolute bottom-0" style={{ left: `${tick.position}px`, height: `${tick.major ? 14 : 8}px`, borderLeft: tick.major ? '1px solid rgba(148,163,184,0.95)' : '1px solid rgba(148,163,184,0.55)' }}>
                        {tick.major && <span className="absolute left-1 top-[2px] text-[10px] text-slate-200">{Math.round(tick.value)}</span>}
                      </div>
                    ))}
                  </div>
                  <div
                    className="pointer-events-auto absolute left-0 overflow-hidden border-r border-slate-600/80 bg-slate-900/95"
                    style={{ top: `${RULER_SIZE}px`, width: `${RULER_SIZE}px`, height: `${canvasHeight * stageScale}px` }}
                    onMouseDown={(event) => startGuideFromRuler('x', event)}
                  >
                    {verticalRulerTicks.map((tick) => (
                      <div key={`vy-${tick.value}`} className="pointer-events-none absolute right-0" style={{ top: `${tick.position}px`, width: `${tick.major ? 14 : 8}px`, borderTop: tick.major ? '1px solid rgba(148,163,184,0.95)' : '1px solid rgba(148,163,184,0.55)' }}>
                        {tick.major && <span className="absolute right-[2px] top-1 -translate-y-1/2 text-[10px] text-slate-200">{Math.round(tick.value)}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="absolute" style={{ left: `${rulerOffset}px`, top: `${rulerOffset}px`, width: `${canvasWidth * stageScale}px`, height: `${canvasHeight * stageScale}px` }}>
              <div ref={stageRef} className="relative overflow-hidden rounded border border-slate-500 bg-slate-900 shadow-[0_0_0_1px_rgba(148,163,184,0.25),0_20px_60px_rgba(0,0,0,0.45)]" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px`, transform: `scale(${stageScale})`, transformOrigin: 'top left' }} onPointerDown={(event) => {
                if (event.target === event.currentTarget) {
                  setSelectedLayerIds([]);
                  setSelectedGuideId(null);
                }
              }}>
              {showGrid && <div className="pointer-events-none absolute inset-0 opacity-40" style={{ backgroundImage: 'linear-gradient(to right, rgba(148,163,184,0.3) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.3) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />}
              {showGuides && (
                <div className="pointer-events-none absolute inset-0 z-50">
                  {guides.map((guide) => (
                    <div
                      key={guide.id}
                      data-guide-node="true"
                      className="pointer-events-auto absolute"
                      style={guide.axis === 'x'
                        ? { left: `${guide.position}px`, top: 0, width: '1px', height: '100%', background: selectedGuideId === guide.id ? 'rgba(251,191,36,1)' : 'rgba(34,211,238,0.9)', cursor: 'ew-resize' }
                        : { left: 0, top: `${guide.position}px`, width: '100%', height: '1px', background: selectedGuideId === guide.id ? 'rgba(251,191,36,1)' : 'rgba(34,211,238,0.9)', cursor: 'ns-resize' }}
                      onMouseDown={(event) => onGuideMouseDown(guide, event)}
                      onDoubleClick={(event) => onGuideDoubleClick(guide, event)}
                      onContextMenu={(event) => onGuideContextMenu(guide, event)}
                    />
                  ))}
                </div>
              )}
              {guideReadout && (
                <div className="pointer-events-none fixed z-[60] rounded border border-cyan-500/60 bg-slate-950/95 px-2 py-1 text-[11px] text-cyan-200" style={{ left: `${guideReadout.x}px`, top: `${guideReadout.y}px` }}>
                  {guideReadout.value}px
                </div>
              )}
              {showSafeZones && <>
                <div className="pointer-events-none absolute" style={{ left: `${canvasWidth * 0.05}px`, top: `${canvasHeight * 0.05}px`, width: `${canvasWidth * 0.9}px`, height: `${canvasHeight * 0.9}px`, border: '1px dashed rgba(251,191,36,0.8)' }} />
                <div className="pointer-events-none absolute" style={{ left: `${canvasWidth * 0.1}px`, top: `${canvasHeight * 0.1}px`, width: `${canvasWidth * 0.8}px`, height: `${canvasHeight * 0.8}px`, border: '1px dashed rgba(52,211,153,0.8)' }} />
              </>}
              {!canvasLayers.length ? <p className="absolute inset-0 grid place-items-center text-xl text-slate-400">Stage is blank.</p> : canvasLayers.map(renderLayerPreview)}
              </div>
              </div>
            </div>
          </StageViewportFrame>
        </div>

        <aside className="flex min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-950 p-3">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Layer Inspector</h3>
          <div className="min-h-0 flex-1 overflow-auto pr-1">
            {dataBindingBetaEnabled && (
              <DataInspectorPanel
                live={livePayload}
                derived={derivedPayload}
                scorebug={scorebugPayload}
                activeTab={bindingContext}
                onActiveTabChange={setBindingContext}
              />
            )}
            {!selectedPrimary ? <p className="mt-3 text-slate-400">Select a layer to edit.</p> : (
            <div className="space-y-3 mt-3">
              <div className="rounded border border-slate-700 bg-slate-900 p-2"><div className="mb-1 text-xs uppercase text-slate-400">Selected ({selectedLayerIds.length})</div>{editingLayerId === selectedPrimary.id ? (<input className="w-full rounded border border-blue-500 bg-slate-950 px-2 py-1 font-semibold" value={editingLayerValue} onChange={(e) => setEditingLayerValue(e.target.value)} onBlur={() => { renameLayer(selectedPrimary.id, editingLayerValue.trim() || selectedPrimary.name); setEditingLayerId(null); setEditingLayerValue(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { renameLayer(selectedPrimary.id, editingLayerValue.trim() || selectedPrimary.name); setEditingLayerId(null); setEditingLayerValue(''); } }} autoFocus />) : (<strong className="cursor-text" onDoubleClick={() => { setEditingLayerId(selectedPrimary.id); setEditingLayerValue(selectedPrimary.name); }}>{selectedPrimary.name}</strong>)}</div>

              {selectedPrimary.kind === 'shape' && (
                <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                  <h4 className="font-semibold">Shape</h4>
                  <div className="flex gap-2 text-xs">
                    <button className={`rounded border px-2 py-1 ${selectedPrimary.shapeType === 'rectangle' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'shape' ? ({ shapeType: 'rectangle' } as Partial<Layer>) : ({}))}>Rectangle</button>
                    <button className={`rounded border px-2 py-1 ${selectedPrimary.shapeType === 'ellipse' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'shape' ? ({ shapeType: 'ellipse' } as Partial<Layer>) : ({}))}>Ellipse</button>
                  </div>
                  <label className="text-sm">Fill<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="color" value={selectedPrimary.fill} onChange={(e) => applyToSelected((layer) => layer.kind === 'shape' ? ({ fill: e.target.value } as Partial<Layer>) : ({}))} /></label>
                </div>
              )}

              {selectedPrimary.kind === 'text' && (
                <>
                  <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                    <h4 className="font-semibold">Data Binding</h4>
                    <label className="text-sm">Source<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.dataBindingSource} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ dataBindingSource: e.target.value } as Partial<Layer>) : ({}))}><option value="manual">Manual</option><option value="live-feed">Live Feed</option><option value="game-state">Game State</option><option value="stats-service">Stats Service</option></select></label>
                    <label className="text-sm">Level
                      <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={bindingLevel} onChange={(event) => setBindingLevel(event.target.value as FieldLevel)}>
                        <option value="game">Game</option>
                        <option value="team">Team</option>
                        <option value="player">Player</option>
                      </select>
                    </label>
                    {bindingLevel === 'team' && (
                      <label className="text-sm">Scope
                        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={bindingSide} onChange={(event) => setBindingSide(event.target.value as FieldSide)}>
                          <option value="home">Home team</option>
                          <option value="away">Away team</option>
                        </select>
                      </label>
                    )}
                    {bindingLevel === 'player' && (
                      <>
                        <label className="text-sm">Scope
                          <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={bindingSide} onChange={(event) => setBindingSide(event.target.value as FieldSide)}>
                            <option value="home">Home players</option>
                            <option value="away">Away players</option>
                          </select>
                        </label>
                        <label className="text-sm">Player Search
                          <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" placeholder="Search players…" value={bindingPlayerQuery} onChange={(e) => setBindingPlayerQuery(e.target.value)} />
                        </label>
                        <label className="text-sm">Player
                          <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={bindingPlayerId} onChange={(event) => setBindingPlayerId(event.target.value)}>
                            <option value="">Choose player…</option>
                            {playerOptions.map((player) => <option key={player.id} value={player.id}>{player.label}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                    <label className="text-sm">Metric Search
                      <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-sm" placeholder="Search metrics in current sport/context…" value={bindingMetricQuery} onChange={(e) => setBindingMetricQuery(e.target.value)} />
                    </label>
                    <label className="text-sm">Metric
                      <select
                        className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2"
                        value={selectedPrimary.dataBindingField}
                        onChange={(event) => applyToSelected((layer) => layer.kind === 'text' ? ({ dataBindingField: event.target.value } as Partial<Layer>) : ({}))}
                      >
                        <option value="">Choose metric…</option>
                        {groupedMetricOptions.map((group) => (
                          <optgroup key={group.group} label={group.group}>
                            {group.fields.map((field) => <option key={field.path} value={field.path}>{`${field.label} (${field.path})`}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="w-fit rounded border border-slate-700 px-2 py-1 text-xs" onClick={() => setBindingAdvancedOpen((value) => !value)}>
                      Advanced
                    </button>
                    {bindingAdvancedOpen && (
                      <label className="text-sm">Advanced: Raw Path
                        <input
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs"
                          value={selectedPrimary.dataBindingField}
                          onChange={(event) => applyToSelected((layer) => layer.kind === 'text' ? ({ dataBindingField: event.target.value } as Partial<Layer>) : ({}))}
                          placeholder="boxScore.homePlayers.Player Name.points"
                        />
                      </label>
                    )}
                    <p className="text-xs text-slate-400">Preview value: {previewText}</p>
                    {selectedPrimary.dataBindingField && previewText === 'N/A' && (
                      <p className="text-xs text-amber-300">Not available for this sport/state.</p>
                    )}
                    <p className="text-xs text-slate-500">Active sport: {activeSport.toUpperCase()} · Context: {bindingContext.toUpperCase()}</p>
                  </div>

                  <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                    <h4 className="font-semibold">Text</h4>
                    <label className="block text-sm">Content<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.text} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ text: e.target.value } as Partial<Layer>) : ({}))} /></label>
                    <div className="grid grid-cols-2 gap-2"><label className="text-sm">Color<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="color" value={selectedPrimary.color} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ color: e.target.value } as Partial<Layer>) : ({}))} /></label><label className="text-sm">Size<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.size} onChange={(e) => setNumeric('size', e.target.value)} /></label></div>
                    <label className="text-sm">Font<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.fontFamily} onChange={(e) => {
                      const nextFontFamily = e.target.value;
                      applyToSelected((layer) => layer.kind === 'text' ? ({ fontFamily: nextFontFamily } as Partial<Layer>) : ({}));
                      ensureFontLoaded(nextFontFamily, selectedPrimary.size);
                    }}>{FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
                    <p className="text-xs text-slate-500">Font load: {fontStatusByFamily[selectedPrimary.fontFamily] ?? 'ready'}</p>
                    <div className="flex gap-2 text-xs"><button className={`rounded border px-2 py-1 ${selectedPrimary.textAlign === 'left' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'text' ? ({ textAlign: 'left' } as Partial<Layer>) : ({}))}>Left</button><button className={`rounded border px-2 py-1 ${selectedPrimary.textAlign === 'center' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'text' ? ({ textAlign: 'center' } as Partial<Layer>) : ({}))}>Center</button><button className={`rounded border px-2 py-1 ${selectedPrimary.textAlign === 'right' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'text' ? ({ textAlign: 'right' } as Partial<Layer>) : ({}))}>Right</button></div>
                    <div className="flex gap-2 text-xs"><button className={`rounded border px-2 py-1 ${selectedPrimary.textMode === 'point' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'text' ? ({ textMode: 'point' } as Partial<Layer>) : ({}))}>Point Text</button><button className={`rounded border px-2 py-1 ${selectedPrimary.textMode === 'area' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => applyToSelected((layer) => layer.kind === 'text' ? ({ textMode: 'area', width: 500, height: selectedPrimary.size * 1.2 } as unknown as Partial<Layer>) : ({}))}>Area Text</button></div>
                  </div>
                </>
              )}

              <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                <div className="flex items-center justify-between"><h4 className="font-semibold">Transform</h4><button className="text-sm text-blue-300" onClick={resetSelectedTransform}>Reset</button></div>
                <div className="grid grid-cols-3 gap-1">{[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y }))).map((pt) => <button key={`${pt.x}-${pt.y}`} className="rounded border border-slate-700 py-1 text-xs" onClick={() => setAnchorPreset(pt.x, pt.y)}>•</button>)}</div>
                <div className="grid grid-cols-2 gap-2"><label className="text-sm">Anchor X<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).anchorX} onChange={(e) => setNumeric('anchorX', e.target.value)} /></label><label className="text-sm">Anchor Y<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).anchorY} onChange={(e) => setNumeric('anchorY', e.target.value)} /></label><label className="text-sm">Position X<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.x} onChange={(e) => setNumeric('x', e.target.value)} /></label><label className="text-sm">Position Y<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.y} onChange={(e) => setNumeric('y', e.target.value)} /></label></div>{selectedPrimary.kind === "shape" && selectedPrimary.shapeType === "rectangle" && <div className="grid grid-cols-2 gap-2"><label className="text-sm">Width<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.width} onChange={(e) => setNumeric('width', e.target.value)} /></label><label className="text-sm">Height<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.height} onChange={(e) => setNumeric('height', e.target.value)} /></label></div>}
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2"><label className="text-sm">Scale X<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).scaleX} onChange={(e) => updateScale('x', e.target.value)} /></label><button className={`rounded border px-2 py-2 ${lockScale ? 'border-blue-500 text-blue-300' : 'border-slate-700 text-slate-300'}`} onClick={() => setLockScale((v) => !v)}>{lockScale ? '🔗' : '⛓'}</button><label className="text-sm">Scale Y<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).scaleY} onChange={(e) => updateScale('y', e.target.value)} /></label></div>
                <label className="block text-xs text-slate-300">Scale Slider<input className="mt-1 w-full" type="range" min={1} max={300} value={Math.round(getTransform(selectedPrimary).scaleX)} onChange={(e) => updateScale('x', e.target.value)} /></label>
                <div className="grid grid-cols-2 gap-2"><label className="text-sm">Rotation<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).rotation} onChange={(e) => setNumeric('rotation', e.target.value)} /></label><label className="text-sm">Opacity<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" min={0} max={100} value={selectedPrimary.opacity} onChange={(e) => setNumeric('opacity', e.target.value)} /></label></div>
                <label className="block text-xs text-slate-300">Opacity Slider<input className="mt-1 w-full" type="range" min={0} max={100} value={Math.round(selectedPrimary.opacity)} onChange={(e) => setNumeric('opacity', e.target.value)} /></label>
              </div>
            </div>
          )}
          </div>
        </aside>
      </section>

    </section>
  );
}
