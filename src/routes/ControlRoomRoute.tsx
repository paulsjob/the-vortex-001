import { useMemo } from 'react';
import { useTemplateStore } from '../store/useTemplateStore';
import { usePlayoutStore } from '../store/usePlayoutStore';
import { TemplatePreview } from '../features/playout/TemplatePreview';
import { useDataEngineStore } from '../store/useDataEngineStore';
import { buildTemplateFeedUrl } from '../features/playout/publicUrl';

export function ControlRoomRoute() {
  const templateStore = useTemplateStore();
  const previewTemplate = usePlayoutStore((s) => s.previewTemplate);
  const programTemplate = usePlayoutStore((s) => s.programTemplate);
  const lastTakeAt = usePlayoutStore((s) => s.lastTakeAt);
  const setPreviewTemplate = usePlayoutStore((s) => s.setPreviewTemplate);
  const takeToProgram = usePlayoutStore((s) => s.takeToProgram);

  const engineRunning = useDataEngineStore((s) => s.running);
  const engineSpeed = useDataEngineStore((s) => s.speed);
  const startEngine = useDataEngineStore((s) => s.start);
  const stopEngine = useDataEngineStore((s) => s.stop);
  const stepPitch = useDataEngineStore((s) => s.stepPitch);
  const setEngineSpeed = useDataEngineStore((s) => s.setSpeed);


  const copyTemplateUrl = async (templateId: string) => {
    const template = templateStore.getTemplateById(templateId);
    if (!template) return;
    const url = buildTemplateFeedUrl(window.location.origin, template);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy template URL', url);
    }
  };

  const templates = useMemo(
    () => [...templateStore.templates].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [templateStore.templates],
  );

  return (
    <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div>
        <h2 className="text-2xl font-bold text-slate-100">Control Room Template Queue</h2>
        <p className="text-slate-400">Saved Design templates are available here for graphics operators to trigger on-air.</p>
      </div>


      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700 bg-slate-950 p-3">
        <div className="text-xs text-slate-400">
          <span className="mr-2 uppercase tracking-wider">Data Engine</span>
          <span className={`font-semibold ${engineRunning ? 'text-emerald-300' : 'text-amber-300'}`}>{engineRunning ? 'Live' : 'Paused'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs" value={engineSpeed} onChange={(e) => setEngineSpeed(e.target.value as 'slow' | 'normal' | 'fast')}>
            <option value="slow">Slow</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
          <button className="rounded border border-slate-700 px-2 py-1 text-xs" onClick={stepPitch}>Step</button>
          <button className="rounded bg-emerald-700 px-2 py-1 text-xs font-semibold disabled:opacity-50" onClick={startEngine} disabled={engineRunning}>Start</button>
          <button className="rounded bg-amber-700 px-2 py-1 text-xs font-semibold disabled:opacity-50" onClick={stopEngine} disabled={!engineRunning}>Pause</button>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-700 bg-slate-950 p-3 xl:grid-cols-2">
        <TemplatePreview template={previewTemplate} label="PST / Preview" tone="preview" />
        <TemplatePreview template={programTemplate} label="PGM / Program" tone="program" />
      </div>

      <div className="flex flex-wrap items-center justify-between rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-slate-400">
        <p>
          <span className="mr-2 uppercase tracking-wider">Preview</span>
          <span className="font-semibold text-slate-200">{previewTemplate?.name || 'No template loaded'}</span>
        </p>
        <p>
          <span className="mr-2 uppercase tracking-wider">Program</span>
          <span className="font-semibold text-slate-200">{programTemplate?.name || 'Nothing on-air'}</span>
        </p>
        {lastTakeAt && <p>Last take: {new Date(lastTakeAt).toLocaleString()}</p>}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-700">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_300px] bg-slate-950 px-4 py-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          <span>Name</span>
          <span>Canvas</span>
          <span>Layers</span>
          <span>Saved</span>
          <span>Actions</span>
        </div>
        <div className="divide-y divide-slate-800">
          {templates.map((template) => {
            const isPreview = previewTemplate?.id === template.id;
            return (
              <div key={template.id} className={`grid grid-cols-[2fr_1fr_1fr_1fr_300px] items-center px-4 py-3 text-sm ${isPreview ? 'bg-blue-900/20 text-blue-100' : 'text-slate-200'}`}>
                <span className="font-semibold">{template.name}</span>
                <span>{template.canvasWidth} × {template.canvasHeight}</span>
                <span>{template.layers.length}</span>
                <span>{new Date(template.createdAt).toLocaleString()}</span>
                <div className="flex gap-2">
                  <button className="rounded bg-blue-700 px-2 py-1 text-xs font-semibold" onClick={() => setPreviewTemplate(template)}>
                    {isPreview ? 'Loaded' : 'Load Preview'}
                  </button>
                  <button className="rounded border border-emerald-700 px-2 py-1 text-xs font-semibold text-emerald-300" onClick={() => copyTemplateUrl(template.id)}>Copy URL</button>
                  <button className="rounded bg-red-700 px-2 py-1 text-xs font-semibold disabled:opacity-50" onClick={takeToProgram} disabled={!isPreview}>
                    Take
                  </button>
                </div>
              </div>
            );
          })}
          {!templates.length && (
            <div className="px-4 py-6 text-sm text-slate-500">
              No saved templates yet. Save one from the Design dashboard to make it available here.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
