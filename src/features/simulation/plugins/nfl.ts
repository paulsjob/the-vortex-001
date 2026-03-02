import { createDefaultPitch, formatClock } from '../core';
import type { GameState, SimulationTrigger, SimulatorPlugin, StepControl } from '../types';

const QUARTER_SECONDS = 15 * 60;

type NflCategory =
  | 'run' | 'short-pass' | 'deep-pass' | 'sack' | 'scramble' | 'penalty' | 'punt' | 'field-goal' | 'touchdown'
  | 'interception' | 'fumble' | 'turnover-downs' | 'timeout' | 'quarter-end';

interface NflDriveState {
  down: 1 | 2 | 3 | 4;
  distance: number;
  yardline: number;
  possession: 'home' | 'away';
  recent: NflCategory[];
}

let drive: NflDriveState;

const startDrive = (possession: 'home' | 'away') => {
  drive = { down: 1, distance: 10, yardline: 25, possession, recent: drive?.recent ?? [] };
};

const clockStamp = (seconds: number) => formatClock(seconds);
const downLabel = (d: number) => (d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : '4th');

const applyScenario = (weights: Record<NflCategory, number>, scenario: StepControl['scenario']) => {
  if (scenario === 'shootout') {
    weights['deep-pass'] += 10; weights.touchdown += 8; weights['field-goal'] += 4; weights.punt -= 6;
  } else if (scenario === 'defensive-battle') {
    weights.sack += 8; weights.punt += 12; weights['field-goal'] += 5; weights.touchdown -= 8;
  } else if (scenario === 'rivalry-chaos') {
    weights.penalty += 12; weights.fumble += 6; weights.interception += 6;
  }
};

const chooseCategory = (weights: Record<NflCategory, number>, recent: NflCategory[], random: () => number) => {
  const unique = new Set(recent.slice(-6));
  const needDiversity = recent.length >= 5 && unique.size < 3;
  const last = recent[recent.length - 1];
  const entries = (Object.keys(weights) as NflCategory[])
    .filter((k) => k !== 'quarter-end')
    .filter((k) => k !== last)
    .filter((k) => (needDiversity ? !unique.has(k) : true))
    .map((k) => [k, Math.max(0, weights[k])] as const)
    .filter(([, w]) => w > 0);
  const total = entries.reduce((acc, [, w]) => acc + w, 0);
  let roll = random() * total;
  for (const [k, w] of entries) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return entries[0]?.[0] ?? 'run';
};

const flipPossession = () => {
  drive.possession = drive.possession === 'home' ? 'away' : 'home';
  drive.down = 1;
  drive.distance = 10;
  drive.yardline = 25;
};

const runOnePlay = (game: GameState, category: NflCategory, trigger: SimulationTrigger | null, rand: () => number) => {
  let summary = '';
  const offense = drive.possession;
  const offenseTeam = offense === 'home' ? game.homeTeam : game.awayTeam;
  const defTeam = offense === 'home' ? game.awayTeam : game.homeTeam;
  let driveEnded = false;

  if (category === 'turnover-downs') {
    summary = `${offenseTeam} stopped on 4th down`;
    flipPossession();
    driveEnded = true;
  } else if (category === 'timeout') {
    summary = `${offenseTeam} timeout to settle the offense`;
  } else if (category === 'penalty') {
    const yards = [5, 10, 15][Math.floor(rand() * 3)];
    const againstDefense = rand() > 0.4;
    drive.yardline = Math.max(1, Math.min(99, drive.yardline + (againstDefense ? yards : -yards)));
    drive.distance = Math.max(1, drive.distance + (againstDefense ? -yards : yards));
    summary = `${yards}yd penalty ${againstDefense ? 'on defense' : 'on offense'}`;
  } else if (category === 'punt') {
    summary = `${offenseTeam} punts ${Math.floor(35 + rand() * 25)}yd to ${defTeam}`;
    flipPossession();
    driveEnded = true;
  } else if (category === 'field-goal') {
    const good = trigger === 'force-score' || Math.random() < 0.7;
    if (good) {
      if (offense === 'home') game.scoreHome += 3;
      else game.scoreAway += 3;
      summary = `${offenseTeam} ${Math.floor(28 + rand() * 30)}yd field goal is good`;
    } else {
      summary = `${offenseTeam} field goal attempt misses wide right`;
    }
    flipPossession();
    driveEnded = true;
  } else if (category === 'touchdown') {
    if (offense === 'home') game.scoreHome += 7;
    else game.scoreAway += 7;
    summary = `${offenseTeam} touchdown drive finished in the red zone`;
    flipPossession();
    driveEnded = true;
  } else if (category === 'interception') {
    summary = `${offenseTeam} pass intercepted by ${defTeam}`;
    flipPossession();
    driveEnded = true;
  } else if (category === 'fumble') {
    summary = `${offenseTeam} fumbles, ${defTeam} recovers`;
    flipPossession();
    driveEnded = true;
  } else {
    const gains: Record<NflCategory, [number, number]> = {
      run: [0, 15], 'short-pass': [2, 14], 'deep-pass': [8, 35], sack: [-11, -2], scramble: [1, 18],
      penalty: [0, 0], punt: [0, 0], 'field-goal': [0, 0], touchdown: [0, 0], interception: [0, 0], fumble: [0, 0], 'turnover-downs': [0, 0], timeout: [0, 0], 'quarter-end': [0, 0],
    };
    const [min, max] = gains[category];
    const gain = Math.floor(min + rand() * (max - min + 1));
    drive.yardline = Math.max(1, Math.min(99, drive.yardline + gain));
    drive.distance -= gain;
    summary = `${offenseTeam} ${Math.abs(gain)}yd ${category === 'run' ? 'run' : category === 'scramble' ? 'scramble' : category === 'sack' ? 'sack allowed' : 'pass play'}${gain < 0 ? ' loss' : ''}`;

    if (drive.yardline >= 100 || (trigger === 'force-score' && gain >= 8)) {
      if (offense === 'home') game.scoreHome += 7;
      else game.scoreAway += 7;
      summary = `${offenseTeam} breaks free for a touchdown`;
      flipPossession();
      driveEnded = true;
    } else if (drive.distance <= 0) {
      drive.down = 1;
      drive.distance = 10;
    } else {
      drive.down = (Math.min(4, drive.down + 1) as 1 | 2 | 3 | 4);
      if (drive.down > 4) drive.down = 4;
      if (drive.down === 4 && drive.distance > 4 && rand() < 0.55) {
        summary = `${offenseTeam} turned away on 4th down`;
        flipPossession();
        driveEnded = true;
      } else if (drive.down === 4 && drive.distance > 10 && rand() < 0.75) {
        summary = `${offenseTeam} goes nowhere on 4th down`;
        flipPossession();
        driveEnded = true;
      }
    }
  }

  game.possession = drive.possession;
  const ctxDown = `${downLabel(drive.down)} & ${drive.distance} at ${defTeam} ${Math.max(1, 100 - drive.yardline)}`;
  if (driveEnded) startDrive(drive.possession);
  return `${summary} (${ctxDown}) ${game.awayTeam} ${game.scoreAway}-${game.scoreHome} ${game.homeTeam}`;
};

