import { createDefaultPitch, formatClock } from '../core';
import type { SimulatorPlugin } from '../types';

const QUARTER_SECONDS = 12 * 60;
type NbaCategory = '2pt-made' | '3pt-made' | 'miss' | 'rebound-off' | 'rebound-def' | 'turnover' | 'foul' | 'free-throws' | 'timeout';
let recent: NbaCategory[] = [];

const pick = <T,>(arr: T[], r: () => number) => arr[Math.floor(r() * arr.length)];
const choose = (weights: Record<NbaCategory, number>, rand: () => number) => {
  const last = recent[recent.length - 1];
  const uniq = new Set(recent.slice(-6));
  const force = recent.length >= 5 && uniq.size < 3;
  const entries = (Object.entries(weights) as Array<[NbaCategory, number]>).filter(([k, w]) => w > 0 && k !== last && (!force || !uniq.has(k)));
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let roll = rand() * total;
  for (const [k, w] of entries) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return 'miss';
};

export const nbaSimulator: SimulatorPlugin = {
  key: 'nba',
  label: 'NBA',
  createInitialGame: () => {
    recent = [];
    return {
      sport: 'nba', homeTeam: 'LAL', awayTeam: 'BOS', scoreHome: 0, scoreAway: 0,
      period: 1, periodLabel: 'Q1', clockSeconds: QUARTER_SECONDS, possession: 'away', lastEvent: 'Tip-off won by BOS.',
      inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, onFirst: false, onSecond: false, onThird: false,
      pitcher: '', batter: '', lastPitch: createDefaultPitch(),
    };
  },
  step: (previous, ctx, control) => {
    const game = structuredClone(previous);
    game.clockSeconds = Math.max(0, game.clockSeconds - ctx.randomInt(5, 24));

    if (game.clockSeconds <= 0 && game.period < 4) {
      game.period += 1;
      game.periodLabel = `Q${game.period}`;
      game.clockSeconds = QUARTER_SECONDS;
      game.lastEvent = `${game.periodLabel} starts`; 
    } else {
      const w: Record<NbaCategory, number> = { '2pt-made': 20, '3pt-made': 12, miss: 18, 'rebound-off': 9, 'rebound-def': 14, turnover: 10, foul: 8, 'free-throws': 6, timeout: 3 };
      if (control.scenario === 'shootout') { w['2pt-made'] += 6; w['3pt-made'] += 8; w.miss -= 6; }
      if (control.scenario === 'defensive-battle') { w.miss += 8; w.turnover += 6; w['rebound-def'] += 5; }
      if (control.scenario === 'rivalry-chaos') { w.foul += 10; w.turnover += 10; }
      if (control.trigger === 'force-score') { w['2pt-made'] += 14; w['3pt-made'] += 10; w['free-throws'] += 8; }
      if (control.trigger === 'force-turnover') { w.turnover += 25; }
      if (control.trigger === 'force-penalty') { w.foul += 25; w['free-throws'] += 12; }
      if (control.trigger === 'force-big-play') { w['3pt-made'] += 24; }

      if (control.scenario === 'comeback') {
        game.possession = game.scoreHome < game.scoreAway ? 'home' : game.scoreAway < game.scoreHome ? 'away' : game.possession;
      }

      const team = game.possession ?? 'home';
      const tName = team === 'home' ? game.homeTeam : game.awayTeam;
      const other = team === 'home' ? 'away' : 'home';
      const category = choose(w, ctx.random);
      let text = '';
      if (category === '2pt-made') {
        if (team === 'home') game.scoreHome += 2; else game.scoreAway += 2;
        text = `${tName} 2PT made in traffic`;
      } else if (category === '3pt-made') {
        if (team === 'home') game.scoreHome += 3; else game.scoreAway += 3;
        text = `${tName} buries a transition 3`;
      } else if (category === 'turnover') {
        text = `${tName} turnover on a bad pass`;
      } else if (category === 'foul') {
        text = `${tName} commits a shooting foul`;
      } else if (category === 'free-throws') {
        const made = ctx.randomInt(1, 2);
        if (team === 'home') game.scoreHome += made; else game.scoreAway += made;
        text = `${tName} hits ${made}/2 free throws`;
      } else if (category === 'timeout') {
        text = `${tName} timeout to set defense`;
      } else {
        const rebound = ctx.random() < 0.42 ? 'rebound-off' : 'rebound-def';
        text = `${tName} misses a jumper, ${rebound === 'rebound-off' ? tName : other === 'home' ? game.homeTeam : game.awayTeam} secures ${rebound === 'rebound-off' ? 'offensive' : 'defensive'} rebound`;
      }
      game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${text}`;
      game.possession = other;
      recent.push(category);
      if (recent.length > 6) recent.shift();
    }

    return { game, event: { id: ctx.nextId(), summary: game.lastEvent, periodLabel: game.periodLabel, clockLabel: formatClock(game.clockSeconds), scoreHome: game.scoreHome, scoreAway: game.scoreAway } };
  },
};
