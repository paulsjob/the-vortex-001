import { useMemo } from 'react';
import { usePlayoutStore } from '../store/usePlayoutStore';
import { TemplatePreview } from '../features/playout/TemplatePreview';
import { buildOutputFeedUrl } from '../features/playout/publicUrl';

export function OutputRoute() {
  const programTemplate = usePlayoutStore((s) => s.programTemplate);
  const lastTakeAt = usePlayoutStore((s) => s.lastTakeAt);
  const clearProgram = usePlayoutStore((s) => s.clearProgram);


  const copyOutputUrl = async () => {
    if (!programTemplate) return;
    const url = buildOutputFeedUrl(window.location.origin, programTemplate);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy output URL', url);
    }
  };

  const summary = useMemo(() => {
    if (!programTemplate) return null;
    const textLayers = programTemplate.layers.filter((layer) => layer.kind === 'text').length;
    const assetLayers = programTemplate.layers.filter((layer) => layer.kind === 'asset').length;
    const shapeLayers = programTemplate.layers.filter((layer) => layer.kind === 'shape').length;
    return { textLayers, assetLayers, shapeLayers };
  }, [programTemplate]);

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Output Monitor (Client Feed)</h2>
          <p className="text-slate-400">This is the actual program output feed only.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded border border-emerald-700 px-3 py-1 text-xs text-emerald-300 disabled:opacity-50" onClick={copyOutputUrl} disabled={!programTemplate}>Copy Output URL</button>
          <button className="rounded border border-slate-700 px-3 py-1 text-xs text-slate-300" onClick={clearProgram}>Clear Output</button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm md:grid-cols-2">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">Program (Live)</p>
          <p className="font-semibold text-red-300">{programTemplate?.name || 'No live graphic'}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400">Last Take</p>
          <p className="font-semibold text-slate-100">{lastTakeAt ? new Date(lastTakeAt).toLocaleString() : 'Never'}</p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
        <TemplatePreview template={programTemplate} label="PROGRAM FEED" tone="program" />
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-950 p-4">
        {!programTemplate ? (
          <p className="text-slate-500">No template on Output. Go to Control Room and click <strong>Take</strong>.</p>
        ) : (
          <div className="space-y-2 text-sm text-slate-200">
            <p className="font-semibold">Now airing: {programTemplate.name}</p>
            <p>Canvas: {programTemplate.canvasWidth} × {programTemplate.canvasHeight}</p>
            {summary && (
              <p>
                Layers: {programTemplate.layers.length} total ({summary.textLayers} text, {summary.assetLayers} assets, {summary.shapeLayers} shapes)
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
