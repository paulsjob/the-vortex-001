import { create } from 'zustand';

type HalfInning = 'top' | 'bottom';
type Speed = 'slow' | 'normal' | 'fast';

type PitchType = 'FF' | 'SI' | 'SL' | 'CH' | 'CU';

interface LastPitch {
  pitchNumber: number;
  pitchType: PitchType;
  velocityMph: number;
  location: string;
  result: string;
  batSpeedMph: number | null;
  exitVelocityMph: number | null;
  launchAngleDeg: number | null;
  projectedDistanceFt: number | null;
}

interface GameState {
  homeTeam: string;
  awayTeam: string;
  inning: number;
  half: HalfInning;
  balls: number;
  strikes: number;
  outs: number;
  scoreHome: number;
  scoreAway: number;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
  pitcher: string;
  batter: string;
  lastPitch: LastPitch;
}

interface DataEngineStore {
  game: GameState;
  running: boolean;
  speed: Speed;
  history: LastPitch[];
  start: () => void;
  stop: () => void;
  reset: () => void;
  setSpeed: (speed: Speed) => void;
  stepPitch: () => void;
}

const battersAway = ['A. Jones', 'B. Cruz', 'C. Watts', 'D. Hale', 'E. Reed', 'F. Knox', 'G. Ray', 'H. Snow', 'I. Dale'];
const battersHome = ['J. Cole', 'K. Ford', 'L. Pope', 'M. Wade', 'N. Moss', 'O. Beck', 'P. Shaw', 'Q. Boyd', 'R. Lane'];
const pitcherAway = 'S. Ortiz';
const pitcherHome = 'T. Kim';

const speedsMs: Record<Speed, number> = { slow: 1800, normal: 900, fast: 350 };

const randomPitchType = (): PitchType => {
  const bag: PitchType[] = ['FF', 'SI', 'SL', 'CH', 'CU'];
  return bag[Math.floor(Math.random() * bag.length)];
};

const randomLocation = () => {
  const rows = ['Up', 'Mid', 'Low'];
  const cols = ['In', 'Center', 'Away'];
  return `${rows[Math.floor(Math.random() * rows.length)]}-${cols[Math.floor(Math.random() * cols.length)]}`;
};

const mkInitialGame = (): GameState => ({
  homeTeam: 'Home',
  awayTeam: 'Away',
  inning: 1,
  half: 'top',
  balls: 0,
  strikes: 0,
  outs: 0,
  scoreHome: 0,
  scoreAway: 0,
  onFirst: false,
  onSecond: false,
  onThird: false,
  pitcher: pitcherHome,
  batter: battersAway[0],
  lastPitch: {
    pitchNumber: 0,
    pitchType: 'FF',
    velocityMph: 0,
    location: 'Mid-Center',
    result: 'Game initialized',
    batSpeedMph: null,
    exitVelocityMph: null,
    launchAngleDeg: null,
    projectedDistanceFt: null,
  },
});

let timer: ReturnType<typeof setInterval> | null = null;
let awayIndex = 0;
let homeIndex = 0;
let pitchCounter = 0;

const nextBatter = (half: HalfInning) => {
  if (half === 'top') {
    awayIndex = (awayIndex + 1) % battersAway.length;
    return battersAway[awayIndex];
  }
  homeIndex = (homeIndex + 1) % battersHome.length;
  return battersHome[homeIndex];
};

const advanceRunners = (game: GameState, bases: 1 | 2 | 3 | 4) => {
  let runs = 0;
  let first = game.onFirst;
  let second = game.onSecond;
  let third = game.onThird;

  for (let step = 0; step < bases; step += 1) {
    runs += third ? 1 : 0;
    third = second;
    second = first;
    first = false;
  }

  if (bases === 4) {
    runs += 1;
  } else if (bases === 3) {
    third = true;
  } else if (bases === 2) {
    second = true;
  } else {
    first = true;
  }

  return { runs, first, second, third };
};

