import { useEffect, useMemo, useState } from 'react';
import { usePlayoutStore } from '../store/usePlayoutStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { TemplateSceneSvg } from '../features/playout/TemplateSceneSvg';
import { buildOutputFeedUrl } from '../features/playout/publicUrl';
import { sceneFromVortexPackage } from '../features/packages/vortexSceneAdapter';
import { getVortexAssetUrl } from '../features/packages/vortexAssetResolver';
import { type FontLoadResult, loadVortexFonts } from '../features/packages/vortexFontGate';
import { getManifestFormat } from '../features/packages/loadVortexPackage';
import { FontGateOverlay } from '../features/playout/FontGateOverlay';
import { applyBindingsToScene, normalizeBindingSchema, type BindingDefinition } from '../features/playout/vortexBindings';

export function OutputRoute() {
  const templateStore = useTemplateStore();
  const programTemplate = usePlayoutStore((s) => s.programTemplate);
  const lastTakeAt = usePlayoutStore((s) => s.lastTakeAt);
  const clearProgram = usePlayoutStore((s) => s.clearProgram);
  const fontOverrides = usePlayoutStore((s) => s.fontOverrides);
  const setFontOverride = usePlayoutStore((s) => s.setFontOverride);
  const initializeBindings = usePlayoutStore((s) => s.initializeBindings);
  const setBindingValue = usePlayoutStore((s) => s.setBindingValue);
  const getBindingState = usePlayoutStore((s) => s.getBindingState);
  const setBindingFontGateSatisfied = usePlayoutStore((s) => s.setBindingFontGateSatisfied);

  const selectedTemplate = templateStore.selectedTemplate;
  const [fontGateResult, setFontGateResult] = useState<FontLoadResult | null>(null);
  const [fontGateLoading, setFontGateLoading] = useState(false);

  const vortexRenderState = useMemo(() => {
    if (!selectedTemplate || selectedTemplate.source !== 'vortex') {
      return null;
    }
    const pkg = templateStore.getVortexPackage(selectedTemplate.id);
    if (!pkg) {
      return { error: 'Selected Vortex template package is missing.' as const };
    }
    try {
      const scene = sceneFromVortexPackage(pkg);
      const schema = normalizeBindingSchema(pkg.bindings);
      const format = getManifestFormat(pkg.manifest);
      return {
        template: {
          id: pkg.manifest.templateId,
          name: pkg.manifest.templateName,
          canvasWidth: scene.canvas.width,
          canvasHeight: scene.canvas.height,
          layers: scene.layers,
        },
        schema,
        formatLabel: `${format.formatId} · ${scene.canvas.width} × ${scene.canvas.height}`,
        packageRef: pkg,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid Vortex scene data.' };
    }
  }, [selectedTemplate, templateStore.vortexPackages]);

  useEffect(() => {
    if (!vortexRenderState || !('template' in vortexRenderState) || !vortexRenderState.template || !vortexRenderState.schema) return;
    initializeBindings(vortexRenderState.template.id, vortexRenderState.schema);
  }, [vortexRenderState, initializeBindings]);

  useEffect(() => {
    if (!vortexRenderState || !('template' in vortexRenderState) || !vortexRenderState.packageRef) {
      setFontGateResult(null);
      setFontGateLoading(false);
      return;
    }

    let active = true;
    setFontGateLoading(true);
    loadVortexFonts(vortexRenderState.packageRef, vortexRenderState.template.layers)
      .then((result) => {
        if (!active) return;
        setFontGateResult(result);
      })
      .finally(() => {
        if (!active) return;
        setFontGateLoading(false);
      });

    return () => {
      active = false;
    };
  }, [vortexRenderState]);

  useEffect(() => {
    if (!vortexRenderState || !('template' in vortexRenderState) || !vortexRenderState.template) return;
    const override = fontOverrides[vortexRenderState.template.id];
    const satisfied = Boolean(!fontGateResult || fontGateResult.ok || override?.enabled);
    setBindingFontGateSatisfied(vortexRenderState.template.id, satisfied);
  }, [vortexRenderState, fontGateResult, fontOverrides, setBindingFontGateSatisfied]);

  const copyOutputUrl = async () => {
    if (!programTemplate) return;
    const url = buildOutputFeedUrl(window.location.origin, programTemplate);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt('Copy output URL', url);
    }
  };

  const vortexTemplate = vortexRenderState && 'template' in vortexRenderState ? vortexRenderState.template : undefined;
  const vortexSchema = vortexRenderState && 'template' in vortexRenderState ? vortexRenderState.schema : undefined;
  const bindingState = vortexTemplate ? getBindingState(vortexTemplate.id) : undefined;
  const transformedVortexTemplate = vortexTemplate && vortexSchema
    ? applyBindingsToScene(vortexTemplate, vortexSchema, bindingState)
    : undefined;

  const activeTemplate = transformedVortexTemplate || programTemplate;
  const override = vortexTemplate ? fontOverrides[vortexTemplate.id] : undefined;
  const shouldBlockForFonts = Boolean(vortexRenderState?.template && fontGateResult && !fontGateResult.ok && !override?.enabled);
  const shouldBlockForBindings = Boolean(vortexRenderState?.template && bindingState && !bindingState.readyToAir);

  const renderBindingInput = (binding: BindingDefinition) => {
    if (!vortexTemplate || !bindingState) return null;

    const value = bindingState.values[binding.key];
    const required = binding.required === true;
    const label = (
      <label className="mb-1 block text-xs text-slate-300">
        {binding.key}
        {required && <span className="ml-1 text-rose-300">*</span>}
      </label>
    );

    if (binding.type === 'color') {
      return (
        <div key={binding.key}>
          {label}
          <input
            type="color"
            className="h-8 w-full rounded border border-slate-700 bg-slate-900"
            value={typeof value === 'string' && value ? value : '#ffffff'}
            onChange={(event) => setBindingValue(vortexTemplate.id, binding.key, event.target.value)}
          />
        </div>
      );
    }

    return (
      <div key={binding.key}>
        {label}
        <input
          type={binding.type === 'number' ? 'number' : binding.type === 'image' ? 'url' : 'text'}
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          placeholder={binding.type === 'image' ? 'assets/... or https://...' : undefined}
          onChange={(event) => setBindingValue(vortexTemplate.id, binding.key, event.target.value)}
        />
      </div>
    );
  };

  return (
    <section className="flex h-[calc(100vh-11.75rem)] min-h-[36rem] flex-col gap-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-6">
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

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="grid content-start gap-3 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-4 text-sm">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Template Info</p>
            <p className="font-semibold text-red-300">{vortexRenderState?.template?.name || programTemplate?.name || 'No live graphic'}</p>
            {vortexRenderState?.template ? (
              <p className="text-xs text-slate-400">{vortexRenderState.template.canvasWidth} × {vortexRenderState.template.canvasHeight} · {vortexRenderState.template.layers.length} layers</p>
            ) : programTemplate ? (
              <p className="text-xs text-slate-400">{programTemplate.canvasWidth} × {programTemplate.canvasHeight} · {programTemplate.layers.length} layers</p>
            ) : (
              <p className="text-xs text-slate-500">Waiting for Take from Control Room</p>
            )}
          </div>

          {vortexRenderState?.template && bindingState && (
            <div className="space-y-2 rounded border border-slate-700 bg-slate-900/40 p-2">
              <p className={`text-xs font-semibold ${bindingState.readyToAir ? 'text-emerald-300' : 'text-rose-300'}`}>
                {bindingState.readyToAir ? 'READY TO AIR' : 'NOT READY'}
              </p>
              {!bindingState.readyToAir && (
                <>
                  {!!bindingState.validation.missingRequired.length && (
                    <div>
                      <p className="text-xs text-rose-300">Missing required:</p>
                      <ul className="ml-4 list-disc text-xs text-rose-200">
                        {bindingState.validation.missingRequired.map((key) => <li key={key}>{key}</li>)}
                      </ul>
                    </div>
                  )}
                  {!!bindingState.validation.errors.length && (
                    <div>
                      <p className="text-xs text-rose-300">Validation errors:</p>
                      <ul className="ml-4 list-disc text-xs text-rose-200">
                        {bindingState.validation.errors.map((error) => <li key={`${error.key}-${error.message}`}>{error.key}: {error.message}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {vortexTemplate && (
            <div className="space-y-2 rounded border border-slate-700 bg-slate-900/40 p-2">
              <p className="text-xs uppercase tracking-wider text-slate-400">Vortex Bindings</p>
              {vortexSchema?.bindings.map(renderBindingInput)}
              {!vortexSchema?.bindings.length && (
                <p className="text-xs text-slate-500">No bindings defined in bindings.json</p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Stream Health</p>
            <p className={`font-semibold ${activeTemplate ? 'text-emerald-300' : 'text-amber-300'}`}>{activeTemplate ? 'Stable' : 'Standby'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">FPS</p>
            <p className="font-semibold text-slate-100">{activeTemplate ? '59.94' : '--'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Bitrate</p>
            <p className="font-semibold text-slate-100">{activeTemplate ? '8.5 Mbps' : '--'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Latency</p>
            <p className="font-semibold text-slate-100">{activeTemplate ? '120 ms' : '--'}</p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400">Status</p>
            <p className="font-semibold text-slate-100">{lastTakeAt ? `Last take: ${new Date(lastTakeAt).toLocaleString()}` : 'No takes yet'}</p>
          </div>
        </aside>

        <div className="min-h-0 rounded-lg border border-slate-700 bg-slate-950 p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span className="font-semibold uppercase tracking-[0.2em] text-red-300">Program Feed</span>
            <div className="flex items-center gap-2">
              {override?.enabled && (
                <span className="rounded border border-amber-500/70 bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-200">
                  Font Override: {override.fallbackFamily}
                </span>
              )}
              {activeTemplate && <span>{activeTemplate.canvasWidth} × {activeTemplate.canvasHeight}</span>}
            </div>
          </div>

          {vortexRenderState?.error ? (
            <div className="grid h-[calc(100%-1.5rem)] place-items-center rounded-lg border border-rose-700/60 bg-rose-900/20 text-sm text-rose-200">
              {vortexRenderState.error}
            </div>
          ) : !vortexRenderState?.template && !programTemplate ? (
            <div className="grid h-[calc(100%-1.5rem)] place-items-center rounded-lg border border-slate-700 text-sm text-slate-500">
              No template on Output. Go to Control Room and click <strong>Take</strong>.
            </div>
          ) : (
            <div className="relative h-[calc(100%-1.5rem)] overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
              <div className="absolute inset-0 bg-[linear-gradient(45deg,#0f172a_25%,#111827_25%,#111827_50%,#0f172a_50%,#0f172a_75%,#111827_75%,#111827_100%)] bg-[length:18px_18px] opacity-70" />

              {fontGateLoading && vortexRenderState?.template && (
                <div className="absolute inset-0 z-20 grid place-items-center text-sm text-slate-200">Loading template fonts…</div>
              )}

              {shouldBlockForFonts && vortexRenderState?.template && fontGateResult && (
                <FontGateOverlay
                  templateName={vortexRenderState.template.name}
                  formatLabel={vortexRenderState.formatLabel}
                  missingFamilies={fontGateResult.missingFamilies}
                  loadedFamilies={fontGateResult.loadedFamilies}
                  onKeepStopped={() => undefined}
                  onOverride={(fallbackFamily) => {
                    if (!vortexTemplate) return;
                    setFontOverride(vortexTemplate.id, {
                      enabled: true,
                      fallbackFamily,
                      timestamp: new Date().toISOString(),
                    });
                  }}
                />
              )}

              {shouldBlockForBindings && vortexRenderState?.template && bindingState && (
                <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 p-6 text-center text-sm text-rose-200">
                  <div>
                    <p className="text-base font-semibold">Rendering blocked: Vortex bindings are not ready.</p>
                    <p className="mt-2 text-xs text-rose-300">Complete required bindings to render this scene.</p>
                  </div>
                </div>
              )}

              <div className="relative z-10 grid h-full place-items-center p-2">
                <div
                  className="relative max-h-full w-full"
                  style={{
                    aspectRatio: `${activeTemplate?.canvasWidth} / ${activeTemplate?.canvasHeight}`,
                    fontFamily: override?.enabled ? override.fallbackFamily : undefined,
                  }}
                >
                  {!shouldBlockForFonts && !shouldBlockForBindings && (
                    <TemplateSceneSvg
                      template={activeTemplate!}
                      className="absolute inset-0 h-full w-full"
                      assetResolver={vortexTemplate ? (path) => getVortexAssetUrl(vortexTemplate.id, path) : undefined}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
