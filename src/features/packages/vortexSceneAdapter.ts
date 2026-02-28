import type { Layer } from '../../types/domain';
import type { VortexPackage } from './loadVortexPackage';
import { getManifestFormat } from './loadVortexPackage';

export type AdaptedVortexScene = {
  canvas: {
    width: number;
    height: number;
  };
  layers: Layer[];
};

const toNumber = (value: unknown, fallback: number): number => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

const mapLayer = (rawLayer: unknown, index: number): Layer => {
  const layer = (rawLayer && typeof rawLayer === 'object' ? rawLayer : {}) as Record<string, unknown>;
  const kindCandidate = layer.kind ?? layer.type;
  const kind = kindCandidate === 'text' || kindCandidate === 'shape' || kindCandidate === 'asset' ? kindCandidate : 'shape';

  const base = {
    id: typeof layer.id === 'string' ? layer.id : `vortex-layer-${index}`,
    name: typeof layer.name === 'string' ? layer.name : `Layer ${index + 1}`,
    x: toNumber(layer.x, 0),
    y: toNumber(layer.y, 0),
    zIndex: toNumber(layer.zIndex, index),
    opacity: toNumber(layer.opacity, 100),
    anchorX: toNumber(layer.anchorX, 0),
    anchorY: toNumber(layer.anchorY, 0),
    scaleX: toNumber(layer.scaleX, 100),
    scaleY: toNumber(layer.scaleY, 100),
    rotation: toNumber(layer.rotation, 0),
    visible: typeof layer.visible === 'boolean' ? layer.visible : true,
    locked: typeof layer.locked === 'boolean' ? layer.locked : false,
  };

  if (kind === 'text') {
    return {
      ...base,
      kind,
      text: typeof layer.text === 'string' ? layer.text : '',
      color: typeof layer.color === 'string' ? layer.color : '#ffffff',
      size: toNumber(layer.size, 48),
      fontFamily: typeof layer.fontFamily === 'string' ? layer.fontFamily : 'Inter',
      dataBindingSource: typeof layer.dataBindingSource === 'string' ? layer.dataBindingSource : 'none',
      dataBindingField: typeof layer.dataBindingField === 'string' ? layer.dataBindingField : '',
      textAlign: layer.textAlign === 'center' || layer.textAlign === 'right' ? layer.textAlign : 'left',
      textMode: layer.textMode === 'area' ? 'area' : 'point',
      width: typeof layer.width === 'number' ? layer.width : undefined,
      height: typeof layer.height === 'number' ? layer.height : undefined,
    };
  }

  if (kind === 'asset') {
    return {
      ...base,
      kind,
      assetId: typeof layer.assetId === 'string'
        ? layer.assetId
        : typeof layer.assetPath === 'string'
          ? layer.assetPath
          : '',
      width: toNumber(layer.width, 100),
      height: toNumber(layer.height, 100),
    };
  }

  return {
    ...base,
    kind: 'shape',
    shapeType: layer.shapeType === 'ellipse' ? 'ellipse' : 'rectangle',
    width: toNumber(layer.width, 100),
    height: toNumber(layer.height, 100),
    fill: typeof layer.fill === 'string' ? layer.fill : '#2563eb',
  };
};

export function sceneFromVortexPackage(pkg: VortexPackage): AdaptedVortexScene {
  const { width, height } = getManifestFormat(pkg.manifest);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Invalid canvas format in package manifest.');
  }

  const rawScene = pkg.scene as { layers?: unknown } | unknown[];
  const rawLayers = Array.isArray(rawScene)
    ? rawScene
    : rawScene && typeof rawScene === 'object'
      ? (rawScene as { layers?: unknown }).layers
      : undefined;

  if (!Array.isArray(rawLayers)) {
    throw new Error('Invalid scene.json: expected a layers array.');
  }

  return {
    canvas: { width, height },
    layers: rawLayers.map(mapLayer),
  };
}