export const nflSimulator: SimulatorPlugin = {
  key: 'nfl',
  label: 'NFL',
  createInitialGame: () => {
    startDrive('away');
    return {
      sport: 'nfl', homeTeam: 'KC', awayTeam: 'BUF', scoreHome: 0, scoreAway: 0,
      period: 1, periodLabel: 'Q1', clockSeconds: QUARTER_SECONDS, possession: 'away', lastEvent: 'Kickoff from BUF to KC.',
      inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, onFirst: false, onSecond: false, onThird: false,
      pitcher: '', batter: '', lastPitch: createDefaultPitch(),
    };
  },
  step: (previous, ctx, control) => {
    const game = structuredClone(previous);
    game.clockSeconds = Math.max(0, game.clockSeconds - ctx.randomInt(18, 42));

    if (game.clockSeconds === 0) {
      if (game.period < 4) {
        game.period += 1;
        game.periodLabel = `Q${game.period}`;
        game.clockSeconds = QUARTER_SECONDS;
        game.lastEvent = `${game.periodLabel} begins after end of quarter`;
        drive.recent.push('quarter-end');
      }
    } else {
      const weights: Record<NflCategory, number> = {
        run: 18, 'short-pass': 17, 'deep-pass': 10, sack: 6, scramble: 8, penalty: 7,
        punt: drive.down === 4 ? 16 : 2, 'field-goal': drive.yardline > 60 ? 8 : 2, touchdown: drive.yardline > 75 ? 8 : 2,
        interception: 5, fumble: 4, 'turnover-downs': drive.down === 4 ? 7 : 1, timeout: 4, 'quarter-end': 0,
      };

      applyScenario(weights, control.scenario);
      if (control.trigger === 'force-turnover') {
        weights.interception += 20; weights.fumble += 14; weights['turnover-downs'] += 10;
      } else if (control.trigger === 'force-penalty') {
        weights.penalty += 24;
      } else if (control.trigger === 'force-big-play') {
        weights['deep-pass'] += 20; weights.touchdown += 10;
      } else if (control.trigger === 'force-score') {
        weights.touchdown += 16; weights['field-goal'] += 12;
      }

      if (control.scenario === 'comeback') {
        const trail = game.scoreHome === game.scoreAway ? drive.possession : game.scoreHome < game.scoreAway ? 'home' : 'away';
        drive.possession = trail;
      }

      const category = chooseCategory(weights, drive.recent, ctx.random);
      game.lastEvent = `${game.periodLabel} ${clockStamp(game.clockSeconds)} · ${runOnePlay(game, category, control.trigger, ctx.random)}`;
      drive.recent.push(category);
      if (drive.recent.length > 6) drive.recent.shift();
    }

    return {
      game,
      event: { id: ctx.nextId(), summary: game.lastEvent, periodLabel: game.periodLabel, clockLabel: formatClock(game.clockSeconds), scoreHome: game.scoreHome, scoreAway: game.scoreAway },
    };
  },
};
