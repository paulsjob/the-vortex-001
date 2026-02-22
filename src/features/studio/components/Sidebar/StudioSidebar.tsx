import { useAssetStore } from '../../../../store/useAssetStore';
import { useLayerStore } from '../../../../store/useLayerStore';
import { useStudioStore } from '../../../../store/useStudioStore';

export function StudioSidebar() {
  const { addText, addShape, addAssetLayer, layers } = useLayerStore();
  const { interactionMode, setInteractionMode, sidebarTab, setSidebarTab, selectedLayerId, setSelectedLayerId } = useStudioStore();
  const assets = useAssetStore((s) => s.assets);

  const parseDimensions = (dimension?: string) => {
    if (!dimension) return undefined;
    const [width, height] = dimension.split('x').map(Number);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
    return { width, height };
  };

  return (
    <aside className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Stage Pro</h3>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <button className="rounded bg-blue-700 px-2 py-2" onClick={addText}>Text</button>
        <button className="rounded bg-blue-700 px-2 py-2" onClick={addShape}>Shape</button>
        <button className="rounded bg-slate-700 px-2 py-2">Figma</button>
        <button className="rounded bg-slate-700 px-2 py-2">Rive</button>
      </div>
      <div className="mb-3 flex gap-2 rounded-lg bg-slate-800 p-1">
        <button onClick={() => setInteractionMode('select')} className={`flex-1 rounded px-2 py-1 ${interactionMode === 'select' ? 'bg-blue-700' : ''}`}>Select</button>
        <button onClick={() => setInteractionMode('pan')} className={`flex-1 rounded px-2 py-1 ${interactionMode === 'pan' ? 'bg-blue-700' : ''}`}>Pan</button>
      </div>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setSidebarTab('layers')} className={`flex-1 rounded px-2 py-1 ${sidebarTab === 'layers' ? 'bg-slate-700' : 'bg-slate-800'}`}>Layers</button>
        <button onClick={() => setSidebarTab('assets')} className={`flex-1 rounded px-2 py-1 ${sidebarTab === 'assets' ? 'bg-slate-700' : 'bg-slate-800'}`}>Assets</button>
      </div>
      {sidebarTab === 'layers' ? (
        <div className="space-y-2">
          {layers.map((l) => (
            <button key={l.id} onClick={() => setSelectedLayerId(l.id)} className={`block w-full rounded border px-2 py-2 text-left ${selectedLayerId === l.id ? 'border-blue-500 bg-slate-800' : 'border-slate-700 bg-slate-900'}`}>{l.name}</button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <button key={a.id} onClick={() => addAssetLayer(a.id, parseDimensions(a.dimension))} className="block w-full rounded border border-slate-700 bg-slate-900 px-2 py-2 text-left">{a.name}</button>
          ))}
          {!assets.length && <p className="text-sm text-slate-400">Upload from Dashboard library to use assets here.</p>}
        </div>
      )}
    </aside>
  );
}
