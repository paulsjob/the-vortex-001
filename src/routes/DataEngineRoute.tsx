import { useDataEngineStore } from '../store/useDataEngineStore';

export function DataEngineRoute() {
  const { game, history, running, speed, start, stop, reset, setSpeed, stepPitch } = useDataEngineStore();

  return (
    <section className="space-y-4">
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-300">Baseball Simulation Engine</h2>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button className="rounded bg-blue-700 px-3 py-2" onClick={running ? stop : start}>{running ? 'Pause' : 'Start'}</button>
          <button className="rounded bg-slate-700 px-3 py-2" onClick={stepPitch}>Step Pitch</button>
          <button className="rounded bg-slate-700 px-3 py-2" onClick={reset}>Reset Game</button>
          <select className="rounded border border-slate-700 bg-slate-950 px-3 py-2" value={speed} onChange={(e) => setSpeed(e.target.value as 'slow' | 'normal' | 'fast')}>
            <option value="slow">Slow</option>
            <option value="normal">Normal</option>
            <option value="fast">Fast</option>
          </select>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded border border-slate-700 bg-slate-950 p-3">
            <p className="text-slate-400">Game State</p>
            <p className="text-xl font-semibold">{game.awayTeam} {game.scoreAway} - {game.homeTeam} {game.scoreHome}</p>
            <p>Inning: {game.half === 'top' ? 'Top' : 'Bottom'} {game.inning}</p>
            <p>Count: {game.balls}-{game.strikes}</p>
            <p>Outs: {game.outs}</p>
            <p>Runners: 1B {game.onFirst ? '●' : '○'} · 2B {game.onSecond ? '●' : '○'} · 3B {game.onThird ? '●' : '○'}</p>
          </div>
          <div className="rounded border border-slate-700 bg-slate-950 p-3">
            <p className="text-slate-400">Matchup</p>
            <p>Pitcher: {game.pitcher}</p>
            <p>Batter: {game.batter}</p>
            <p>Pitch #: {game.lastPitch.pitchNumber}</p>
          </div>
          <div className="rounded border border-slate-700 bg-slate-950 p-3">
            <p className="text-slate-400">Last Pitch</p>
            <p>{game.lastPitch.result}</p>
            <p>{game.lastPitch.pitchType} · {game.lastPitch.velocityMph} mph · {game.lastPitch.location}</p>
            <p>Bat {game.lastPitch.batSpeedMph ?? '-'} | EV {game.lastPitch.exitVelocityMph ?? '-'} | LA {game.lastPitch.launchAngleDeg ?? '-'} | Dist {game.lastPitch.projectedDistanceFt ?? '-'}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wider text-slate-300">Live Feed (recent pitches)</h3>
        <div className="max-h-[420px] overflow-auto space-y-2">
          {history.map((pitch) => (
            <div key={pitch.pitchNumber} className="rounded border border-slate-700 bg-slate-950 p-2 text-sm">
              #{pitch.pitchNumber} · {pitch.result} · {pitch.pitchType} {pitch.velocityMph}mph @ {pitch.location} · Bat {pitch.batSpeedMph ?? '-'} EV {pitch.exitVelocityMph ?? '-'} LA {pitch.launchAngleDeg ?? '-'} Dist {pitch.projectedDistanceFt ?? '-'}
            </div>
          ))}
          {!history.length && <p className="text-slate-400">No pitches yet.</p>}
        </div>
      </section>
    </section>
  );
}
