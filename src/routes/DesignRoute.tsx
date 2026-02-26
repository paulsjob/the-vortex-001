import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useAssetStore } from '../store/useAssetStore';
import { useDataEngineStore } from '../store/useDataEngineStore';
import { useLayerStore } from '../store/useLayerStore';
import { useTemplateStore } from '../store/useTemplateStore';
import type { ExplorerNode, Layer } from '../types/domain';
import { getLiveTextContent } from '../features/playout/liveBindings';
import { buildTemplateFeedUrl } from '../features/playout/publicUrl';

const TEMPLATE_SIZES = [
  { value: '1920x1080', label: '1920 × 1080' },
  { value: '1080x1920', label: '1080 × 1920' },
  { value: '1080x1350', label: '1080 × 1350' },
  { value: '1080x1080', label: '1080 × 1080' },
];

const FONT_OPTIONS = ['Inter', 'Arial', 'Helvetica', 'Roboto', 'Montserrat', 'Oswald', 'Georgia', 'Times New Roman'];
const DATA_FIELDS = ['score.home', 'score.away', 'inning.number', 'inning.state', 'count.balls', 'count.strikes', 'count.outs', 'runners.first', 'runners.second', 'runners.third', 'pitch.type', 'pitch.velocity', 'pitch.location', 'bat.batspeed', 'bat.exitvelo', 'bat.launchangle', 'bat.distance', 'matchup.pitcher', 'matchup.batter'];
const transformDefaults = { anchorX: 0, anchorY: 0, scaleX: 100, scaleY: 100, rotation: 0 };

