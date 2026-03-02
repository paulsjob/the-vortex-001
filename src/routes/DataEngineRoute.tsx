import { StatusBadge } from '../components/ui/StatusBadge';
import { simulatorOptions } from '../features/simulation/registry';
import { SimulationScenario, Speed, useDataEngineStore } from '../store/useDataEngineStore';

const speedOptions: Array<{ label: string; value: Speed }> = [
  { label: 'Slow', value: 'slow' },
  { label: 'Normal', value: 'normal' },
  { label: 'Fast', value: 'fast' },
];

const scenarioOptions: Array<{ label: string; value: SimulationScenario }> = [
  { label: 'Normal', value: 'normal' },
  { label: 'Comeback', value: 'comeback' },
  { label: 'Shootout', value: 'shootout' },
  { label: 'Defensive Battle', value: 'defensive-battle' },
  { label: 'Rivalry Chaos', value: 'rivalry-chaos' },
];

const clockLabel = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

export function DataEngineRoute() {
  const { activeSport, game, history, running, speed, scenario, start, stop, reset, setSpeed, setSport, setScenario, triggerDemo, stepPitch } = useDataEngineStore();

  const feeds = [
    { id: 'live-game', name: 'Live Game Feed', status: running ? 'connected' : 'disconnected' },
    { id: 'derived-stats', name: 'Derived Stats Feed', status: running ? 'connected' : 'disconnected' },
    { id: 'sponsor-catalog', name: 'Sponsor Catalog Feed (demo)', status: 'connected' },
  ] as const;

  const samplePayload = {
    sport: activeSport,
    gameId: 'demo-001',
    homeTeam: game.homeTeam,
    awayTeam: game.awayTeam,
    score: { home: game.scoreHome, away: game.scoreAway },
    period: game.periodLabel,
    clock: clockLabel(game.clockSeconds),
    possession: game.possession,
    lastEvent: game.lastEvent,
    pitcher: game.pitcher,
    batter: game.batter,
    lastPitch: game.lastPitch,
    updatedAt: new Date().toISOString(),
  };

  return (
    <section className="grid h-full min-h-0 gap-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-h-0 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-3">
        <h2 className="text-base font-semibold text-slate-100">Feeds</h2>
        <p className="mt-1 text-xs text-slate-400">Demo feed inventory</p>
        <div className="mt-3 space-y-2">
          {feeds.map((feed) => (
            <div key={feed.id} className="rounded border border-slate-700 bg-slate-900 p-2 text-sm">
              <p className="font-medium text-slate-100">{feed.name}</p>
              <p className="mt-1 text-xs text-slate-400">{feed.id}</p>
              <p className="mt-1 text-xs">Status: {feed.status}</p>
            </div>
          ))}
        </div>
      </aside>

      <section className="space-y-4 overflow-auto rounded-lg border border-slate-700 bg-slate-950 p-4">
        <div className="space-y-3 rounded border border-slate-700 bg-slate-900 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-slate-100">Live Game Feed</h3>
            {running ? <StatusBadge tone="ready">CONNECTED</StatusBadge> : <StatusBadge tone="not-ready">DISCONNECTED</StatusBadge>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <div className="mr-2 flex items-center gap-1 rounded border border-slate-700 bg-slate-950 p-1">
              {simulatorOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSport(option.key)}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    activeSport === option.key ? 'bg-cyan-700 text-cyan-100' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button type="button" onClick={start} disabled={running} className="rounded border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 font-medium text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50">Start</button>
            <button type="button" onClick={stop} disabled={!running} className="rounded border border-amber-700 bg-amber-900/30 px-3 py-1.5 font-medium text-amber-200 disabled:cursor-not-allowed disabled:opacity-50">Stop</button>
            <button type="button" onClick={reset} className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 font-medium text-slate-200">Restart</button>
            <div className="ml-2 flex items-center gap-1 rounded border border-slate-700 bg-slate-950 p-1">
              {speedOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSpeed(option.value)}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    speed === option.value ? 'bg-indigo-700 text-indigo-100' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value as SimulationScenario)}
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200"
            >
              {scenarioOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button type="button" onClick={() => triggerDemo('force-score')} className="rounded border border-emerald-700 bg-emerald-900/20 px-2 py-1 text-xs font-medium text-emerald-200">Force Score</button>
            <button type="button" onClick={() => triggerDemo('force-turnover')} className="rounded border border-rose-700 bg-rose-900/20 px-2 py-1 text-xs font-medium text-rose-200">Force Turnover</button>
            <button type="button" onClick={() => triggerDemo('force-penalty')} className="rounded border border-yellow-700 bg-yellow-900/20 px-2 py-1 text-xs font-medium text-yellow-200">Force Penalty</button>
            <button type="button" onClick={() => triggerDemo('force-big-play')} className="rounded border border-sky-700 bg-sky-900/20 px-2 py-1 text-xs font-medium text-sky-200">Force Big Play</button>
            <button type="button" onClick={stepPitch} disabled={running} className="rounded border border-indigo-700 bg-indigo-900/40 px-3 py-1.5 font-medium text-indigo-200 disabled:cursor-not-allowed disabled:opacity-50">Step</button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded border border-slate-700 bg-slate-900 p-3 text-sm">
            <p className="text-slate-400">Game Snapshot</p>
            <p className="font-semibold text-slate-100">{game.awayTeam} {game.scoreAway} - {game.homeTeam} {game.scoreHome}</p>
            <p className="mt-1 text-xs text-slate-300">{game.periodLabel} · {clockLabel(game.clockSeconds)}</p>
            <p className="mt-1 text-xs text-slate-500">{game.lastEvent}</p>
          </div>
          <div className="rounded border border-slate-700 bg-slate-900 p-3 text-sm">
            <p className="text-slate-400">Endpoints</p>
            <p>GET /api/feed/live-game</p>
            <p>GET /api/endpoints/derived-stats</p>
            <p>GET /api/endpoints/normalized-scorebug</p>
          </div>
        </div>

        <div className="rounded border border-slate-700 bg-slate-900 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-slate-400">Sample Payload Preview</p>
          <pre className="overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-200">{JSON.stringify(samplePayload, null, 2)}</pre>
        </div>

        <div className="rounded border border-slate-700 bg-slate-900 p-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-slate-400">Recent Simulation Events</p>
          <div className="space-y-1 text-sm text-slate-200">
            {history.slice(0, 8).map((event) => (
              <p key={event.id} className="rounded border border-slate-700 bg-slate-950 px-2 py-1">
                {event.periodLabel} {event.clockLabel} · {event.summary} ({game.awayTeam} {event.scoreAway}-{event.scoreHome} {game.homeTeam})
              </p>
            ))}
            {history.length === 0 && <p className="text-slate-400">No events yet.</p>}
          </div>
        </div>
      </section>
    </section>
  );
}
