import type { Layer } from '../../types/domain';
import type { GameState } from '../../store/useDataEngineStore';

export const resolveBindingValue = (game: GameState, field: string): string => {
  const map: Record<string, string> = {
    'score.home': String(game.scoreHome),
    'score.away': String(game.scoreAway),
    'inning.number': String(game.inning),
    'inning.state': game.half,
    'count.balls': String(game.balls),
    'count.strikes': String(game.strikes),
    'count.outs': String(game.outs),
    'runners.first': game.onFirst ? 'On' : 'Off',
    'runners.second': game.onSecond ? 'On' : 'Off',
    'runners.third': game.onThird ? 'On' : 'Off',
    'pitch.type': game.lastPitch.pitchType,
    'pitch.velocity': String(game.lastPitch.velocityMph),
    'pitch.location': game.lastPitch.location,
    'bat.batspeed': String(game.lastPitch.batSpeedMph ?? '-'),
    'bat.exitvelo': String(game.lastPitch.exitVelocityMph ?? '-'),
    'bat.launchangle': String(game.lastPitch.launchAngleDeg ?? '-'),
    'bat.distance': String(game.lastPitch.projectedDistanceFt ?? '-'),
    'matchup.pitcher': game.pitcher,
    'matchup.batter': game.batter,
  };
  return map[field] ?? '';
};

export const getLiveTextContent = (layer: Extract<Layer, { kind: 'text' }>, game: GameState): string => {
  if (layer.dataBindingSource === 'manual') return layer.text;
  return resolveBindingValue(game, layer.dataBindingField) || layer.text;
};
