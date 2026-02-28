import type { BindingDefinition, BindingSchema, BindingType } from '../playout/vortexBindings';
import type { Layer } from '../../types/domain';

const ALLOWED_STAGE_SIZES = new Set(['1920x1080', '1080x1080', '1080x1350', '1080x1920']);
const SUPPORTED_TYPES = new Set(['TEXT', 'IMAGE', 'COLOR', 'NUMBER', 'GROUP']);
const SUPPORTED_NODES = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'image', 'text']);

const textEncoder = new TextEncoder();

export class IllustratorImportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IllustratorImportValidationError';
  }
}

export type IllustratorImportWarning = {
  code: 'unsupported-node' | 'unbound-text';
  message: string;
  layerName?: string;
};

export interface ImportManifestV1 {
  schemaVersion: '1.0.0';
  templateId: string;
  name: string;
  format: {
    width: number;
    height: number;
    formatId: string;
  };
  stageFormat: string;
  source: 'vortex';
  createdAt: string;
  engine: 'vortex';
  packageVersion: '1.0.0';
  templateName: string;
}

export interface IllustratorImportResult {
  scene: { layers: Layer[] };
  bindings: BindingSchema;
  manifest: ImportManifestV1;
  warnings: IllustratorImportWarning[];
  packageBlob: Blob;
}

type Matrix = [number, number, number, number, number, number];
const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

const multiply = (a: Matrix, b: Matrix): Matrix => {
  const [a1, b1, c1, d1, e1, f1] = a;
  const [a2, b2, c2, d2, e2, f2] = b;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
};

const apply = (matrix: Matrix, x: number, y: number): { x: number; y: number } => ({
  x: matrix[0] * x + matrix[2] * y + matrix[4],
  y: matrix[1] * x + matrix[3] * y + matrix[5],
});

