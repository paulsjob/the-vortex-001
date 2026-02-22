import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useAssetStore } from '../store/useAssetStore';
import { useLayerStore } from '../store/useLayerStore';
import { useTemplateStore } from '../store/useTemplateStore';
import type { ExplorerNode, Layer } from '../types/domain';

const TEMPLATE_SIZES = [
  { value: '1920x1080', label: '1920 × 1080' },
  { value: '1080x1920', label: '1080 × 1920' },
  { value: '1080x1350', label: '1080 × 1350' },
  { value: '1080x1080', label: '1080 × 1080' },
];

const FONT_OPTIONS = ['Inter', 'Arial', 'Helvetica', 'Roboto', 'Montserrat', 'Oswald', 'Georgia', 'Times New Roman'];
const DATA_FIELDS = ['score.home', 'score.away', 'clock.period', 'clock.time', 'team.home.name', 'team.away.name', 'headline', 'subhead'];
const transformDefaults = { anchorX: 0, anchorY: 0, scaleX: 100, scaleY: 100, rotation: 0 };

export function DesignRoute() {
  const assetStore = useAssetStore();
  const {
    layers,
    canvasWidth,
    canvasHeight,
    addText,
    addAssetLayer,
    setCanvasSize,
    setZOrder,
    deleteLayer,
    renameLayer,
    updateLayer,
  } = useLayerStore();
  const templateStore = useTemplateStore();

  const [folderId, setFolderId] = useState(assetStore.brandedExplorer.rootId);
  const [search, setSearch] = useState('');
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [editingLayerValue, setEditingLayerValue] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [lastClickedLayerId, setLastClickedLayerId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [lockScale, setLockScale] = useState(true);
  const [alignScope, setAlignScope] = useState<'selection' | 'canvas'>('selection');

  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; base: Map<string, { x: number; y: number }> } | null>(null);

  const assetById = useMemo(() => new Map(assetStore.assets.map((a) => [a.id, a])), [assetStore.assets]);
  const layerById = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const orderedLayers = useMemo(() => [...layers].sort((a, b) => b.zIndex - a.zIndex), [layers]);
  const selectedLayers = useMemo(() => selectedLayerIds.map((id) => layerById.get(id)).filter(Boolean) as Layer[], [selectedLayerIds, layerById]);
  const selectedPrimary = selectedLayers[0] || null;

  useEffect(() => {
    if (!selectedLayerIds.length && orderedLayers.length) {
      setSelectedLayerIds([orderedLayers[0].id]);
      setLastClickedLayerId(orderedLayers[0].id);
    }
    setSelectedLayerIds((ids) => ids.filter((id) => layerById.has(id)));
  }, [orderedLayers, selectedLayerIds.length, layerById]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (!selectedLayerIds.length) return;
      const step = event.shiftKey ? 10 : 1;
      const patches: Record<string, Partial<Layer>> = {};
      if (event.key === 'ArrowLeft') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l) patches[id] = { x: l.x - step }; });
      if (event.key === 'ArrowRight') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l) patches[id] = { x: l.x + step }; });
      if (event.key === 'ArrowUp') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l) patches[id] = { y: l.y - step }; });
      if (event.key === 'ArrowDown') selectedLayerIds.forEach((id) => { const l = layerById.get(id); if (l) patches[id] = { y: l.y + step }; });
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

  const getTransform = (layer: Layer) => ({
    anchorX: layer.anchorX ?? 0,
    anchorY: layer.anchorY ?? 0,
    scaleX: layer.scaleX ?? 100,
    scaleY: layer.scaleY ?? 100,
    rotation: layer.rotation ?? 0,
  });

  const getLayerBounds = (layer: Layer) => {
    if (layer.kind === 'asset' || layer.kind === 'shape') return { width: layer.width, height: layer.height };
    return { width: Math.max(24, layer.text.length * layer.size * 0.6), height: layer.size * 1.2 };
  };

  const applyToSelected = (patchFactory: (layer: Layer) => Partial<Layer>) => {
    selectedLayerIds.forEach((id) => {
      const layer = layerById.get(id);
      if (layer) updateLayer(id, patchFactory(layer));
    });
  };

  const setNumeric = (key: keyof Layer, value: string) => {
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

  const insertSelectedAsset = () => {
    const candidate = selectedAssetId || (files[0]?.type === 'file' ? files[0].id : null);
    if (candidate) addAssetLayer(candidate);
  };

  const alignLayers = (mode: 'left' | 'center' | 'right') => {
    if (!selectedLayers.length) return;
    const targetLayers = selectedLayers;
    const layerRects = targetLayers.map((l) => ({ layer: l, ...getLayerBounds(l) }));
    const minX = Math.min(...layerRects.map((r) => r.layer.x - (r.layer.anchorX ?? 0)));
    const maxX = Math.max(...layerRects.map((r) => r.layer.x - (r.layer.anchorX ?? 0) + r.width));
    const scopeLeft = alignScope === 'canvas' ? 0 : minX;
    const scopeRight = alignScope === 'canvas' ? canvasWidth : maxX;
    layerRects.forEach(({ layer, width }) => {
      const anchorX = layer.anchorX ?? 0;
      if (mode === 'left') updateLayer(layer.id, { x: scopeLeft + anchorX });
      if (mode === 'center') updateLayer(layer.id, { x: scopeLeft + ((scopeRight - scopeLeft - width) / 2) + anchorX });
      if (mode === 'right') updateLayer(layer.id, { x: scopeRight - width + anchorX });
    });
  };

  const distributeLayers = (axis: 'x' | 'y') => {
    if (selectedLayers.length < 3) return;
    const sorted = [...selectedLayers].sort((a, b) => (axis === 'x' ? a.x - b.x : a.y - b.y));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const totalDistance = axis === 'x' ? (last.x - first.x) : (last.y - first.y);
    const step = totalDistance / (sorted.length - 1);
    sorted.forEach((layer, i) => {
      if (layer.id === first.id || layer.id === last.id) return;
      if (axis === 'x') updateLayer(layer.id, { x: Math.round(first.x + step * i) });
      else updateLayer(layer.id, { y: Math.round(first.y + step * i) });
    });
  };

  const selectLayer = (layerId: string, event?: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) => {
    const additive = !!event?.metaKey || !!event?.ctrlKey;
    const range = !!event?.shiftKey;
    if (range && lastClickedLayerId) {
      const ids = orderedLayers.map((l) => l.id);
      const a = ids.indexOf(lastClickedLayerId);
      const b = ids.indexOf(layerId);
      const [start, end] = a < b ? [a, b] : [b, a];
      const rangeIds = ids.slice(start, end + 1);
      setSelectedLayerIds((prev) => [...new Set([...prev, ...rangeIds])]);
      return;
    }
    if (additive) {
      setSelectedLayerIds((prev) => prev.includes(layerId) ? prev.filter((id) => id !== layerId) : [...prev, layerId]);
      setLastClickedLayerId(layerId);
      return;
    }
    setSelectedLayerIds([layerId]);
    setLastClickedLayerId(layerId);
  };

  const onLayerMouseDown = (layer: Layer, event: MouseEvent) => {
    selectLayer(layer.id, event);
    if (event.button !== 0) return;
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const base = new Map<string, { x: number; y: number }>();
    const activeIds = (event.metaKey || event.ctrlKey) ? (selectedLayerIds.includes(layer.id) ? selectedLayerIds : [...selectedLayerIds, layer.id]) : [layer.id];
    activeIds.forEach((id) => {
      const l = layerById.get(id);
      if (l) base.set(id, { x: l.x, y: l.y });
    });
    dragRef.current = { startX: event.clientX, startY: event.clientY, base };
    const onMove = (move: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ((move.clientX - dragRef.current.startX) / rect.width) * canvasWidth;
      const dy = ((move.clientY - dragRef.current.startY) / rect.height) * canvasHeight;
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
          <button onClick={() => setFolderId(id)} className={`w-full rounded border px-2 py-1 text-left ${folderId === id ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`}>{node.name}</button>
        </div>
        {isOpen && children.map((child) => renderFolderTree(child.id, depth + 1))}
      </div>
    );
  };

  const renderLayerPreview = (layer: Layer) => {
    const transform = getTransform(layer);
    const bounds = getLayerBounds(layer);
    const left = ((layer.x - transform.anchorX) / canvasWidth) * 100;
    const top = ((layer.y - transform.anchorY) / canvasHeight) * 100;
    const baseStyle = {
      left: `${left}%`,
      top: `${top}%`,
      opacity: layer.opacity / 100,
      transformOrigin: `${transform.anchorX}px ${transform.anchorY}px`,
      transform: `scale(${transform.scaleX / 100}, ${transform.scaleY / 100}) rotate(${transform.rotation}deg)`,
      width: `${(bounds.width / canvasWidth) * 100}%`,
      height: `${(bounds.height / canvasHeight) * 100}%`,
    };

    return (
      <div
        key={layer.id}
        className={`absolute select-none ${selectedLayerIds.includes(layer.id) ? 'outline outline-2 outline-blue-400' : 'outline outline-1 outline-slate-500/50'}`}
        style={baseStyle}
        onMouseDown={(event) => onLayerMouseDown(layer, event)}
      >
        {layer.kind === 'asset' && (
          <img src={assetById.get(layer.assetId)?.src} alt={assetById.get(layer.assetId)?.name || layer.name} className="h-full w-full object-fill" draggable={false} />
        )}
        {layer.kind === 'text' && (
          <div className="h-full w-full overflow-visible" style={{ fontSize: `${layer.size / 2}px`, color: layer.color, fontWeight: 700, fontFamily: layer.fontFamily }}>{layer.text}</div>
        )}
        {layer.kind === 'shape' && <div className="h-full w-full" style={{ background: layer.fill }} />}
        <div className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-400" style={{ left: `${(transform.anchorX / bounds.width) * 100}%`, top: `${(transform.anchorY / bounds.height) * 100}%` }} />
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 xl:grid-cols-[320px_1fr_360px]">
        <aside className="rounded-lg border border-slate-700 bg-slate-950 p-3">
          <div className="mb-3 flex items-start justify-between gap-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Layer Stack</h3>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <button className="rounded border border-slate-600 bg-slate-800 px-2 py-1" onClick={() => { const name = window.prompt('Template name', `Template ${Date.now()}`)?.trim(); if (name) templateStore.saveTemplate({ name, folderId: templateStore.rootId, canvasWidth, canvasHeight, layers }); }}>+New</button>
              <button className="rounded border border-slate-600 bg-slate-800 px-2 py-1" onClick={() => { const name = window.prompt('Save template as', `Saved ${Date.now()}`)?.trim(); if (name) templateStore.saveTemplate({ name, folderId: templateStore.rootId, canvasWidth, canvasHeight, layers }); }}>Save</button>
              <button className="rounded border border-slate-600 bg-slate-800 px-2 py-1" onClick={insertSelectedAsset}>+Asset</button>
              <button className="rounded border border-slate-600 bg-slate-800 px-2 py-1" onClick={addText}>+Text</button>
            </div>
          </div>

          <label className="mb-2 block text-sm">Template Size
            <select className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-2" value={`${canvasWidth}x${canvasHeight}`} onChange={(e) => { const [w, h] = e.target.value.split('x').map(Number); setCanvasSize(w, h); }}>
              {TEMPLATE_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>

          <div className="mb-2 flex gap-2 text-xs">
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('left')}>Align Left</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('center')}>Align Center</button>
            <button className="rounded border border-slate-700 px-2 py-1" onClick={() => alignLayers('right')}>Align Right</button>
          </div>
          {selectedLayerIds.length > 1 && (
            <div className="mb-3 space-y-2 rounded border border-slate-700 p-2 text-xs">
              <div className="flex gap-2">
                <button className={`rounded border px-2 py-1 ${alignScope === 'selection' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setAlignScope('selection')}>Selection</button>
                <button className={`rounded border px-2 py-1 ${alignScope === 'canvas' ? 'border-blue-500 text-blue-300' : 'border-slate-700'}`} onClick={() => setAlignScope('canvas')}>Canvas</button>
              </div>
              <div className="flex gap-2">
                <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeLayers('x')}>Distribute H</button>
                <button className="rounded border border-slate-700 px-2 py-1" onClick={() => distributeLayers('y')}>Distribute V</button>
              </div>
            </div>
          )}

          {!orderedLayers.length ? <p className="text-slate-400">No layers yet.</p> : (
            <div className="space-y-2">
              {orderedLayers.map((layer) => {
                const isCollapsed = !!collapsed[layer.id];
                const assetName = layer.kind === 'asset' ? assetById.get(layer.assetId)?.name || 'Asset' : null;
                const isSelected = selectedLayerIds.includes(layer.id);
                return (
                  <div key={layer.id} className={`rounded border p-2 ${isSelected ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`} onClick={(event) => selectLayer(layer.id, event)}>
                    <div className="flex items-center gap-2">
                      <button className="rounded border border-slate-700 px-2" onClick={(event) => { event.stopPropagation(); setCollapsed((s) => ({ ...s, [layer.id]: !s[layer.id] })); }}>{isCollapsed ? '▸' : '▾'}</button>
                      {editingLayerId === layer.id ? (
                        <input className="flex-1 rounded border border-blue-500 bg-slate-950 px-2 py-1" value={editingLayerValue} onChange={(e) => setEditingLayerValue(e.target.value)} onClick={(event) => event.stopPropagation()} onBlur={() => { renameLayer(layer.id, editingLayerValue.trim() || layer.name); setEditingLayerId(null); setEditingLayerValue(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { renameLayer(layer.id, editingLayerValue.trim() || layer.name); setEditingLayerId(null); setEditingLayerValue(''); } }} autoFocus />
                      ) : (
                        <strong className="flex-1" onDoubleClick={() => { setEditingLayerId(layer.id); setEditingLayerValue(layer.name); }}>{layer.name}{assetName ? ` · ${assetName}` : ''}</strong>
                      )}
                      <button className="rounded border border-slate-600 px-2" onClick={(event) => { event.stopPropagation(); setZOrder(layer.id, 'up'); }}>↑</button>
                      <button className="rounded border border-slate-600 px-2" onClick={(event) => { event.stopPropagation(); setZOrder(layer.id, 'down'); }}>↓</button>
                      <button className="rounded border border-red-700 px-2 text-red-300" title="Delete" onClick={(event) => { event.stopPropagation(); deleteLayer(layer.id); }}>🗑</button>
                    </div>
                    {!isCollapsed && layer.kind === 'text' && <div className="mt-2 text-sm text-slate-400">{layer.text}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </aside>

        <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">Canvas · {canvasWidth} × {canvasHeight}</h3>
          <div className="grid max-h-[72vh] min-h-[420px] place-items-center overflow-auto rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div ref={stageRef} className="relative overflow-hidden rounded border border-slate-700 bg-slate-900 shadow-2xl" style={{ aspectRatio: `${canvasWidth}/${canvasHeight}`, width: `min(100%, calc((72vh - 2rem) * ${canvasWidth / canvasHeight}))` }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLayerIds([]); }}>
              {!orderedLayers.length ? <p className="absolute inset-0 grid place-items-center text-xl text-slate-400">Stage is blank.</p> : orderedLayers.map(renderLayerPreview)}
            </div>
          </div>
        </div>

        <aside className="rounded-lg border border-slate-700 bg-slate-950 p-3">
          <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Layer Inspector</h3>
          {!selectedPrimary ? <p className="text-slate-400">Select a layer to edit.</p> : (
            <div className="space-y-3">
              <div className="rounded border border-slate-700 bg-slate-900 p-2">
                <div className="mb-1 text-xs uppercase text-slate-400">Selected ({selectedLayerIds.length})</div>
                <strong>{selectedPrimary.name}</strong>
              </div>

              {selectedPrimary.kind === 'text' && (
                <>
                  <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                    <h4 className="font-semibold">Text</h4>
                    <label className="block text-sm">Content
                      <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.text} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ text: e.target.value } as Partial<Layer>) : ({}))} />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-sm">Color
                        <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="color" value={selectedPrimary.color} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ color: e.target.value } as Partial<Layer>) : ({}))} />
                      </label>
                      <label className="text-sm">Size
                        <input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.size} onChange={(e) => setNumeric('size', e.target.value)} />
                      </label>
                    </div>
                    <label className="text-sm">Font
                      <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.fontFamily} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ fontFamily: e.target.value } as Partial<Layer>) : ({}))}>
                        {FONT_OPTIONS.map((font) => <option key={font} value={font}>{font}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                    <h4 className="font-semibold">Data Binding</h4>
                    <label className="text-sm">Source
                      <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.dataBindingSource} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ dataBindingSource: e.target.value } as Partial<Layer>) : ({}))}>
                        <option value="manual">Manual</option>
                        <option value="live-feed">Live Feed</option>
                        <option value="game-state">Game State</option>
                        <option value="stats-service">Stats Service</option>
                      </select>
                    </label>
                    <label className="text-sm">Field
                      <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" value={selectedPrimary.dataBindingField} onChange={(e) => applyToSelected((layer) => layer.kind === 'text' ? ({ dataBindingField: e.target.value } as Partial<Layer>) : ({}))}>
                        <option value="">Choose field…</option>
                        {DATA_FIELDS.map((field) => <option key={field} value={field}>{field}</option>)}
                      </select>
                    </label>
                    <p className="text-xs text-slate-400">Bind once, then content updates from Data Engine without hand-editing every text layer.</p>
                  </div>
                </>
              )}

              <div className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Transform</h4>
                  <button className="text-sm text-blue-300" onClick={resetSelectedTransform}>Reset</button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y }))).map((pt) => (
                    <button key={`${pt.x}-${pt.y}`} className="rounded border border-slate-700 py-1 text-xs" onClick={() => setAnchorPreset(pt.x, pt.y)}>•</button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm">Anchor X<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).anchorX} onChange={(e) => setNumeric('anchorX', e.target.value)} /></label>
                  <label className="text-sm">Anchor Y<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).anchorY} onChange={(e) => setNumeric('anchorY', e.target.value)} /></label>
                  <label className="text-sm">Position X<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.x} onChange={(e) => setNumeric('x', e.target.value)} /></label>
                  <label className="text-sm">Position Y<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={selectedPrimary.y} onChange={(e) => setNumeric('y', e.target.value)} /></label>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <label className="text-sm">Scale X<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).scaleX} onChange={(e) => updateScale('x', e.target.value)} /></label>
                  <button className={`rounded border px-2 py-2 ${lockScale ? 'border-blue-500 text-blue-300' : 'border-slate-700 text-slate-300'}`} onClick={() => setLockScale((v) => !v)}>{lockScale ? '🔗' : '⛓'}</button>
                  <label className="text-sm">Scale Y<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).scaleY} onChange={(e) => updateScale('y', e.target.value)} /></label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-sm">Rotation<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" value={getTransform(selectedPrimary).rotation} onChange={(e) => setNumeric('rotation', e.target.value)} /></label>
                  <label className="text-sm">Opacity<input className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" type="number" min={0} max={100} value={selectedPrimary.opacity} onChange={(e) => setNumeric('opacity', e.target.value)} /></label>
                </div>
              </div>
            </div>
          )}
        </aside>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Branded Assets Locker</h3>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[280px_1fr]">
          <aside className="rounded-lg border border-slate-700 bg-slate-950 p-3">
            <h4 className="mb-2 text-xl font-bold">Folders</h4>
            {renderFolderTree(assetStore.brandedExplorer.rootId)}
          </aside>

          <div className="rounded-lg border border-slate-700 bg-slate-950 p-3">
            <div className="mb-3 flex flex-wrap gap-2">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets" className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2" />
              <button className="rounded bg-blue-700 px-3 py-2" onClick={() => { const name = window.prompt('Name this new folder')?.trim(); if (name) assetStore.addFolder(name, folderId, 'branded'); }}>Create Folder</button>
              <button className="rounded bg-slate-700 px-3 py-2" onClick={() => assetStore.deleteFolder(folderId, 'branded')}>Delete Folder</button>
              <label className="cursor-pointer rounded bg-blue-700 px-3 py-2">Upload
                <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" multiple className="hidden" onChange={async (event) => { const upload = Array.from(event.target.files || []); if (upload.length) await assetStore.uploadFiles(upload, folderId, 'branded'); event.currentTarget.value = ''; }} />
              </label>
              <button className="rounded bg-emerald-700 px-3 py-2" onClick={insertSelectedAsset}>Insert Selected in Canvas</button>
            </div>

            <div className="grid grid-cols-4 text-slate-400"><span>NAME</span><span>TYPE</span><span>DIMENSION</span><span>MODIFIED</span></div>
            <div className="mt-2 space-y-2">
              {filtered.map((item) => (
                <button key={item.id} className={`grid w-full grid-cols-4 rounded border p-2 text-left text-sm ${selectedAssetId === item.id ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`} onClick={() => { if (item.type === 'folder') setFolderId(item.id); if (item.type === 'file') setSelectedAssetId(item.id); }}>
                  <span className="flex items-center gap-2">{item.type === 'folder' ? '📁' : <img src={item.src} alt={item.name} className="h-8 w-8 rounded object-cover" />} {item.name}</span>
                  <span>{item.type === 'folder' ? 'Folder' : 'File'}</span>
                  <span>{item.type === 'folder' ? `${item.children.length} item(s)` : item.dimension}</span>
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                </button>
              ))}
              {!filtered.length && <p className="text-slate-500">No matching assets in this folder.</p>}
            </div>
          </div>
        </div>
      </section>
    </section>
  );
}
