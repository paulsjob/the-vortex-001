import { useLayerStore } from '../../../../store/useLayerStore';
import { useStudioStore } from '../../../../store/useStudioStore';

export function StageCanvas() {
  const { layers } = useLayerStore();
  const { canvasWidth, canvasHeight, selectedLayerId, setSelectedLayerId } = useStudioStore();
  const ordered = [...layers].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="flex items-center justify-center rounded-xl bg-slate-950 p-4">
      <div className="relative overflow-hidden bg-slate-900" style={{ width: '100%', aspectRatio: `${canvasWidth} / ${canvasHeight}` }}>
        {ordered.map((layer) => (
          <div
            key={layer.id}
            onClick={() => setSelectedLayerId(layer.id)}
            className={`absolute cursor-pointer ${selectedLayerId === layer.id ? 'ring-2 ring-blue-500' : ''}`}
            style={{ left: `${(layer.x / canvasWidth) * 100}%`, top: `${(layer.y / canvasHeight) * 100}%`, opacity: layer.opacity / 100 }}
          >
            {layer.kind === 'text' && <span style={{ color: layer.color, fontSize: `${layer.size / 2}px`, fontWeight: 700 }}>{layer.text}</span>}
            {layer.kind === 'shape' && <div style={{ width: `${layer.width / 2}px`, height: `${layer.height / 2}px`, background: layer.fill }} />}
            {layer.kind === 'asset' && <div className="h-16 w-32 bg-slate-700 text-xs text-slate-300">Asset: {layer.assetId}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
