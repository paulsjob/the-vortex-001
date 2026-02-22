import { NavLink, Route, Routes } from 'react-router-dom';
import { DashboardRoute } from './DashboardRoute';
import { DesignRoute } from './DesignRoute';
import { DataEngineRoute } from './DataEngineRoute';

const tabs = [
  { to: '/', label: 'Dashboard' },
  { to: '/design', label: 'Design' },
  { to: '/data-engine', label: 'Data Engine' },
  { to: '/control-room', label: 'Control Room' },
  { to: '/output', label: 'Output' },
];

function Placeholder({ title }: { title: string }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-300">{title} coming back in next pass.</div>;
}

export function AppRoutes() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold tracking-wide text-slate-100">Renderless</h1>
          <div className="flex items-center gap-6">
            <nav className="flex gap-2 rounded-xl border border-slate-700 bg-slate-950 p-2">
              {tabs.map((tab) => (
                <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className={({ isActive }) => `rounded-lg px-4 py-2 text-lg font-semibold ${isActive ? 'bg-blue-700 text-blue-50' : 'text-slate-300 hover:bg-slate-800'}`}>
                  {tab.label}
                </NavLink>
              ))}
            </nav>
            <span className="text-2xl text-emerald-400">● Live Connected</span>
            <button className="rounded-xl bg-red-600 px-6 py-3 text-xl font-semibold">Push to Stream</button>
          </div>
        </div>
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<DashboardRoute />} />
          <Route path="/design" element={<DesignRoute />} />
          <Route path="/data-engine" element={<DataEngineRoute />} />
          <Route path="/control-room" element={<Placeholder title="Control Room" />} />
          <Route path="/output" element={<Placeholder title="Output" />} />
        </Routes>
      </main>
    </div>
  );
}
