import { createDefaultPitch, formatClock } from '../core';
import type { SimulatorPlugin } from '../types';

const HALF_SECONDS = 45 * 60;
type MlsCategory = 'pass-seq' | 'build-up' | 'shot' | 'save' | 'goal' | 'foul' | 'yellow' | 'red' | 'corner' | 'offside' | 'sub';
let recent: MlsCategory[] = [];

export const mlsSimulator: SimulatorPlugin = {
  key: 'mls',
  label: 'MLS',
  createInitialGame: () => {
    recent = [];
    return {
      sport: 'mls', homeTeam: 'MIA', awayTeam: 'SEA', scoreHome: 0, scoreAway: 0,
      period: 1, periodLabel: '1H', clockSeconds: 0, possession: 'home', lastEvent: 'Kickoff at midfield.',
      inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, onFirst: false, onSecond: false, onThird: false,
      pitcher: '', batter: '', lastPitch: createDefaultPitch(),
    };
  },
  step: (previous, ctx, control) => {
    const game = structuredClone(previous);
    game.clockSeconds = Math.min(HALF_SECONDS * 2, game.clockSeconds + ctx.randomInt(12, 38));
    if (game.clockSeconds >= HALF_SECONDS && game.period === 1) {
      game.period = 2;
      game.periodLabel = '2H';
    }

    const side = game.possession === 'home' ? 'home' : 'away';
    const name = side === 'home' ? game.homeTeam : game.awayTeam;
    const opp = side === 'home' ? game.awayTeam : game.homeTeam;

    let cat: MlsCategory = 'build-up';
    const r = ctx.random();
    if (control.trigger === 'force-score' || (control.scenario === 'shootout' && r < 0.35) || r < 0.1) cat = 'goal';
    else if (control.trigger === 'force-penalty' || r < 0.2) cat = 'foul';
    else if (control.trigger === 'force-big-play' || r < 0.32) cat = 'shot';
    else if (control.trigger === 'force-turnover' || r < 0.42) cat = 'offside';
    else if (r < 0.55) cat = 'pass-seq';
    else if (r < 0.68) cat = 'corner';
    else if (r < 0.78) cat = 'sub';
    else cat = 'build-up';

    if (cat === recent[recent.length - 1]) cat = cat === 'build-up' ? 'pass-seq' : 'build-up';

    if (cat === 'goal') {
      if (side === 'home') game.scoreHome += 1; else game.scoreAway += 1;
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} shot curls inside the post for a goal`;
    } else if (cat === 'shot') {
      const goal = ctx.random() < 0.28;
      if (goal) {
        if (side === 'home') game.scoreHome += 1; else game.scoreAway += 1;
        game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} shot from the edge of box, goal`;
        recent.push('shot', 'goal');
      } else {
        game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} shot on target, ${opp} keeper makes the save`;
        recent.push('shot', 'save');
      }
    } else if (cat === 'foul') {
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} foul in midfield, free kick conceded`;
      if (ctx.random() < 0.4) {
        game.lastEvent += ctx.random() < 0.95 ? ' (yellow card)' : ' (red card)';
      }
    } else if (cat === 'offside') {
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} flagged offside on the through ball`;
    } else if (cat === 'corner') {
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} wins a corner after sustained build-up`;
    } else if (cat === 'sub') {
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} makes a tactical substitution`;
    } else if (cat === 'pass-seq') {
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} strings together a 9-pass sequence`;
    } else {
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${name} patient build-up through midfield`;
    }

    game.possession = game.possession === 'home' ? 'away' : 'home';
    recent.push(cat);
    if (recent.length > 6) recent = recent.slice(-6);

    return { game, event: { id: ctx.nextId(), summary: game.lastEvent, periodLabel: game.periodLabel, clockLabel: formatClock(game.clockSeconds), scoreHome: game.scoreHome, scoreAway: game.scoreAway } };
  },
};
