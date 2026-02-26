import { useMemo } from 'react';
import { useAssetStore } from '../../store/useAssetStore';
import type { Layer } from '../../types/domain';
import type { SavedTemplate } from '../../store/useTemplateStore';
import { useDataEngineStore } from '../../store/useDataEngineStore';
import { getLiveTextContent } from './liveBindings';

type Props = {
  template: SavedTemplate;
  className?: string;
};

const DEFAULT_TRANSFORM = {
  anchorX: 0,
  anchorY: 0,
  scaleX: 100,
  scaleY: 100,
  rotation: 0,
};

export function TemplateSceneSvg({ template, className }: Props) {
  const assets = useAssetStore((s) => s.assets);
  const game = useDataEngineStore((s) => s.game);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const renderLayer = (layer: Layer) => {
    const opacity = (layer.opacity ?? 100) / 100;
    const anchorX = layer.anchorX ?? DEFAULT_TRANSFORM.anchorX;
    const anchorY = layer.anchorY ?? DEFAULT_TRANSFORM.anchorY;
    const scaleX = (layer.scaleX ?? DEFAULT_TRANSFORM.scaleX) / 100;
    const scaleY = (layer.scaleY ?? DEFAULT_TRANSFORM.scaleY) / 100;
    const rotation = layer.rotation ?? DEFAULT_TRANSFORM.rotation;

    const transform = `translate(${layer.x} ${layer.y}) rotate(${rotation}) scale(${scaleX} ${scaleY}) translate(${-anchorX} ${-anchorY})`;

    if (layer.kind === 'text') {
      const textValue = getLiveTextContent(layer, game) || ' ';
      const textAnchor = layer.textAlign === 'center' ? 'middle' : layer.textAlign === 'right' ? 'end' : 'start';
      const textX = layer.textAlign === 'center' ? anchorX : layer.textAlign === 'right' ? anchorX * 2 : 0;
      return (
        <g key={layer.id} transform={transform} opacity={opacity}>
          <text
            x={textX}
            y={0}
            fill={layer.color}
            fontSize={layer.size}
            fontFamily={layer.fontFamily}
            fontWeight="700"
            dominantBaseline="hanging"
            textAnchor={textAnchor}
          >
            {textValue}
          </text>
        </g>
      );
    }

    if (layer.kind === 'shape') {
      return (
        <g key={layer.id} transform={transform} opacity={opacity}>
          {layer.shapeType === 'ellipse' ? (
            <ellipse
              cx={Math.max(1, layer.width / 2)}
              cy={Math.max(1, layer.height / 2)}
              rx={Math.max(1, layer.width / 2)}
              ry={Math.max(1, layer.height / 2)}
              fill={layer.fill}
            />
          ) : (
            <rect x={0} y={0} width={layer.width} height={layer.height} fill={layer.fill} />
          )}
        </g>
      );
    }

    const asset = assetById.get(layer.assetId);
    return (
      <g key={layer.id} transform={transform} opacity={opacity}>
        {asset ? (
          <image
            href={asset.src}
            x={0}
            y={0}
            width={layer.width}
            height={layer.height}
            preserveAspectRatio="xMidYMid meet"
          />
        ) : (
          <g>
            <rect width={layer.width} height={layer.height} fill="rgba(120,53,15,0.7)" stroke="rgb(245,158,11)" strokeDasharray="10 8" />
            <text x={8} y={8} fill="rgb(254,243,199)" fontSize={18} fontWeight="700" dominantBaseline="hanging">
              Missing asset
            </text>
          </g>
        )}
      </g>
    );
  };

  return (
    <svg
      viewBox={`0 0 ${template.canvasWidth} ${template.canvasHeight}`}
      className={className}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Template scene"
    >
      {[...template.layers]
        .filter((layer) => layer.visible !== false)
        .sort((a, b) => a.zIndex - b.zIndex)
        .map(renderLayer)}
    </svg>
  );
}
