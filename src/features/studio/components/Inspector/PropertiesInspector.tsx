import { useLayerStore } from '../../../../store/useLayerStore';
import { useStudioStore } from '../../../../store/useStudioStore';

export function PropertiesInspector() {
  const { selectedLayerId, setCanvasSize, canvasWidth, canvasHeight } = useStudioStore();
  const { layers, updateLayer, deleteLayer, setZOrder } = useLayerStore();
  const layer = layers.find((l) => l.id === selectedLayerId) || null;

  return (
    <aside className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Inspector</h3>
      <label className="mb-2 block text-sm">Canvas
        <select className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2" onChange={(e) => {
          const [w, h] = e.target.value.split('x').map(Number);
          setCanvasSize(w, h);
        }} value={`${canvasWidth}x${canvasHeight}`}>
          <option value="1920x1080">1920x1080</option>
          <option value="1080x1920">1080x1920</option>
          <option value="1080x1350">1080x1350</option>
          <option value="1080x1080">1080x1080</option>
        </select>
      </label>
      {!layer ? <p className="text-sm text-slate-400">Select a layer to edit properties.</p> : (
        <div className="space-y-2 text-sm">
          <input className="w-full rounded border border-slate-700 bg-slate-950 p-2" value={layer.name} onChange={(e) => updateLayer(layer.id, { name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" className="rounded border border-slate-700 bg-slate-950 p-2" value={layer.x} onChange={(e) => updateLayer(layer.id, { x: Number(e.target.value) })} />
            <input type="number" className="rounded border border-slate-700 bg-slate-950 p-2" value={layer.y} onChange={(e) => updateLayer(layer.id, { y: Number(e.target.value) })} />
          </div>
          {layer.kind === 'text' && <input className="w-full rounded border border-slate-700 bg-slate-950 p-2" value={layer.text} onChange={(e) => updateLayer(layer.id, { text: e.target.value } as any)} />}
          <div className="flex gap-2">
            <button className="rounded bg-slate-700 px-3 py-1" onClick={() => setZOrder(layer.id, 'down')}>Down</button>
            <button className="rounded bg-slate-700 px-3 py-1" onClick={() => setZOrder(layer.id, 'up')}>Up</button>
            <button className="ml-auto rounded bg-red-800 px-3 py-1" onClick={() => deleteLayer(layer.id)} title="Delete">🗑</button>
          </div>
        </div>
      )}
    </aside>
  );
}