export function DesignRoute() {
  const assetStore = useAssetStore();
  const templateStore = useTemplateStore();
  const engineGame = useDataEngineStore((s) => s.game);
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
  } = useLayerStore();

  const [folderId, setFolderId] = useState(assetStore.brandedExplorer.rootId);
  const [search, setSearch] = useState('');
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

  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; base: Map<string, { x: number; y: number }> } | null>(null);
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const assetById = useMemo(() => new Map(assetStore.assets.map((a) => [a.id, a])), [assetStore.assets]);
  const layerById = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const stackLayers = useMemo(() => [...layers].sort((a, b) => b.zIndex - a.zIndex), [layers]);
  const canvasLayers = useMemo(() => [...layers].filter((layer) => layer.visible !== false).sort((a, b) => a.zIndex - b.zIndex), [layers]);
  const selectedLayers = useMemo(() => selectedLayerIds.map((id) => layerById.get(id)).filter(Boolean) as Layer[], [selectedLayerIds, layerById]);
  const selectedPrimary = selectedLayers[0] || null;
  const loadedTemplate = useMemo(() => (loadedTemplateId ? templateStore.getTemplateById(loadedTemplateId) : undefined), [loadedTemplateId, templateStore.templates]);


  useEffect(() => {
    if (!measureCtxRef.current) {
      const canvas = document.createElement('canvas');
      measureCtxRef.current = canvas.getContext('2d');
    }
  }, []);


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
    if (!selectedLayerIds.length && stackLayers.length) {
      setSelectedLayerIds([stackLayers[0].id]);
      setLastClickedLayerId(stackLayers[0].id);
    }
    setSelectedLayerIds((ids) => ids.filter((id) => layerById.has(id)));
  }, [stackLayers, selectedLayerIds.length, layerById]);


  useEffect(() => {
    if (!keyObjectId || !selectedLayerIds.includes(keyObjectId)) {
      setKeyObjectId(selectedLayerIds[0] ?? null);
    }
  }, [selectedLayerIds, keyObjectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
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
  }, [selectedLayerIds, layerById, updateLayer]);

  const getNode = (id: string) => assetStore.brandedExplorer.nodes.find((n) => n.id === id);
  const folderChildren = useMemo(() => {
    const folder = getNode(folderId);
    if (!folder || folder.type !== 'folder') return [];
    return folder.children.map(getNode).filter(Boolean) as ExplorerNode[];
  }, [folderId, assetStore.brandedExplorer]);
  const files = folderChildren.filter((n) => n.type === 'file');
  const filtered = folderChildren.filter((n) => n.name.toLowerCase().includes(search.toLowerCase()));

  const getTextContent = (layer: Extract<Layer, { kind: 'text' }>) => getLiveTextContent(layer, engineGame);

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
    } catch {
      setSaveNotice(`Template URL: ${url}`);
    }
  };

  const exportTemplateImage = async (format: 'jpg' | 'png' | 'png-green') => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (format === 'jpg') {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (format === 'png-green') {
      ctx.fillStyle = '#00b140';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const sorted = [...layers].filter((layer) => layer.visible !== false).sort((a, b) => a.zIndex - b.zIndex);
    for (const layer of sorted) {
      ctx.save();
      ctx.globalAlpha = layer.opacity / 100;
      if (layer.kind === 'shape') {
        ctx.fillStyle = layer.fill;
        if (layer.shapeType === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(layer.x + layer.width / 2, layer.y + layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(layer.x, layer.y, layer.width, layer.height);
        }
      } else if (layer.kind === 'asset') {
        const src = assetById.get(layer.assetId)?.src;
        if (src) {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const el = new Image();
            el.onload = () => resolve(el);
            el.onerror = reject;
            el.src = src;
          });
          ctx.drawImage(img, layer.x, layer.y, layer.width, layer.height);
        }
      } else {
        ctx.fillStyle = layer.color;
        ctx.font = `700 ${layer.size}px ${layer.fontFamily}`;
        ctx.textAlign = layer.textAlign;
        ctx.textBaseline = 'top';
        ctx.fillText(getTextContent(layer), layer.x, layer.y);
      }
      ctx.restore();
    }
    const mime = format === 'jpg' ? 'image/jpeg' : 'image/png';
    const url = canvas.toDataURL(mime, 0.92);
    const a = document.createElement('a');
    const safeName = (templateName || loadedTemplate?.name || 'template').replace(/\s+/g, '-').toLowerCase();
    a.href = url;
    a.download = `${safeName}.${format === 'jpg' ? 'jpg' : 'png'}`;
    a.click();
    setSaveNotice(`Exported ${format.toUpperCase()}.`);
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
    const range = !!event?.shiftKey;
    if (range && lastClickedLayerId) {
      const ids = stackLayers.map((l) => l.id);
      const a = ids.indexOf(lastClickedLayerId);
      const b = ids.indexOf(layerId);
      const [start, end] = a < b ? [a, b] : [b, a];
      setSelectedLayerIds((prev) => [...new Set([...prev, ...ids.slice(start, end + 1)])]);
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

  const onLayerMouseDown = (layer: Layer, event: ReactMouseEvent) => {
    selectLayer(layer.id, event);
    if (event.button !== 0 || layer.locked) return;
    const stage = stageRef.current;
    if (!stage) return;
    const base = new Map<string, { x: number; y: number }>();
    const activeIds = (event.metaKey || event.ctrlKey) ? (selectedLayerIds.includes(layer.id) ? selectedLayerIds : [...selectedLayerIds, layer.id]) : [layer.id];
    activeIds.forEach((id) => {
      const l = layerById.get(id);
      if (l && !l.locked) base.set(id, { x: l.x, y: l.y });
    });
    dragRef.current = { startX: event.clientX, startY: event.clientY, base };
    const onMove = (move: globalThis.MouseEvent) => {
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
        updateLayer(id, { x: Math.round(start.x + dx), y: Math.round(start.y + dy) });
      });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const getLayerRect = (layer: Layer) => {
    const { width, height } = getLayerBounds(layer);
    const left = layer.kind === 'shape' ? layer.x : (layer.x - (layer.anchorX ?? 0));
    const top = layer.kind === 'shape' ? layer.y : (layer.y - (layer.anchorY ?? 0));
    return { layer, width, height, left, top, right: left + width, bottom: top + height, centerX: left + width / 2, centerY: top + height / 2 };
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


  const stageScale = useMemo(() => {
    const safeW = Math.max(1, stageViewport.width);
    const safeH = Math.max(1, stageViewport.height);
    return Math.max(0.01, Math.min(safeW / canvasWidth, safeH / canvasHeight));
  }, [stageViewport]);

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
      <div key={layer.id} className={`absolute select-none ${selectedLayerIds.includes(layer.id) ? 'outline outline-2 outline-blue-400' : 'outline outline-1 outline-slate-500/40'} ${layer.locked ? 'cursor-not-allowed' : 'cursor-move'}`} style={style} onMouseDown={(event) => onLayerMouseDown(layer, event)}>
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
            <div className="h-full w-full" onDoubleClick={(e) => { e.stopPropagation(); startStageTextEdit(layer); }} style={{ fontSize: `${layer.size}px`, color: layer.color, fontWeight: 700, fontFamily: layer.fontFamily, textAlign: layer.textAlign, lineHeight: 1.15, whiteSpace: layer.textMode === 'point' ? 'pre' : 'pre-wrap', overflow: layer.textMode === 'point' ? 'visible' : 'hidden' }}>{getTextContent(layer)}</div>
          )
        )}
        <div className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400" style={{ left: `${(transform.anchorX / bounds.width) * 100}%`, top: `${(transform.anchorY / bounds.height) * 100}%` }} />
      </div>
    );
  };

  return (
    <section className="h-[calc(100vh-120px)] min-h-[640px]">
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
          {!stackLayers.length ? <p className="text-slate-400">No layers yet.</p> : <div className="space-y-2">{stackLayers.map((layer) => (
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
                <div className="rounded border border-zinc-700 bg-zinc-900 p-3">
                  <div className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Folders</div>
                  {renderFolderTree(assetStore.brandedExplorer.rootId)}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {filtered.filter((item) => item.type === 'file').map((item) => {
                    const dims = parseAssetDimensions(item.dimension);
                    return (
                      <button key={item.id} className="rounded border border-zinc-700 bg-zinc-900 p-1 text-left" onClick={() => addAssetLayer(item.id, dims ?? undefined)}>
                        <img src={item.src} alt={item.name} className="mb-1 h-20 w-full rounded object-cover" />
                        <span className="block truncate text-xs text-zinc-300">{item.name}</span>
                      </button>
                    );
                  })}
                  {!filtered.some((item) => item.type === 'file') && <p className="text-sm text-zinc-500">No files in this folder.</p>}
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="flex min-h-0 flex-col gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Canvas · {canvasWidth} × {canvasHeight}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" placeholder="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
              <select className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs" value={`${canvasWidth}x${canvasHeight}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); setCanvasSize(w, h); }}>
                {TEMPLATE_SIZES.map((size) => <option key={size.value} value={size.value}>{size.label}</option>)}
              </select>
              <button className="rounded bg-blue-700 px-3 py-1 text-xs font-semibold" onClick={() => saveCurrentTemplate('new')}>Save Template</button>
              <button className="rounded border border-blue-700 px-3 py-1 text-xs font-semibold text-blue-300 disabled:opacity-50" disabled={!loadedTemplateId} onClick={() => saveCurrentTemplate('update')}>Update</button>
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
          <div className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-2 text-xs">
            <span className="font-semibold uppercase tracking-wider text-slate-400">Export</span>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => exportTemplateImage('jpg')}>Export JPG</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => exportTemplateImage('png')}>Export PNG α</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => exportTemplateImage('png-green')}>Export PNG Green</button>
            <button className="rounded bg-emerald-700 px-3 py-1 font-semibold" onClick={copyTemplatePublicUrl}>Copy Public URL</button>
          </div>
          {saveNotice && <p className="rounded border border-emerald-700 bg-emerald-900/20 px-3 py-2 text-xs text-emerald-200">{saveNotice}</p>}
          <div ref={stageViewportRef} className="grid flex-1 min-h-0 place-items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-800 p-6">
            <div className="relative" style={{ width: `${canvasWidth * stageScale}px`, height: `${canvasHeight * stageScale}px` }}>
              <div ref={stageRef} className="relative overflow-hidden rounded border border-slate-500 bg-slate-900 shadow-[0_0_0_1px_rgba(148,163,184,0.25),0_20px_60px_rgba(0,0,0,0.45)]" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px`, transform: `scale(${stageScale})`, transformOrigin: 'top left' }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLayerIds([]); }}>
              {!canvasLayers.length ? <p className="absolute inset-0 grid place-items-center text-xl text-slate-400">Stage is blank.</p> : canvasLayers.map(renderLayerPreview)}
              </div>
            </div>
          </div>
        </div>

        <aside className="flex min-h-0 flex-col rounded-lg border border-slate-700 bg-slate-950 p-3">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Layer Inspector</h3>
          <div className="min-h-0 flex-1 overflow-auto pr-1">
          {!selectedPrimary ? <p className="text-slate-400">Select a layer to edit.</p> : (
            <div className="space-y-3">
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
                    <label className="text-sm">Field<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.dataBindingField} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ dataBindingField: e.target.value } as Partial<Layer>) : ({}))}><option value="">Choose field…</option>{DATA_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}</select></label>
                  </div>

                  <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                    <h4 className="font-semibold">Text</h4>
                    <label className="block text-sm">Content<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.text} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ text: e.target.value } as Partial<Layer>) : ({}))} /></label>
                    <div className="grid grid-cols-2 gap-2"><label className="text-sm">Color<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="color" value={selectedPrimary.color} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ color: e.target.value } as Partial<Layer>) : ({}))} /></label><label className="text-sm">Size<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.size} onChange={(e) => setNumeric('size', e.target.value)} /></label></div>
                    <label className="text-sm">Font<select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.fontFamily} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ fontFamily: e.target.value } as Partial<Layer>) : ({}))}>{FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}</select></label>
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
