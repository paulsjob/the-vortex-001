import { createDefaultPitch, formatClock } from '../core';
import type { SimulatorPlugin } from '../types';

const PERIOD_SECONDS = 20 * 60;
type NhlCategory = 'shot' | 'save' | 'goal' | 'penalty' | 'pp-start' | 'pp-end' | 'faceoff' | 'turnover';
let recent: NhlCategory[] = [];
let powerPlay: { team: 'home' | 'away'; seconds: number } | null = null;

export const nhlSimulator: SimulatorPlugin = {
  key: 'nhl',
  label: 'NHL',
  createInitialGame: () => {
    recent = [];
    powerPlay = null;
    return {
      sport: 'nhl', homeTeam: 'NYR', awayTeam: 'TOR', scoreHome: 0, scoreAway: 0,
      period: 1, periodLabel: 'P1', clockSeconds: PERIOD_SECONDS, possession: 'away', lastEvent: 'Puck dropped at center ice.',
      inning: 1, half: 'top', balls: 0, strikes: 0, outs: 0, onFirst: false, onSecond: false, onThird: false,
      pitcher: '', batter: '', lastPitch: createDefaultPitch(),
    };
  },
  step: (previous, ctx, control) => {
    const game = structuredClone(previous);
    const elapsed = ctx.randomInt(8, 28);
    game.clockSeconds = Math.max(0, game.clockSeconds - elapsed);
    if (powerPlay) powerPlay.seconds = Math.max(0, powerPlay.seconds - elapsed);

    if (game.clockSeconds <= 0 && game.period < 3) {
      game.period += 1;
      game.periodLabel = `P${game.period}`;
      game.clockSeconds = PERIOD_SECONDS;
      game.lastEvent = `${game.periodLabel} begins`;
    } else {
      const team = game.possession === 'home' ? 'home' : 'away';
      const tName = team === 'home' ? game.homeTeam : game.awayTeam;
      const dName = team === 'home' ? game.awayTeam : game.homeTeam;

      if (powerPlay?.seconds === 0) {
        game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · Power play ends, teams back at full strength`;
        powerPlay = null;
        recent.push('pp-end');
      } else {
        let cat: NhlCategory = 'shot';
        const r = ctx.random();
        if (control.trigger === 'force-penalty' || r < 0.12) cat = 'penalty';
        else if (control.trigger === 'force-turnover' || r < 0.24) cat = 'turnover';
        else if (control.trigger === 'force-score' || (control.scenario === 'shootout' && r < 0.42) || r < 0.3) cat = 'goal';
        else if (r < 0.75) cat = 'shot';
        else cat = 'faceoff';

        if (cat === recent[recent.length - 1]) cat = 'save';

        if (cat === 'penalty') {
          powerPlay = { team: team === 'home' ? 'away' : 'home', seconds: 120 };
          game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${tName} takes a 2-min minor, ${dName} to power play`;
          recent.push('penalty', 'pp-start');
        } else if (cat === 'turnover') {
          game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${tName} turns it over at the blue line`;
          game.possession = team === 'home' ? 'away' : 'home';
          recent.push(cat);
        } else if (cat === 'goal') {
          if (team === 'home') game.scoreHome += 1; else game.scoreAway += 1;
          game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${tName} shot on goal beats the goalie for a goal`;
          game.possession = team === 'home' ? 'away' : 'home';
          recent.push('shot', 'goal');
        } else if (cat === 'shot') {
          game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${tName} shot on goal, ${dName} goalie makes the save`;
          recent.push('shot', 'save');
        } else if (cat === 'faceoff') {
          game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${tName} wins the offensive-zone faceoff`;
          recent.push(cat);
        } else {
          game.lastEvent = `${game.periodLabel} ${formatClock(game.clockSeconds)} · ${dName} makes a routine save`;
          recent.push(cat);
        }
      }
      if (recent.length > 6) recent = recent.slice(-6);
    }

    return { game, event: { id: ctx.nextId(), summary: game.lastEvent, periodLabel: game.periodLabel, clockLabel: formatClock(game.clockSeconds), scoreHome: game.scoreHome, scoreAway: game.scoreAway } };
  },
};
