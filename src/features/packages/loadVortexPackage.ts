import type { BindingSchema } from '../playout/vortexBindings';

export interface ManifestV1 {
  packageVersion: string;
  templateId: string;
  templateName: string;
  format: {
    width: number;
    height: number;
    formatId: string;
    [key: string]: unknown;
  } | string;
  formatDetail?: {
    width: number;
    height: number;
    formatId: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type BindingsV1 = BindingSchema;

export interface VortexPackage {
  manifest: ManifestV1;
  scene: any;
  bindings: BindingsV1;
  files: {
    assets: Record<string, Blob>;
    fonts: Record<string, Blob>;
    previews: Record<string, Blob>;
    checksums?: any;
  };
}

export const getManifestFormat = (manifest: ManifestV1): { width: number; height: number; formatId: string } => {
  if (typeof manifest.format === 'object' && manifest.format) {
    return {
      width: manifest.format.width,
      height: manifest.format.height,
      formatId: manifest.format.formatId,
    };
  }

  if (manifest.formatDetail) {
    return {
      width: manifest.formatDetail.width,
      height: manifest.formatDetail.height,
      formatId: manifest.formatDetail.formatId,
    };
  }

  throw new VortexPackageError('Invalid manifest.json: missing format object');
};

interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

const REQUIRED_FILES = ['manifest.json', 'scene.json', 'bindings.json'] as const;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export class VortexPackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VortexPackageError';
  }
}

const toArrayBuffer = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

const inflateRaw = async (data: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream === 'undefined') {
    throw new VortexPackageError('This environment does not support deflate decompression for .vortex packages');
  }

  const stream = new Blob([toArrayBuffer(data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const inflatedBuffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(inflatedBuffer);
};

const parseZipEntries = (bytes: Uint8Array): ZipEntry[] => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let eocdOffset = -1;
  const minimumEocdLength = 22;
  const maxCommentLength = 65535;
  const searchStart = Math.max(0, bytes.length - minimumEocdLength - maxCommentLength);

  for (let i = bytes.length - minimumEocdLength; i >= searchStart; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new VortexPackageError('Could not open .vortex package as zip: End of central directory not found');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  if (centralDirOffset === 0xffffffff || centralDirSize === 0xffffffff || totalEntries === 0xffff) {
    throw new VortexPackageError('Zip64 .vortex packages are not supported');
  }

  const entries: ZipEntry[] = [];
  let cursor = centralDirOffset;
  const decoder = new TextDecoder('utf-8');

  for (let index = 0; index < totalEntries; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new VortexPackageError('Could not open .vortex package as zip: Invalid central directory header');
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new VortexPackageError('Zip64 .vortex packages are not supported');
    }

    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    const nameBytes = bytes.subarray(fileNameStart, fileNameEnd);
    const name = decoder.decode(nameBytes);

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    });

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
};

const extractEntryBytes = async (bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerOffset = entry.localHeaderOffset;

  if (view.getUint32(headerOffset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new VortexPackageError(`Could not read zip entry ${entry.name}: invalid local file header`);
  }

  const fileNameLength = view.getUint16(headerOffset + 26, true);
  const extraFieldLength = view.getUint16(headerOffset + 28, true);
  const dataOffset = headerOffset + 30 + fileNameLength + extraFieldLength;
  const compressedData = bytes.subarray(dataOffset, dataOffset + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressedData;
  }

  if (entry.compressionMethod === 8) {
    const inflated = await inflateRaw(compressedData);

    if (entry.uncompressedSize !== 0 && inflated.byteLength !== entry.uncompressedSize) {
      throw new VortexPackageError(`Could not read zip entry ${entry.name}: decompressed size mismatch`);
    }

    return inflated;
  }

  throw new VortexPackageError(
    `Could not read zip entry ${entry.name}: unsupported compression method ${entry.compressionMethod}`,
  );
};

const parseEntryJson = async <T>(entries: Map<string, ZipEntry>, bytes: Uint8Array, fileName: string): Promise<T> => {
  const entry = entries.get(fileName);

  if (!entry) {
    throw new VortexPackageError(`Missing required file: ${fileName}`);
  }

  const entryBytes = await extractEntryBytes(bytes, entry);
  const raw = new TextDecoder('utf-8').decode(entryBytes);

  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const parseError = error instanceof Error ? error.message : String(error);
    throw new VortexPackageError(`Invalid JSON in ${fileName}: ${parseError}`);
  }
};