const parseTransform = (value: string | null): Matrix => {
  if (!value) return IDENTITY_MATRIX;
  const opRegex = /(matrix|translate|scale|rotate)\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  let matrix = IDENTITY_MATRIX;

  while ((match = opRegex.exec(value))) {
    const op = match[1];
    const parts = match[2]
      .split(/[\s,]+/)
      .map((part) => Number(part.trim()))
      .filter((num) => Number.isFinite(num));

    let step: Matrix = IDENTITY_MATRIX;

    if (op === 'matrix' && parts.length === 6) {
      step = [parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]];
    } else if (op === 'translate') {
      step = [1, 0, 0, 1, parts[0] ?? 0, parts[1] ?? 0];
    } else if (op === 'scale') {
      const sx = parts[0] ?? 1;
      const sy = parts[1] ?? sx;
      step = [sx, 0, 0, sy, 0, 0];
    } else if (op === 'rotate') {
      const angle = ((parts[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      if (parts.length >= 3) {
        const [_, cx, cy] = parts;
        step = multiply(multiply([1, 0, 0, 1, cx, cy], [cos, sin, -sin, cos, 0, 0]), [1, 0, 0, 1, -cx, -cy]);
      } else {
        step = [cos, sin, -sin, cos, 0, 0];
      }
    }

    matrix = multiply(matrix, step);
  }

  return matrix;
};

const parseNumeric = (value: string | null | undefined, fallback: number): number => {
  if (!value) return fallback;
  const parsed = Number(value.replace(/px$/i, '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseBindingName = (rawName: string): { type: BindingType | 'group'; key: string; modifiers: Record<string, unknown> } | null => {
  const trimmed = rawName.trim();
  const typeSegment = trimmed.split('_', 1)[0];

  if (!SUPPORTED_TYPES.has(typeSegment)) {
    return null;
  }

  const core = trimmed.split('__');
  const typeAndKey = core[0].match(/^([A-Z]+)_([a-z0-9_]+)$/);
  if (!typeAndKey) {
    throw new IllustratorImportValidationError(`Invalid naming format: ${rawName}`);
  }

  const [, rawType, key] = typeAndKey;

  const modifiers: Record<string, unknown> = {};
  for (let i = 1; i < core.length; i += 1) {
    const token = core[i];
    const pair = token.match(/^([A-Za-z][A-Za-z0-9]*)=(.+)$/);
    if (!pair) {
      throw new IllustratorImportValidationError(`Invalid naming format: ${rawName}`);
    }
    const [, modifierKey, rawValue] = pair;
    if (rawValue === 'true') modifiers[modifierKey] = true;
    else if (rawValue === 'false') modifiers[modifierKey] = false;
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) modifiers[modifierKey] = Number(rawValue);
    else modifiers[modifierKey] = rawValue;
  }

  const type = rawType === 'GROUP' ? 'group' : rawType.toLowerCase() as BindingType;
  return { type, key, modifiers };
};

const hashText = async (value: string): Promise<string> => {
  const buffer = textEncoder.encode(value);
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const resolveTextAlign = (value: string | null): 'left' | 'center' | 'right' => {
  if (value === 'middle') return 'center';
  if (value === 'end') return 'right';
  return 'left';
};

const bboxFromPath = (d: string): { width: number; height: number } => {
  const numbers = d.match(/-?\d*\.?\d+/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (numbers.length < 4) return { width: 100, height: 100 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < numbers.length - 1; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return {
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
};

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = crc32Table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
};

const buildZip = (files: Array<{ name: string; content: string }>): Blob => {
  const entries = files.map((file) => {
    const nameBytes = textEncoder.encode(file.name);
    const data = textEncoder.encode(file.content);
    return { ...file, nameBytes, data, crc: crc32(data) };
  });

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  entries.forEach((entry) => {
    const local = new Uint8Array(30 + entry.nameBytes.length + entry.data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, 0, true);
    lv.setUint32(14, entry.crc, true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, entry.nameBytes.length, true);
    local.set(entry.nameBytes, 30);
    local.set(entry.data, 30 + entry.nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + entry.nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint32(16, entry.crc, true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, entry.nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(entry.nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const toArrayBuffer = (value: Uint8Array): ArrayBuffer => {
    const copy = new Uint8Array(value.byteLength);
    copy.set(value);
    return copy.buffer;
  };

  return new Blob(
    [...localParts.map(toArrayBuffer), ...centralParts.map(toArrayBuffer), toArrayBuffer(eocd)],
    { type: 'application/vnd.vortex.template+zip' },
  );
};

export const importIllustratorSvg = async (svgText: string, templateName = 'Illustrator Template'): Promise<IllustratorImportResult> => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new IllustratorImportValidationError('Invalid SVG markup.');
  }

  const svg = doc.documentElement;
  const width = parseNumeric(svg.getAttribute('width'), Number.NaN);
  const height = parseNumeric(svg.getAttribute('height'), Number.NaN);

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new IllustratorImportValidationError('SVG width/height must be explicit numeric values.');
  }

  const formatId = `${width}x${height}`;
  if (!ALLOWED_STAGE_SIZES.has(formatId)) {
    throw new IllustratorImportValidationError(`Stage size ${formatId} is not supported.`);
  }

  const warnings: IllustratorImportWarning[] = [];
  const layers: Layer[] = [];
  const bindings: BindingDefinition[] = [];
  const bindingKeys = new Set<string>();
  let zIndex = 0;

  const walk = async (node: Element, path: string, inheritedName = ''): Promise<void> => {
    const tag = node.tagName.toLowerCase();
    if (tag !== 'svg' && !SUPPORTED_NODES.has(tag)) {
      warnings.push({ code: 'unsupported-node', message: `Unsupported node <${tag}> ignored.`, layerName: node.getAttribute('id') ?? undefined });
      return;
    }

    const name = node.getAttribute('id') || node.getAttribute('inkscape:label') || node.getAttribute('data-name') || inheritedName;
    const bindingMeta = name ? parseBindingName(name) : null;
    const matrix = parseTransform(node.getAttribute('transform'));

    if (tag === 'g' || tag === 'svg') {
      const children = Array.from(node.children);
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        child.setAttribute('data-vortex-parent-transform', JSON.stringify(matrix));
        await walk(child, `${path}/${i}`, name);
      }
      return;
    }

    const parentTransformRaw = node.getAttribute('data-vortex-parent-transform');
    const parentTransform: Matrix = parentTransformRaw ? JSON.parse(parentTransformRaw) as Matrix : IDENTITY_MATRIX;
    const absoluteMatrix = multiply(parentTransform, matrix);

    const layerId = `layer-${await hashText(path)}`;
    const opacity = parseNumeric(node.getAttribute('opacity'), 1) * 100;
    const fill = node.getAttribute('fill') ?? '#ffffff';
    const anchor = apply(absoluteMatrix, 0, 0);

    if (bindingMeta && bindingMeta.type !== 'group') {
      if (bindingKeys.has(bindingMeta.key)) {
        throw new IllustratorImportValidationError(`Duplicate binding key: ${bindingMeta.key}`);
      }
      bindingKeys.add(bindingMeta.key);
      bindings.push({
        key: bindingMeta.key,
        type: bindingMeta.type,
        layerId,
        required: bindingMeta.modifiers.required === true,
        maxLines: typeof bindingMeta.modifiers.maxLines === 'number' ? bindingMeta.modifiers.maxLines : undefined,
      });
    }

    if (tag === 'rect' || tag === 'ellipse' || tag === 'circle' || tag === 'path') {
      const widthValue = tag === 'circle'
        ? parseNumeric(node.getAttribute('r'), 0) * 2
        : tag === 'ellipse'
          ? parseNumeric(node.getAttribute('rx'), 0) * 2
          : parseNumeric(node.getAttribute('width'), NaN);
      const heightValue = tag === 'circle'
        ? parseNumeric(node.getAttribute('r'), 0) * 2
        : tag === 'ellipse'
          ? parseNumeric(node.getAttribute('ry'), 0) * 2
          : parseNumeric(node.getAttribute('height'), NaN);
      const pathBounds = tag === 'path' ? bboxFromPath(node.getAttribute('d') ?? '') : null;

      layers.push({
        id: layerId,
        name: name || node.tagName,
        kind: 'shape',
        shapeType: tag === 'ellipse' || tag === 'circle' ? 'ellipse' : 'rectangle',
        x: anchor.x + parseNumeric(node.getAttribute('x'), 0),
        y: anchor.y + parseNumeric(node.getAttribute('y'), 0),
        width: Number.isFinite(widthValue) ? widthValue : pathBounds?.width ?? 100,
        height: Number.isFinite(heightValue) ? heightValue : pathBounds?.height ?? 100,
        fill,
        zIndex: zIndex++,
        opacity,
        anchorX: 0,
        anchorY: 0,
        scaleX: 100,
        scaleY: 100,
        rotation: 0,
        visible: true,
        locked: false,
      });
      return;
    }

    if (tag === 'image') {
      layers.push({
        id: layerId,
        name: name || 'image',
        kind: 'asset',
        x: anchor.x + parseNumeric(node.getAttribute('x'), 0),
        y: anchor.y + parseNumeric(node.getAttribute('y'), 0),
        width: parseNumeric(node.getAttribute('width'), 100),
        height: parseNumeric(node.getAttribute('height'), 100),
        assetId: node.getAttribute('href') || node.getAttribute('xlink:href') || '',
        zIndex: zIndex++,
        opacity,
        anchorX: 0,
        anchorY: 0,
        scaleX: 100,
        scaleY: 100,
        rotation: 0,
        visible: true,
        locked: false,
      });
      return;
    }

    if (tag === 'text') {
      const text = node.textContent?.trim() ?? '';
      if (!bindingMeta || bindingMeta.type !== 'text') {
        warnings.push({ code: 'unbound-text', message: `Unbound text node found: "${text}"`, layerName: name || undefined });
      }
      layers.push({
        id: layerId,
        name: name || 'text',
        kind: 'text',
        x: anchor.x + parseNumeric(node.getAttribute('x'), 0),
        y: anchor.y + parseNumeric(node.getAttribute('y'), 0),
        text,
        color: fill,
        size: parseNumeric(node.getAttribute('font-size'), 48),
        fontFamily: node.getAttribute('font-family') || 'Inter',
        dataBindingSource: bindingMeta?.type === 'text' ? 'vortex' : 'none',
        dataBindingField: bindingMeta?.type === 'text' ? bindingMeta.key : '',
        textAlign: resolveTextAlign(node.getAttribute('text-anchor')),
        textMode: 'point',
        zIndex: zIndex++,
        opacity,
        anchorX: 0,
        anchorY: 0,
        scaleX: 100,
        scaleY: 100,
        rotation: 0,
        visible: true,
        locked: false,
      });
      return;
    }
  };

  await walk(svg, 'root');

  const normalizedScene = { layers: [...layers].sort((a, b) => a.zIndex - b.zIndex) };
  const bindingsJson: BindingSchema = { bindings };
  const templateId = `tpl-${(await hashText(svgText)).slice(0, 24)}`;
  const createdSeed = Number.parseInt(templateId.slice(-8), 16);
  const createdAt = new Date(createdSeed * 1000).toISOString();
  const manifest: ImportManifestV1 = {
    schemaVersion: '1.0.0',
    templateId,
    name: templateName,
    format: {
      width,
      height,
      formatId,
    },
    stageFormat: formatId,
    source: 'vortex',
    createdAt,
    engine: 'vortex',
    packageVersion: '1.0.0',
    templateName,
  };

  const packageBlob = buildZip([
    { name: 'manifest.json', content: JSON.stringify(manifest, null, 2) },
    { name: 'scene.json', content: JSON.stringify(normalizedScene, null, 2) },
    { name: 'bindings.json', content: JSON.stringify(bindingsJson, null, 2) },
  ]);

  return {
    scene: normalizedScene,
    bindings: bindingsJson,
    manifest,
    warnings,
    packageBlob,
  };
};
