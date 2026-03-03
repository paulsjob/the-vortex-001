import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import { DashboardRoute } from './DashboardRoute';
import { DesignRoute } from './DesignRoute';
import { DataEngineRoute } from './DataEngineRoute';
import { ControlRoomRoute } from './ControlRoomRoute';
import { OutputRoute } from './OutputRoute';
import { PublicTemplateRoute } from './PublicTemplateRoute';
import { PublicOutputRoute } from './PublicOutputRoute';
import { usePlayoutStore } from '../store/usePlayoutStore';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useTemplateStore } from '../store/useTemplateStore';
import { useDemoSessionStore } from '../store/useDemoSessionStore';
import { useDataEngineStore } from '../store/useDataEngineStore';

const tabs = [
  { to: '/', label: 'Dashboard' },
  { to: '/design', label: 'Design' },
  { to: '/data-engine', label: 'Data Engine' },
  { to: '/control-room', label: 'Control Room' },
  { to: '/output', label: 'Output' },
];

const preloadRoutes = ['/control-room', '/output', '/data-engine'];

export function AppRoutes() {
  const previewTemplate = usePlayoutStore((s) => s.previewTemplate);
  const programTemplate = usePlayoutStore((s) => s.programTemplate);
  const previewSnapshot = usePlayoutStore((s) => s.previewSnapshot);
  const programSnapshot = usePlayoutStore((s) => s.programSnapshot);
  const outputSnapshotId = usePlayoutStore((s) => s.outputSnapshotId);
  const lastTakeAt = usePlayoutStore((s) => s.lastTakeAt);
  const takeToProgram = usePlayoutStore((s) => s.takeToProgram);
  const setPreviewTemplate = usePlayoutStore((s) => s.setPreviewTemplate);

  const templateStore = useTemplateStore();
  const selectedTemplate = useTemplateStore((s) => s.selectedTemplate);
  const selectTemplate = useTemplateStore((s) => s.selectTemplate);
  const initializeSession = useDemoSessionStore((s) => s.initializeSession);
  const resetDemoSession = useDemoSessionStore((s) => s.resetDemoSession);
  const resetEngine = useDataEngineStore((s) => s.reset);
  const resetPlayoutState = usePlayoutStore((s) => s.resetPlayoutState);
  const designTemplateId = selectedTemplate?.id ?? null;

  useEffect(() => {
    initializeSession();
  }, [initializeSession]);

  useEffect(() => {
    if (selectedTemplate) return;
    const firstTemplate = templateStore.listAllTemplates()[0];
    if (!firstTemplate) return;
    selectTemplate({ source: firstTemplate.source, id: firstTemplate.id });
  }, [selectedTemplate, templateStore, selectTemplate]);

  useEffect(() => {
    if (previewTemplate) return;
    const firstNative = templateStore.templates[0];
    if (!firstNative) return;
    setPreviewTemplate(firstNative);
  }, [previewTemplate, templateStore.templates, setPreviewTemplate]);

  useEffect(() => {
    const fonts = ['Inter', 'system-ui'];
    const fontPromises = fonts.map((font) => document.fonts.load(`400 14px ${font}`));
    const routeWarmups = preloadRoutes.map((route) => fetch(route, { method: 'GET', credentials: 'same-origin' }).catch(() => undefined));
    Promise.allSettled([...fontPromises, ...routeWarmups]);
  }, []);

  const location = useLocation();
  const isPublicTemplateFeed = location.pathname.startsWith('/template-feed/');
  const isPublicOutputFeed = location.pathname.startsWith('/output-feed');
  const isOutputRoute = location.pathname === '/output';

  const navStatusLabel = useMemo(() => {
    if (!programTemplate) return 'PROGRAM STANDBY';
    const takeTime = lastTakeAt ? new Date(lastTakeAt).toLocaleTimeString() : 'now';
    return `PROGRAM LOCKED · ${takeTime}`;
  }, [programTemplate, lastTakeAt]);

  const handleResetDemo = () => {
    resetEngine();
    resetPlayoutState();
    resetDemoSession();

    const firstTemplate = templateStore.templates[0];
    if (firstTemplate) {
      setPreviewTemplate(firstTemplate);
      selectTemplate({ source: 'native', id: firstTemplate.id });
    }
  };

  if (isPublicTemplateFeed || isPublicOutputFeed) {
    return (
      <Routes>
        <Route path="/template-feed/:templateId" element={<PublicTemplateRoute />} />
        <Route path="/output-feed" element={<PublicOutputRoute />} />
      </Routes>
    );
  }

  if (isOutputRoute) {
    return (
      <div className="h-screen overflow-hidden bg-slate-950 text-slate-100">
        <Routes>
          <Route path="/output" element={<OutputRoute />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="shrink-0 border-b border-slate-800 bg-slate-900 px-6 py-5">
        <div className="flex items-center justify-between gap-6">
          <h1 className="text-2xl font-bold tracking-wide text-slate-100">Renderless</h1>
          <div className="flex items-center gap-4">
            <nav className="flex gap-2 rounded-lg border border-slate-700 bg-slate-950 p-2">
              {tabs.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className={({ isActive }) => `rounded-md border px-3 py-2 text-sm font-semibold ${isActive ? 'border-blue-500 bg-blue-700 text-blue-50' : 'border-transparent text-slate-300 hover:border-slate-600 hover:bg-slate-800'}`}>
                  {tab.label}
                </NavLink>
              ))}
            </nav>
            <StatusBadge tone="ready">READY</StatusBadge>
            <div className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs uppercase tracking-wider text-slate-300">
              {navStatusLabel}
            </div>
            <button
              className="rounded-md border border-amber-500 bg-amber-600 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-500"
              onClick={handleResetDemo}
              title="Reset all demo state"
            >
              Reset Demo
            </button>
            {import.meta.env.DEV && (
              <div className="rounded-md border border-emerald-500/50 bg-emerald-950/70 px-3 py-2 text-[10px] font-mono leading-tight text-emerald-100">
                <div>Design: {designTemplateId ?? 'null'}</div>
                <div>Preview: {previewSnapshot?.snapshotId ?? 'null'}</div>
                <div>Program: {programSnapshot?.snapshotId ?? 'null'}</div>
                <div>Output: {outputSnapshotId ?? 'null'}</div>
              </div>
            )}
            <button
              className="rounded-md border border-red-500 bg-red-600 px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              onClick={takeToProgram}
              disabled={!previewTemplate}
              title={previewTemplate ? `Take ${previewTemplate.name} to Output` : 'Load a template in Control Room first'}
            >
              TAKE
            </button>
          </div>
        </div>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-6">
        <Routes>
          <Route path="/" element={<DashboardRoute />} />
          <Route path="/design" element={<DesignRoute />} />
          <Route path="/data-engine" element={<DataEngineRoute />} />
          <Route path="/control-room" element={<ControlRoomRoute />} />
          <Route path="/output" element={<OutputRoute />} />
          <Route path="/template-feed/:templateId" element={<PublicTemplateRoute />} />
          <Route path="/output-feed" element={<PublicOutputRoute />} />
          <Route path="*" element={<div className="grid h-full min-h-0 place-items-center text-sm text-slate-400">Route not found.</div>} />
        </Routes>
      </main>
    </div>
  );
}