const collectFolderFiles = async (
  entries: Map<string, ZipEntry>,
  bytes: Uint8Array,
  prefix: string,
): Promise<Record<string, Blob>> => {
  const files: Record<string, Blob> = {};

  for (const [path, entry] of entries) {
    if (entry.isDirectory || !path.startsWith(prefix)) {
      continue;
    }

    const entryBytes = await extractEntryBytes(bytes, entry);
    files[path] = new Blob([toArrayBuffer(entryBytes)]);
  }

  return files;
};

function assertManifest(manifest: unknown): asserts manifest is ManifestV1 {
  if (!manifest || typeof manifest !== 'object') {
    throw new VortexPackageError('Invalid manifest.json: expected an object at root');
  }

  const value = manifest as Record<string, unknown>;

  if (!value.packageVersion) {
    throw new VortexPackageError('Invalid manifest.json: missing packageVersion');
  }

  if (!value.templateId) {
    throw new VortexPackageError('Invalid manifest.json: missing templateId');
  }

  if (!value.templateName) {
    throw new VortexPackageError('Invalid manifest.json: missing templateName');
  }

  const format = (typeof value.format === 'object' && value.format !== null
    ? value.format
    : typeof value.formatDetail === 'object' && value.formatDetail !== null
      ? value.formatDetail
      : null) as Record<string, unknown> | null;

  if (!format) {
    throw new VortexPackageError('Invalid manifest.json: missing format object');
  }

  if (typeof format.width !== 'number') {
    throw new VortexPackageError('Invalid manifest.json: format.width must be a number');
  }

  if (typeof format.height !== 'number') {
    throw new VortexPackageError('Invalid manifest.json: format.height must be a number');
  }

  if (!format.formatId) {
    throw new VortexPackageError('Invalid manifest.json: missing format.formatId');
  }

  if (typeof value.format === 'string') {
    value.format = {
      width: format.width,
      height: format.height,
      formatId: format.formatId,
    };
  }
}

export const loadVortexPackage = async (file: File): Promise<VortexPackage> => {
  const fileBuffer = await file.arrayBuffer();
  const fileBytes = new Uint8Array(fileBuffer);
  const zipEntries = parseZipEntries(fileBytes);
  const entriesByPath = new Map(zipEntries.map((entry) => [entry.name, entry]));

  const missingFiles = REQUIRED_FILES.filter((requiredFile) => !entriesByPath.has(requiredFile));
  if (missingFiles.length > 0) {
    throw new VortexPackageError(`Missing required file(s): ${missingFiles.join(', ')}`);
  }

  const manifest = await parseEntryJson<ManifestV1>(entriesByPath, fileBytes, 'manifest.json');
  const scene = await parseEntryJson<any>(entriesByPath, fileBytes, 'scene.json');
  const bindings = await parseEntryJson<BindingsV1>(entriesByPath, fileBytes, 'bindings.json');

  assertManifest(manifest);

  const [assets, fonts, previews] = await Promise.all([
    collectFolderFiles(entriesByPath, fileBytes, 'assets/'),
    collectFolderFiles(entriesByPath, fileBytes, 'fonts/'),
    collectFolderFiles(entriesByPath, fileBytes, 'previews/'),
  ]);

  let checksums: any;
  if (entriesByPath.has('checksums.json')) {
    checksums = await parseEntryJson<any>(entriesByPath, fileBytes, 'checksums.json');
  }

  return {
    manifest,
    scene,
    bindings,
    files: {
      assets,
      fonts,
      previews,
      ...(checksums !== undefined ? { checksums } : {}),
    },
  };
};
