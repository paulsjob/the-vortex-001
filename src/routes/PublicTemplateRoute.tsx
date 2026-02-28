import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTemplateStore } from '../store/useTemplateStore';
import { useDataEngineStore } from '../store/useDataEngineStore';
import { decodeTemplatePayload } from '../features/playout/publicUrl';
import { TemplateSceneSvg } from '../features/playout/TemplateSceneSvg';
import { sceneFromVortexPackage } from '../features/packages/vortexSceneAdapter';
import { getVortexAssetUrl } from '../features/packages/vortexAssetResolver';
import { type FontLoadResult, loadVortexFonts } from '../features/packages/vortexFontGate';
import { getManifestFormat } from '../features/packages/loadVortexPackage';
import { FontGateOverlay } from '../features/playout/FontGateOverlay';
import { usePlayoutStore } from '../store/usePlayoutStore';
import { applyBindingsToScene, normalizeBindingSchema } from '../features/playout/vortexBindings';

export function PublicTemplateRoute() {
  const { templateId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const templateStore = useTemplateStore();
  const startEngine = useDataEngineStore((s) => s.start);
  const fontOverrides = usePlayoutStore((s) => s.fontOverrides);
  const setFontOverride = usePlayoutStore((s) => s.setFontOverride);
  const [fontGateResult, setFontGateResult] = useState<FontLoadResult | null>(null);
  const initializeBindings = usePlayoutStore((s) => s.initializeBindings);
  const getBindingState = usePlayoutStore((s) => s.getBindingState);
  const setBindingFontGateSatisfied = usePlayoutStore((s) => s.setBindingFontGateSatisfied);

  useEffect(() => {
    startEngine();
  }, [startEngine]);

  const renderState = useMemo(() => {
    const encoded = searchParams.get('tpl');
    if (encoded) {
      const decoded = decodeTemplatePayload(encoded);
      if (decoded) {
        return { template: decoded, source: 'native' as const };
      }
      return { error: 'Template payload is invalid.' };
    }

    const vortexPackage = templateStore.getVortexPackage(templateId);
    if (vortexPackage) {
      try {
        const scene = sceneFromVortexPackage(vortexPackage);
        const schema = normalizeBindingSchema(vortexPackage.bindings);
        const format = getManifestFormat(vortexPackage.manifest);
        return {
          source: 'vortex' as const,
          packageRef: vortexPackage,
          formatLabel: `${format.formatId} · ${scene.canvas.width} × ${scene.canvas.height}`,
          schema,
          template: {
            id: vortexPackage.manifest.templateId,
            name: vortexPackage.manifest.templateName,
            canvasWidth: scene.canvas.width,
            canvasHeight: scene.canvas.height,
            layers: scene.layers,
          },
        };
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Vortex scene is invalid.' };
      }
    }

    const nativeTemplate = templateStore.getTemplateById(templateId);
    if (nativeTemplate) {
      return { template: nativeTemplate, source: 'native' as const };
    }

    return { error: 'Template not found.' };
  }, [searchParams, templateStore.templates, templateStore.vortexPackages, templateId]);

  useEffect(() => {
    if (renderState.source !== 'vortex' || !renderState.packageRef) {
      setFontGateResult(null);
      return;
    }

    let active = true;
    loadVortexFonts(renderState.packageRef, renderState.template.layers).then((result) => {
      if (active) {
        setFontGateResult(result);
      }
    });

    return () => {
      active = false;
    };
  }, [renderState]);


  useEffect(() => {
    if (renderState.source !== 'vortex') return;
    initializeBindings(renderState.template.id, renderState.schema);
  }, [renderState, initializeBindings]);

  useEffect(() => {
    if (renderState.source !== 'vortex') return;
    const override = fontOverrides[renderState.template.id];
    const satisfied = Boolean(!fontGateResult || fontGateResult.ok || override?.enabled);
    setBindingFontGateSatisfied(renderState.template.id, satisfied);
  }, [renderState, fontOverrides, fontGateResult, setBindingFontGateSatisfied]);

  if (renderState.error) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-slate-300">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Graphic unavailable</h1>
          <p className="text-sm text-slate-500">{renderState.error}</p>
        </div>
      </main>
    );
  }

  const template = renderState.template;
  if (!template) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-slate-300">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Graphic unavailable</h1>
          <p className="text-sm text-slate-500">Template could not be prepared for rendering.</p>
        </div>
      </main>
    );
  }

  const override = renderState.source === 'vortex' ? fontOverrides[template.id] : undefined;
  const shouldBlockForFonts = Boolean(renderState.source === 'vortex' && fontGateResult && !fontGateResult.ok && !override?.enabled);
  const bindingState = renderState.source === 'vortex' ? getBindingState(template.id) : undefined;
  const transformedTemplate = renderState.source === 'vortex'
    ? applyBindingsToScene(template, renderState.schema, bindingState)
    : template;
  const shouldBlockForBindings = Boolean(renderState.source === 'vortex' && bindingState && !bindingState.readyToAir);

  return (
    <main className="grid min-h-screen place-items-center bg-black p-4">
      <div className="relative w-full" style={{ maxWidth: '100vw', maxHeight: '100vh', aspectRatio: `${template.canvasWidth} / ${template.canvasHeight}`, fontFamily: override?.enabled ? override.fallbackFamily : undefined }}>
        {shouldBlockForFonts && renderState.source === 'vortex' && fontGateResult && (
          <FontGateOverlay
            templateName={template.name}
            formatLabel={renderState.formatLabel}
            missingFamilies={fontGateResult.missingFamilies}
            loadedFamilies={fontGateResult.loadedFamilies}
            onKeepStopped={() => undefined}
            onOverride={(fallbackFamily) => {
              setFontOverride(template.id, {
                enabled: true,
                fallbackFamily,
                timestamp: new Date().toISOString(),
              });
            }}
          />
        )}

        {shouldBlockForBindings && (
          <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 text-center text-sm text-rose-200">
            <div>
              <p className="font-semibold">Rendering blocked: Vortex bindings are not ready.</p>
              <p className="text-xs text-rose-300">Complete required bindings in the operator Output route.</p>
            </div>
          </div>
        )}

        {!shouldBlockForFonts && !shouldBlockForBindings && (
          <TemplateSceneSvg
            template={transformedTemplate}
            className="h-full w-full"
            assetResolver={renderState.source === 'vortex' ? (path) => getVortexAssetUrl(template.id, path) : undefined}
          />
        )}
      </div>
    </main>
  );
}
