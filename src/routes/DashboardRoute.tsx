import { useState } from 'react';
import { AssetExplorer } from '../features/assets/AssetExplorer';
import { TemplateExplorer } from '../features/assets/TemplateExplorer';

export function DashboardRoute() {
  const [showBranded, setShowBranded] = useState(true);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showFonts, setShowFonts] = useState(false);

  return (
    <section className="space-y-4">
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-300">Global Asset Library</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
          <button onClick={() => setShowBranded((s) => !s)} className={`rounded-lg border px-3 py-3 text-left ${showBranded ? 'border-blue-500 bg-blue-900/40' : 'border-slate-700 bg-slate-800'}`}>Branded Assets</button>
          <button onClick={() => setShowTemplates((s) => !s)} className={`rounded-lg border px-3 py-3 text-left ${showTemplates ? 'border-blue-500 bg-blue-900/40' : 'border-slate-700 bg-slate-800'}`}>Templates</button>
          <button onClick={() => setShowFonts((s) => !s)} className={`rounded-lg border px-3 py-3 text-left ${showFonts ? 'border-blue-500 bg-blue-900/40' : 'border-slate-700 bg-slate-800'}`}>Fonts</button>
        </div>
      </div>

      {showBranded && <AssetExplorer kind="branded" title="Branded Assets" />}
      {showTemplates && <TemplateExplorer />}
      {showFonts && (
        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="mb-2 font-semibold">Fonts Repository</h3>
          <p className="text-sm text-slate-400">Organization-wide fonts locker UI placeholder. Upload, licensing, and activation workflow to follow.</p>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
            <div className="rounded border border-slate-700 bg-slate-950 p-3">Inter · Active</div>
            <div className="rounded border border-slate-700 bg-slate-950 p-3">Roboto · Active</div>
            <div className="rounded border border-slate-700 bg-slate-950 p-3">Montserrat · Active</div>
          </div>
        </section>
      )}
    </section>
  );
}