export const useDataEngineStore = create<DataEngineStore>((set, get) => ({
  game: mkInitialGame(),
  running: false,
  speed: 'normal',
  history: [],
  start: () => {
    if (timer) return;
    set({ running: true });
    timer = setInterval(() => {
      get().stepPitch();
    }, speedsMs[get().speed]);
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
    timer = setInterval(() => {
      get().stepPitch();
    }, speedsMs[speed]);
  },
  reset: () => {
    if (timer) clearInterval(timer);
    timer = null;
    awayIndex = 0;
    homeIndex = 0;
    pitchCounter = 0;
    set({ running: false, speed: 'normal', game: mkInitialGame(), history: [] });
  },
  stepPitch: () => {
    const state = get();
    const game = structuredClone(state.game);

    pitchCounter += 1;
    const pitchType = randomPitchType();
    const velocityMph = Math.round(82 + Math.random() * 18);
    const location = randomLocation();

    const r = Math.random();
    let result = '';
    let batSpeedMph: number | null = null;
    let exitVelocityMph: number | null = null;
    let launchAngleDeg: number | null = null;
    let projectedDistanceFt: number | null = null;

    if (r < 0.30) {
      game.balls += 1;
      result = 'Ball';
      if (game.balls >= 4) {
        const moved = advanceRunners(game, 1);
        game.onFirst = moved.first;
        game.onSecond = moved.second;
        game.onThird = moved.third;
        if (game.half === 'top') game.scoreAway += moved.runs;
        else game.scoreHome += moved.runs;
        game.balls = 0;
        game.strikes = 0;
        game.batter = nextBatter(game.half);
        result = 'Walk';
      }
    } else if (r < 0.58) {
      game.strikes += 1;
      result = 'Strike';
      if (game.strikes >= 3) {
        game.outs += 1;
        game.balls = 0;
        game.strikes = 0;
        game.batter = nextBatter(game.half);
        result = 'Strikeout';
      }
    } else if (r < 0.67) {
      result = game.strikes < 2 ? 'Foul' : 'Two-strike foul';
      if (game.strikes < 2) game.strikes += 1;
    } else {
      batSpeedMph = Math.round(62 + Math.random() * 23);
      exitVelocityMph = Math.round(72 + Math.random() * 42);
      launchAngleDeg = Math.round(-8 + Math.random() * 48);
      projectedDistanceFt = Math.round(120 + Math.random() * 310);

      const inPlay = Math.random();
      if (inPlay < 0.35) {
        game.outs += 1;
        result = 'Ball in play: Out';
      } else if (inPlay < 0.70) {
        const moved = advanceRunners(game, 1);
        game.onFirst = moved.first;
        game.onSecond = moved.second;
        game.onThird = moved.third;
        if (game.half === 'top') game.scoreAway += moved.runs;
        else game.scoreHome += moved.runs;
        result = 'Single';
      } else if (inPlay < 0.84) {
        const moved = advanceRunners(game, 2);
        game.onFirst = moved.first;
        game.onSecond = moved.second;
        game.onThird = moved.third;
        if (game.half === 'top') game.scoreAway += moved.runs;
        else game.scoreHome += moved.runs;
        result = 'Double';
      } else if (inPlay < 0.91) {
        const moved = advanceRunners(game, 3);
        game.onFirst = moved.first;
        game.onSecond = moved.second;
        game.onThird = moved.third;
        if (game.half === 'top') game.scoreAway += moved.runs;
        else game.scoreHome += moved.runs;
        result = 'Triple';
      } else {
        const moved = advanceRunners(game, 4);
        game.onFirst = moved.first;
        game.onSecond = moved.second;
        game.onThird = moved.third;
        if (game.half === 'top') game.scoreAway += moved.runs;
        else game.scoreHome += moved.runs;
        result = 'Home Run';
      }

      game.balls = 0;
      game.strikes = 0;
      game.batter = nextBatter(game.half);
    }

    if (game.outs >= 3) {
      game.outs = 0;
      game.balls = 0;
      game.strikes = 0;
      game.onFirst = false;
      game.onSecond = false;
      game.onThird = false;
      game.half = game.half === 'top' ? 'bottom' : 'top';
      if (game.half === 'top') game.inning += 1;
      game.pitcher = game.half === 'top' ? pitcherHome : pitcherAway;
      game.batter = game.half === 'top' ? battersAway[awayIndex] : battersHome[homeIndex];
      result = `${result} · Side retired`;
    }

    game.lastPitch = {
      pitchNumber: pitchCounter,
      pitchType,
      velocityMph,
      location,
      result,
      batSpeedMph,
      exitVelocityMph,
      launchAngleDeg,
      projectedDistanceFt,
    };

    set((s) => ({ game, history: [game.lastPitch, ...s.history].slice(0, 120) }));
  },
}));
