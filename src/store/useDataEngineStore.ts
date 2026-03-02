import { create } from 'zustand';
import { createSimulatorContext, resetSimulationCore } from '../features/simulation/core';
import { simulatorRegistry } from '../features/simulation/registry';
import type { GameState, SimulationEvent, SimulationScenario, SimulationTrigger, SportKey } from '../features/simulation/types';

export type { GameState, SportKey, SimulationScenario, SimulationTrigger };
export type Speed = 'slow' | 'normal' | 'fast';

interface DataEngineStore {
  activeSport: SportKey;
  game: GameState;
  running: boolean;
  speed: Speed;
  history: SimulationEvent[];
  scenario: SimulationScenario;
  pendingTrigger: SimulationTrigger | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
  setSpeed: (speed: Speed) => void;
  setSport: (sport: SportKey) => void;
  setScenario: (scenario: SimulationScenario) => void;
  triggerDemo: (trigger: SimulationTrigger) => void;
  stepPitch: () => void;
}

const speedsMs: Record<Speed, number> = { slow: 1800, normal: 900, fast: 350 };

let timer: ReturnType<typeof setInterval> | null = null;
const ctx = createSimulatorContext();

const runInterval = (get: () => DataEngineStore) => {
  timer = setInterval(() => {
    get().stepPitch();
  }, speedsMs[get().speed]);
};

export const useDataEngineStore = create<DataEngineStore>((set, get) => ({
  activeSport: 'mlb',
  game: simulatorRegistry.mlb.createInitialGame(),
  running: false,
  speed: 'normal',
  history: [],
  scenario: 'normal',
  pendingTrigger: null,
  start: () => {
    if (timer) return;
    set({ running: true });
    runInterval(get);
  },
  stop: () => {
    if (timer) clearInterval(timer);
    timer = null;
    set({ running: false });
  },
  setSpeed: (speed) => {
    set({ speed });
    if (!get().running) return;
    if (timer) clearInterval(timer);
    runInterval(get);
  },
  setScenario: (scenario) => set({ scenario }),
  triggerDemo: (trigger) => set({ pendingTrigger: trigger }),
  setSport: (sport) => {
    if (timer) clearInterval(timer);
    timer = null;
    resetSimulationCore();
    set({ activeSport: sport, running: false, speed: 'normal', game: simulatorRegistry[sport].createInitialGame(), history: [], pendingTrigger: null });
  },
  reset: () => {
    if (timer) clearInterval(timer);
    timer = null;
    resetSimulationCore();
    const sport = get().activeSport;
    set({ running: false, speed: 'normal', game: simulatorRegistry[sport].createInitialGame(), history: [], pendingTrigger: null });
  },
  stepPitch: () => {
    const { activeSport, game, scenario, pendingTrigger } = get();
    const plugin = simulatorRegistry[activeSport];
    const { game: nextGame, event } = plugin.step(game, ctx, { scenario, trigger: pendingTrigger });
    set((s) => ({ game: nextGame, history: [event, ...s.history].slice(0, 120), pendingTrigger: null }));
  },
}));
