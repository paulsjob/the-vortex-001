import { useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useTemplateStore } from '../store/useTemplateStore';
import { useDataEngineStore } from '../store/useDataEngineStore';
import { decodeTemplatePayload } from '../features/playout/publicUrl';
import { TemplateSceneSvg } from '../features/playout/TemplateSceneSvg';

export function PublicTemplateRoute() {
  const { templateId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const templateStore = useTemplateStore();
  const startEngine = useDataEngineStore((s) => s.start);

  useEffect(() => {
    startEngine();
  }, [startEngine]);

  const template = useMemo(() => {
    const encoded = searchParams.get('tpl');
    if (encoded) {
      const decoded = decodeTemplatePayload(encoded);
      if (decoded) return decoded;
    }
    return templateStore.getTemplateById(templateId);
  }, [searchParams, templateStore.templates, templateId]);

  if (!template) {
    return (
      <main className="grid min-h-screen place-items-center bg-black text-slate-300">
        <div className="text-center">
          <h1 className="text-lg font-semibold">Graphic unavailable</h1>
          <p className="text-sm text-slate-500">Template not found.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-black p-4">
      <div className="w-full" style={{ maxWidth: '100vw', maxHeight: '100vh', aspectRatio: `${template.canvasWidth} / ${template.canvasHeight}` }}>
        <TemplateSceneSvg template={template} className="h-full w-full" />
      </div>
    </main>
  );
}
