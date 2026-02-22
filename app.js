const tabs = ['Dashboard', 'Design', 'Data Engine', 'Control Room', 'Output'];
const STORAGE_KEY = 'renderless.fileExplorer.v1';
const TEMPLATE_LIBRARY_STORAGE_KEY = 'renderless.templateLibrary.v1';
const TEMPLATE_STORAGE_KEY = 'renderless.templates.v1';
const ASSET_DB_NAME = 'renderless.assetBinary.v1';
const ASSET_DB_STORE = 'images';
const MAX_PERSISTED_DATA_URL_LENGTH = 120000;
const TEMPLATE_SIZES = [
  { id: '1920x1080', label: '1920 × 1080' },
  { id: '1080x1920', label: '1080 × 1920' },
  { id: '1080x1350', label: '1080 × 1350' },
  { id: '1080x1080', label: '1080 × 1080' },
];

const bootstrapData = window.RENDERLESS_BOOTSTRAP || {};
const mlbSimulationFeed = bootstrapData.mlbSimulationFeed || [];

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function slugId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeFolder(name, parentId = null, permissions = null) {
  return {
    id: slugId('folder'),
    type: 'folder',
    name,
    parentId,
    children: [],
    permissions: permissions || { owners: ['admin@renderless.ai'], editors: ['design@renderless.ai'], viewers: [] },
    createdAt: new Date().toISOString(),
  };
}

function makeFile({ name, parentId, src, dimension }) {
  return {
    id: slugId('file'),
    type: 'file',
    name,
    parentId,
    src,
    dimension,
    createdAt: new Date().toISOString(),
  };
}

function buildDefaultExplorer() {
  const root = makeFolder('Branded Assets', null, {
    owners: ['admin@renderless.ai'],
    editors: ['design@renderless.ai', 'social@renderless.ai'],
    viewers: ['sales@renderless.ai'],
  });
  root.id = 'root';

  const foldersByName = new Map();
  const nodes = [root];

  (bootstrapData.brandedAssets || []).forEach((asset) => {
    const topFolderName = asset.folder || 'General';
    if (!foldersByName.has(topFolderName)) {
      const folder = makeFolder(topFolderName, 'root', cloneValue(root.permissions));
      foldersByName.set(topFolderName, folder);
      root.children.push(folder.id);
      nodes.push(folder);
    }

    const folder = foldersByName.get(topFolderName);
    const file = makeFile({
      name: asset.name,
      parentId: folder.id,
      src: asset.src,
      dimension: asset.dimension,
    });
    folder.children.push(file.id);
    nodes.push(file);
  });

  return { rootId: 'root', nodes };
}


function buildDefaultTemplateExplorer() {
  const root = makeFolder('Templates', null, {
    owners: ['admin@renderless.ai'],
    editors: ['design@renderless.ai', 'social@renderless.ai'],
    viewers: ['sales@renderless.ai'],
  });
  root.id = 'template-root';
  return { rootId: 'template-root', nodes: [root] };
}

function loadTemplateExplorer() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_LIBRARY_STORAGE_KEY) || 'null');
    if (parsed?.rootId && Array.isArray(parsed.nodes) && parsed.nodes.length) return parsed;
  } catch (error) {
    // fall back to defaults
  }
  return buildDefaultTemplateExplorer();
}
function loadExplorer() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (parsed?.rootId && Array.isArray(parsed.nodes) && parsed.nodes.length) {
      return parsed;
    }
  } catch (error) {
    // fall back to defaults
  }

  return buildDefaultExplorer();
}

function buildPersistableExplorer(explorer) {
  const copy = cloneValue(explorer);
  let trimmedCount = 0;

  copy.nodes = copy.nodes.map((node) => {
    if (node.type !== 'file') return node;
    const nextNode = { ...node };

    if (typeof nextNode.src === 'string' && nextNode.src.startsWith('data:image/')) {
      if (nextNode.src.length > MAX_PERSISTED_DATA_URL_LENGTH) trimmedCount += 1;
      nextNode.srcRef = nextNode.srcRef || nextNode.id;
      nextNode.src = '';
      nextNode.volatile = true;
    }

    if (typeof nextNode.src === 'string' && nextNode.src.startsWith('blob:')) {
      nextNode.srcRef = nextNode.srcRef || nextNode.id;
      nextNode.src = '';
    }

    return nextNode;
  });

  return { explorer: copy, trimmedCount };
}

function saveExplorer(explorer) {
  const { explorer: persistableExplorer, trimmedCount } = buildPersistableExplorer(explorer);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableExplorer));
    if (trimmedCount > 0) {
      return { ok: true, message: `Stored ${trimmedCount} uploaded file${trimmedCount > 1 ? 's' : ''} in local asset cache.` };
    }
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: 'Could not save asset library locally.' };
  }
}


function saveTemplateExplorer(explorer) {
  const { explorer: persistableExplorer, trimmedCount } = buildPersistableExplorer(explorer);
  try {
    localStorage.setItem(TEMPLATE_LIBRARY_STORAGE_KEY, JSON.stringify(persistableExplorer));
    if (trimmedCount > 0) {
      return { ok: true, message: `Stored ${trimmedCount} uploaded file${trimmedCount > 1 ? 's' : ''} in local asset cache.` };
    }
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: 'Could not save template library locally.' };
  }
}

function loadTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_STORAGE_KEY) || '[]');
    if (Array.isArray(parsed)) return parsed;
  } catch (error) {
    // fall back to empty templates
  }
  return [];
}

function saveTemplates(templates) {
  try {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
    return { ok: true, message: '' };
  } catch (error) {
    return { ok: false, message: 'Could not save templates locally.' };
  }
}

function formatTemplateTimestamp(value) {
  return new Date(value).toLocaleString();
}

const runtimeAssetUrlCache = new Map();

function openAssetDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_DB_STORE)) db.createObjectStore(ASSET_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dataUrlToBlob(dataUrl) {
  const [meta, body] = dataUrl.split(',');
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function storeAssetDataUrl(assetId, dataUrl) {
  if (!assetId || !dataUrl?.startsWith('data:image/')) return false;
  try {
    const db = await openAssetDb();
    const blob = dataUrlToBlob(dataUrl);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_DB_STORE, 'readwrite');
      tx.objectStore(ASSET_DB_STORE).put(blob, assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return true;
  } catch (error) {
    return false;
  }
}

async function deleteAssetData(assetId) {
  if (!assetId) return;
  try {
    const db = await openAssetDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_DB_STORE, 'readwrite');
      tx.objectStore(ASSET_DB_STORE).delete(assetId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    runtimeAssetUrlCache.delete(assetId);
  } catch (error) {
    // no-op
  }
}

async function loadAssetObjectUrl(assetId) {
  if (!assetId) return '';
  if (runtimeAssetUrlCache.has(assetId)) return runtimeAssetUrlCache.get(assetId);

  try {
    const db = await openAssetDb();
    const blob = await new Promise((resolve, reject) => {
      const tx = db.transaction(ASSET_DB_STORE, 'readonly');
      const request = tx.objectStore(ASSET_DB_STORE).get(assetId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!blob) return '';

    const objectUrl = URL.createObjectURL(blob);
    runtimeAssetUrlCache.set(assetId, objectUrl);
    return objectUrl;
  } catch (error) {
    return '';
  }
}

function hydrateAssetSource(assetId) {
  const file = getNodeById(assetId);
  if (!file || file.type !== 'file' || file.src) return;

  loadAssetObjectUrl(file.srcRef || file.id).then((objectUrl) => {
    if (!objectUrl) return;
    const target = getNodeById(assetId);
    if (!target) return;
    target.src = objectUrl;
    render();
  });
}

function getRenderableAssetSrc(file) {
  if (!file) return '';
  if (file.src) return file.src;
  hydrateAssetSource(file.id);
  return '';
}

function defaultTransform(type = 'text', layer = null) {
  if (type === 'asset') {
    return { anchorX: 0, anchorY: 0, posX: 0, posY: 0, scaleX: 100, scaleY: 100, scaleLinked: true, rotation: 0, opacity: 100 };
  }

  return {
    anchorX: 0,
    anchorY: 0,
    posX: Number(layer?.x ?? 32),
    posY: Number(layer?.y ?? 32),
    scaleX: 100,
    scaleY: 100,
    scaleLinked: true,
    rotation: 0,
    opacity: 100,
  };
}

function getTextLayerWithTransform(layer) {
  if (layer.transform) return layer;
  return { ...layer, transform: defaultTransform('text', layer) };
}

function getAssetLayer() {
  return state.designAssetLayer;
}

function getOrderedLayerKeys() {
  const textKeys = state.designTextLayers.map((layer) => `text-${layer.id}`);
  const allKeys = [...(state.designAssetLayer ? ['asset-base'] : []), ...textKeys];
  const existing = new Set(allKeys);
  const base = (state.designLayerOrder || []).filter((key) => existing.has(key));
  const missing = allKeys.filter((key) => !base.includes(key));
  return [...base, ...missing];
}

const state = {
  activeTab: 'Dashboard',
  liveScore: 'BOS 0 - NYY 0',
  isStreaming: false,
  brandedAssetsOpen: true,
  templatesLibraryOpen: false,
  assetSearchQuery: '',
  templateSearchQuery: '',
  explorer: loadExplorer(),
  templateExplorer: loadTemplateExplorer(),
  currentFolderId: 'root',
  templateCurrentFolderId: 'template-root',
  designSelectedAssetId: null,
  designSearchQuery: '',
  designFolderFilter: 'all',
  designDimensionFilter: 'all',
  templates: loadTemplates(),
  selectedControlTemplateId: null,
  controlProgramTemplateId: null,
  storageNotice: '',
  renamingFolderId: null,
  renamingFolderValue: '',
  templateRenamingFolderId: null,
  templateRenamingFolderValue: '',
  designTextLayers: [],
  designAssetLayer: null,
  designLayerOrder: [],
  designTemplateSize: '1920x1080',
  designCollapsedLayers: {},
  designTreeExpanded: { root: true },
  templateTreeExpanded: { 'template-root': true },
  designRenamingLayerKey: null,
  designRenamingLayerValue: '',
  nextTextLayerId: 1,
  simulationRunning: false,
  simulationSpeedMs: 1300,
  simulationIndex: -1,
  gameState: cloneValue(bootstrapData.initialGameState || {}),
};

let simulationTimer = null;

const icons = {
  logos: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  fonts: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20 10 4l6 16"/><path d="M6 14h8"/></svg>',
  palette: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1"/><circle cx="12" cy="8" r="1"/><circle cx="16" cy="10" r="1"/><path d="M12 16h.01"/></svg>',
  animation: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2v20M2 12h20"/><path d="m5 5 14 14M19 5 5 19"/></svg>',
  branded: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h7"/></svg>',
};

const streamButton = document.getElementById('streamButton');
const tabsEl = document.getElementById('tabs');
const viewContainer = document.getElementById('viewContainer');

function setState(patch) {
  const shouldPersistExplorer = Object.prototype.hasOwnProperty.call(patch, 'explorer');
  const shouldPersistTemplateExplorer = Object.prototype.hasOwnProperty.call(patch, 'templateExplorer');
  const shouldPersistTemplates = Object.prototype.hasOwnProperty.call(patch, 'templates');
  Object.assign(state, patch);

  if (shouldPersistExplorer) {
    const persistResult = saveExplorer(state.explorer);
    state.storageNotice = persistResult.message || '';
  }

  if (shouldPersistTemplateExplorer) {
    const persistTemplateLibrary = saveTemplateExplorer(state.templateExplorer);
    state.storageNotice = persistTemplateLibrary.message || state.storageNotice;
  }

  if (shouldPersistTemplates) {
    const persistTemplates = saveTemplates(state.templates);
    if (!persistTemplates.ok) state.storageNotice = persistTemplates.message;
  }

  render();
}

function renderTabs() {
  tabsEl.innerHTML = tabs.map((tab) => `<button class="tab-btn ${state.activeTab === tab ? 'active' : ''}" data-tab="${tab}">${tab}</button>`).join('');
  tabsEl.querySelectorAll('.tab-btn').forEach((btn) => btn.addEventListener('click', () => setState({ activeTab: btn.dataset.tab })));
}

function getAssetById(id) {
  return state.brandedAssets.find((asset) => asset.id === Number(id));
}

function getDimensionRatio(dimension) {
  const [w, h] = dimension.split('x').map(Number);
  return w / h;
}

function getFilteredAndSortedAssets() {
  const filtered = state.brandedAssets.filter((asset) => {
    const folderMatch = state.brandedAssetsFolderFilter === 'All folders' || asset.folder === state.brandedAssetsFolderFilter;
    const dimensionMatch = state.brandedAssetsDimensionFilter === 'All dimensions' || asset.dimension === state.brandedAssetsDimensionFilter;
    return folderMatch && dimensionMatch;
  });

  return filtered.sort((a, b) => {
    if (state.brandedAssetsSort === 'name-asc') return a.name.localeCompare(b.name);
    if (state.brandedAssetsSort === 'name-desc') return b.name.localeCompare(a.name);
    if (state.brandedAssetsSort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (state.brandedAssetsSort === 'dimension') return a.dimension.localeCompare(b.dimension);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return filtered.sort((a, b) => {
    if (state.brandedAssetsSort === 'name-asc') return a.name.localeCompare(b.name);
    if (state.brandedAssetsSort === 'name-desc') return b.name.localeCompare(a.name);
    if (state.brandedAssetsSort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (state.brandedAssetsSort === 'dimension') return a.dimension.localeCompare(b.dimension);
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      ${childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('')}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row folder-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>--</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row folder-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>--</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function getNodeById(id) {
  return state.explorer.nodes.find((node) => node.id === id);
}

function getCurrentFolder() {
  return getNodeById(state.currentFolderId) || getNodeById(state.explorer.rootId);
}

function getChildren(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getNodeById(id)).filter(Boolean);
}

function getAllFiles() {
  return state.explorer.nodes.filter((node) => node.type === 'file');
}

function getDimensionRatio(dimension = '16x9') {
  const [w, h] = String(dimension).split('x').map(Number);
  if (!w || !h) return 16 / 9;
  return w / h;
}


function getTemplateDimensions(size = '1920x1080') {
  const [width, height] = String(size).split('x').map(Number);
  if (!width || !height) return { width: 1920, height: 1080 };
  return { width, height };
}

function toStagePercent(value, max) {
  if (!max) return 0;
  return (Number(value) / max) * 100;
}

function getFileKind(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (!ext || ext === name.toLowerCase()) return 'FILE';
  return ext.toUpperCase();
}

function getFolderName(folderId) {
  return getNodeById(folderId)?.name || 'Unknown Folder';
}

function getFolderPath(folderId) {
  const path = [];
  let current = getNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getNodeById(current.parentId) : null;
  }
  return path;
}


function getTemplateNodeById(id) {
  return state.templateExplorer.nodes.find((node) => node.id === id);
}

function getTemplateCurrentFolder() {
  return getTemplateNodeById(state.templateCurrentFolderId) || getTemplateNodeById(state.templateExplorer.rootId);
}

function getTemplateChildren(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return [];
  return folder.children.map((id) => getTemplateNodeById(id)).filter(Boolean);
}

function getTemplateFolderPath(folderId) {
  const path = [];
  let current = getTemplateNodeById(folderId);
  while (current) {
    path.unshift(current);
    current = current.parentId ? getTemplateNodeById(current.parentId) : null;
  }
  return path;
}

function updateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.explorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ explorer: nextExplorer });
}

function createSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.explorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    explorer: nextExplorer,
    currentFolderId: newFolder.id,
  });
}

function renameFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const siblings = getChildren(folder.parentId || state.explorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startFolderRename(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;
  setState({ renamingFolderId: folderId, renamingFolderValue: folder.name });
}

function commitFolderRename(folderId) {
  if (!folderId || state.renamingFolderId !== folderId) return;
  renameFolder(folderId, state.renamingFolderValue);
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function cancelFolderRename() {
  if (!state.renamingFolderId) return;
  setState({ renamingFolderId: null, renamingFolderValue: '' });
}

function deleteFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.explorer.rootId) return;

  const nextExplorer = cloneValue(state.explorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes
    .filter((node) => node.type === 'file' && idsToDelete.has(node.id))
    .forEach((file) => deleteAssetData(file.srcRef || file.id));

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ explorer: nextExplorer, currentFolderId: fallbackFolderId, renamingFolderId: null, renamingFolderValue: '' });
}

function setFolderPermissions(folderId, key, rawValue) {
  const values = rawValue
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  updateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToFolder(folderId) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ currentFolderId: folderId });
}


function updateTemplateNode(nodeId, mutator) {
  const nextExplorer = cloneValue(state.templateExplorer);
  const node = nextExplorer.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  mutator(node, nextExplorer);
  setState({ templateExplorer: nextExplorer });
}

function createTemplateSubfolder(folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const currentFolder = getTemplateCurrentFolder();
  if (!currentFolder || currentFolder.type !== 'folder') return;

  const existing = getTemplateChildren(currentFolder.id).find((child) => child.type === 'folder' && child.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextCurrent = nextExplorer.nodes.find((node) => node.id === currentFolder.id);
  const newFolder = makeFolder(trimmed, nextCurrent.id, cloneValue(nextCurrent.permissions));
  nextCurrent.children.push(newFolder.id);
  nextExplorer.nodes.push(newFolder);

  setState({
    templateExplorer: nextExplorer,
    templateCurrentFolderId: newFolder.id,
  });
}

function renameTemplateFolder(folderId, folderName) {
  const trimmed = folderName.trim();
  if (!trimmed) return;

  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const siblings = getTemplateChildren(folder.parentId || state.templateExplorer.rootId)
    .filter((item) => item.type === 'folder' && item.id !== folderId);
  if (siblings.some((item) => item.name.toLowerCase() === trimmed.toLowerCase())) return;

  updateTemplateNode(folderId, (node) => {
    node.name = trimmed;
  });
}

function startTemplateFolderRename(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;
  setState({ templateRenamingFolderId: folderId, templateRenamingFolderValue: folder.name });
}

function commitTemplateFolderRename(folderId) {
  if (!folderId || state.templateRenamingFolderId !== folderId) return;
  renameTemplateFolder(folderId, state.templateRenamingFolderValue);
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function cancelTemplateFolderRename() {
  if (!state.templateRenamingFolderId) return;
  setState({ templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function deleteTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder' || folder.id === state.templateExplorer.rootId) return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const idsToDelete = new Set();

  const collect = (id) => {
    idsToDelete.add(id);
    const node = nextExplorer.nodes.find((item) => item.id === id);
    if (!node || node.type !== 'folder') return;
    node.children.forEach((childId) => collect(childId));
  };
  collect(folderId);

  nextExplorer.nodes = nextExplorer.nodes.filter((node) => !idsToDelete.has(node.id));
  nextExplorer.nodes.forEach((node) => {
    if (node.type === 'folder') node.children = node.children.filter((id) => !idsToDelete.has(id));
  });

  const fallbackFolderId = folder.parentId || nextExplorer.rootId;
  setState({ templateExplorer: nextExplorer, templateCurrentFolderId: fallbackFolderId, templateRenamingFolderId: null, templateRenamingFolderValue: '' });
}

function setTemplateFolderPermissions(folderId, key, rawValue) {
  const values = rawValue.split(',').map((item) => item.trim()).filter(Boolean);
  updateTemplateNode(folderId, (node) => {
    node.permissions[key] = values;
  });
}

function navigateToTemplateFolder(folderId) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return;
  setState({ templateCurrentFolderId: folderId });
}

function renderFolderTree(folderId, depth = 0) {
  const folder = getNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.designTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.renamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" />`
        : `<button class="tree-folder ${state.currentFolderId === folder.id ? 'active' : ''}" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function renderTemplateFolderTree(folderId, depth = 0) {
  const folder = getTemplateNodeById(folderId);
  if (!folder || folder.type !== 'folder') return '';
  const childFolders = getTemplateChildren(folderId).filter((child) => child.type === 'folder');
  const hasChildren = childFolders.length > 0;
  const expanded = state.templateTreeExpanded[folder.id] || depth === 0;
  const isRenaming = state.templateRenamingFolderId === folder.id;

  return `
    <div class="tree-node" style="--depth:${depth}">
      <div class="tree-row">
        ${hasChildren ? `<button class="tree-toggle" data-template-toggle-tree-id="${folder.id}">${expanded ? '▾' : '▸'}</button>` : '<span class="tree-toggle-placeholder"></span>'}
        ${isRenaming
        ? `<input class="tree-folder rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" />`
        : `<button class="tree-folder ${state.templateCurrentFolderId === folder.id ? 'active' : ''}" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename.">${folder.name}</button>`}
      </div>
      ${expanded ? childFolders.map((child) => renderTemplateFolderTree(child.id, depth + 1)).join('') : ''}
    </div>
  `;
}

function templateLibraryView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getTemplateCurrentFolder();
  const children = getTemplateChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.templateSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getTemplateFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderTemplateFolderTree(state.templateExplorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-template-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="templateSearchInput" value="${state.templateSearchQuery}" placeholder="Search templates" />
            <button id="templateCreateFolderBtn" class="action-btn">Create Folder</button>
            <button id="templateDeleteFolderBtn" class="action-btn" ${currentFolder.id === state.templateExplorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="templateAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.templateRenamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-template-rename-input-id="${folder.id}" value="${state.templateRenamingFolderValue}" /><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-template-open-folder-id="${folder.id}" data-template-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getTemplateChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<div class="explorer-row"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></div>`).join('')}
          ${!folders.length && !files.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="templateOwnersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="templateEditorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="templateViewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function fileExplorerView(options = {}) {
  const showPermissions = options.showPermissions !== false;
  const currentFolder = getCurrentFolder();
  const children = getChildren(currentFolder.id);
  const folders = children.filter((item) => item.type === 'folder');
  const fileSearch = state.assetSearchQuery.trim().toLowerCase();
  const files = children
    .filter((item) => item.type === 'file')
    .filter((file) => !fileSearch || file.name.toLowerCase().includes(fileSearch));
  const breadcrumbs = getFolderPath(currentFolder.id);

  return `
    <div class="explorer-layout ${showPermissions ? '' : 'no-permissions'}">
      <aside class="explorer-tree panel">
        <h4>Folders</h4>
        ${renderFolderTree(state.explorer.rootId)}
      </aside>
      <section class="explorer-main panel">
        <div class="explorer-toolbar">
          <div class="breadcrumbs">${breadcrumbs.map((crumb, index) => `<button class="crumb" data-crumb-id="${crumb.id}">${crumb.name}${index < breadcrumbs.length - 1 ? ' /' : ''}</button>`).join('')}</div>
          <div class="toolbar-actions">
            <input id="assetSearchInput" value="${state.assetSearchQuery}" placeholder="Search assets" />
            <button id="createFolderBtn" class="action-btn">Create Folder</button>
            <button id="deleteFolderBtn" class="action-btn" ${currentFolder.id === state.explorer.rootId ? 'disabled' : ''}>Delete Folder</button>
            <label class="action-btn upload-btn">Upload<input id="brandAssetUpload" type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" multiple /></label>
          </div>
          ${state.storageNotice ? `<p class="storage-warning">${state.storageNotice}</p>` : ''}
        </div>
        <div class="explorer-list">
          <div class="explorer-head"><span>Name</span><span>Type</span><span>Dimension</span><span>Modified</span></div>
          ${folders.map((folder) => state.renamingFolderId === folder.id ? `<div class="explorer-row"><input class="rename-input" data-rename-input-id="${folder.id}" value="${state.renamingFolderValue}" /><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></div>` : `<button class="explorer-row" data-open-folder-id="${folder.id}" data-rename-folder-id="${folder.id}" title="Double-click to rename."><span>📁 ${folder.name}</span><span>Folder</span><span>${getChildren(folder.id).length} item(s)</span><span>${new Date(folder.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${files.map((file) => `<button class="explorer-row file-row" data-asset-id="${file.id}"><span>🖼️ ${file.name}</span><span>${getFileKind(file.name)}</span><span>${file.dimension}</span><span>${new Date(file.createdAt).toLocaleDateString()}</span></button>`).join('')}
          ${state.templates.length ? `<div class="template-strip"><h4>Saved Templates</h4>${state.templates.filter((template) => !fileSearch || template.name.toLowerCase().includes(fileSearch)).map((template) => `<button class="explorer-row template-row" data-template-id="${template.id}"><span>🧩 ${template.name}</span><span>Template</span><span>${template.templateSize || template.dimension}</span><span>${new Date(template.createdAt).toLocaleDateString()}</span></button>`).join('')}</div>` : ''}
          ${!folders.length && !files.length && !state.templates.length ? '<p class="muted">No matching assets in this folder.</p>' : ''}
        </div>
      </section>
      ${showPermissions ? `<aside class="explorer-permissions panel">
        <h4>Folder Permissions</h4>
        <p class="muted">Access to a parent folder grants access to everything inside it.</p>
        <label class="control-group">Owners<input id="ownersInput" value="${(currentFolder.permissions?.owners || []).join(', ')}" /></label>
        <label class="control-group">Editors<input id="editorsInput" value="${(currentFolder.permissions?.editors || []).join(', ')}" /></label>
        <label class="control-group">Viewers<input id="viewersInput" value="${(currentFolder.permissions?.viewers || []).join(', ')}" /></label>
      </aside>` : ''}
    </div>
  `;
}

function dashboardView() {
  return `
    <section class="panel">
      <h3>Projects</h3>
      <div class="card-grid">
        <article class="card"><strong>Braves 2027 Pack</strong><p class="muted">Live Package · Ready for Air</p></article>
        <article class="card"><strong>Champions League RT</strong><p class="muted">Ticker + Stats + Lower Third</p></article>
        <article class="card"><strong>NLL Weekly Board</strong><p class="muted">Automated score ingest</p></article>
      </div>
    </section>
    <section class="panel">
      <div class="asset-header">
        <h3>Global Asset Library</h3>
        <button id="toggleBrandedAssets" class="utility-btn">Branded Assets</button>
      </div>
      <div class="asset-icons">
        <button id="toggleBrandedAssets" class="asset asset-btn ${state.brandedAssetsOpen ? 'active' : ''}">${icons.branded}<span>Branded Assets</span></button>
        <button id="toggleTemplateLibrary" class="asset asset-btn ${state.templatesLibraryOpen ? 'active' : ''}">${icons.fonts}<span>Templates</span></button>
        <div class="asset">${icons.logos}<span>Logos</span></div>
        <div class="asset">${icons.fonts}<span>Fonts</span></div>
        <div class="asset">${icons.palette}<span>Palette</span></div>
        <div class="asset">${icons.animation}<span>Anim</span></div>
        <div class="asset">${icons.logos}<span>Bug</span></div>
      </div>
      <div class="brand-manager ${state.brandedAssetsOpen ? 'open' : ''}">${fileExplorerView({ showPermissions: true })}</div>
      <div class="brand-manager ${state.templatesLibraryOpen ? 'open' : ''}">${templateLibraryView({ showPermissions: true })}</div>
    </section>
  `;
}


function saveCurrentDesignTemplate() {
  const allFiles = getAllFiles();
  const selectedAsset = allFiles.find((file) => file.id === state.designSelectedAssetId) || allFiles[0] || null;

  const name = window.prompt('Template name', `Template ${state.templates.length + 1}`);
  if (!name || !name.trim()) return;

  const template = {
    id: slugId('template'),
    name: name.trim(),
    assetId: selectedAsset?.id || null,
    assetName: selectedAsset?.name || 'No asset',
    dimension: selectedAsset?.dimension || state.designTemplateSize,
    textLayers: cloneValue(state.designTextLayers.map(getTextLayerWithTransform)),
    layerOrder: cloneValue(getOrderedLayerKeys()),
    assetTransform: cloneValue(getAssetLayer()?.transform || null),
    templateSize: state.designTemplateSize,
    createdAt: new Date().toISOString(),
  };

  const nextTemplates = [template, ...state.templates.filter((item) => item.name.toLowerCase() !== template.name.toLowerCase())];
  setState({ templates: nextTemplates, selectedControlTemplateId: template.id });
}

function applyTemplateToDesign(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  setState({
    activeTab: 'Design',
    designSelectedAssetId: template.assetId || state.designSelectedAssetId,
    designTextLayers: cloneValue((template.textLayers || []).map(getTextLayerWithTransform)),
    designLayerOrder: cloneValue(template.layerOrder || [...(template.assetTransform ? ['asset-base'] : []), ...(template.textLayers || []).map((layer) => `text-${layer.id}`)]),
    designAssetLayer: template.assetTransform ? { id: 'asset-base', name: 'Stage Asset', transform: cloneValue(template.assetTransform || defaultTransform('asset')) } : null,
    designTemplateSize: template.templateSize || '1920x1080',
    nextTextLayerId: Math.max(1, ...(template.textLayers || []).map((layer) => Number(layer.id) || 0)) + 1,
  });
}

function getBoundText(layer) {
  if (layer.bindKey === 'none') return layer.text;
  if (layer.bindKey === 'score') return `Score: BOS ${state.gameState.score.BOS} - NYY ${state.gameState.score.NYY}`;
  if (layer.bindKey === 'inning') return `${state.gameState.inningState} ${state.gameState.inning}`;
  if (layer.bindKey === 'count') return `Count ${state.gameState.balls}-${state.gameState.strikes}, ${state.gameState.outs} out`;
  if (layer.bindKey === 'matchup') return `${state.gameState.pitcher} vs ${state.gameState.batter}`;
  if (layer.bindKey === 'lastEvent') return state.gameState.lastEvent;
  return layer.text;
}

function designView() {
  const allFiles = getAllFiles();
  const selectedAsset = allFiles.find((file) => file.id === state.designSelectedAssetId) || allFiles[0];
  const assetLayer = getAssetLayer();
  const orderedLayerKeys = getOrderedLayerKeys();
  const { width: templateWidth, height: templateHeight } = getTemplateDimensions(state.designTemplateSize);
  const ratio = templateWidth / templateHeight;

  const canvasLayers = orderedLayerKeys.map((key) => {
    if (key === 'asset-base') {
      if (!assetLayer) return '';
      const t = assetLayer.transform;
      const src = getRenderableAssetSrc(selectedAsset);
      if (!src) return '<p class="muted canvas-empty">Selected asset preview is loading or unavailable.</p>';
      return `<img src="${src}" alt="${selectedAsset?.name || 'Asset'}" class="canvas-bg" style="transform-origin: top left; transform: translate(${toStagePercent(t.posX - t.anchorX, templateWidth)}%, ${toStagePercent(t.posY - t.anchorY, templateHeight)}%) rotate(${t.rotation}deg) scale(${t.scaleX / 100}, ${t.scaleY / 100}); opacity:${Math.max(0, Math.min(100, t.opacity)) / 100};" />`;
    }

    const id = Number(key.replace('text-', ''));
    const layer = getTextLayerWithTransform(state.designTextLayers.find((item) => item.id === id));
    if (!layer) return '';
    const t = layer.transform;
    return `<span class="text-layer" style="transform-origin: top left; font-size:${layer.size}px;color:${layer.color};transform: translate(${toStagePercent(t.posX - t.anchorX, templateWidth)}%, ${toStagePercent(t.posY - t.anchorY, templateHeight)}%) rotate(${t.rotation}deg) scale(${t.scaleX / 100}, ${t.scaleY / 100});opacity:${Math.max(0, Math.min(100, t.opacity)) / 100};">${getBoundText(layer)}</span>`;
  }).join('');

  const layerCards = orderedLayerKeys.map((key) => {
    const isAsset = key === 'asset-base';
    const collapsed = !!state.designCollapsedLayers[key];
    const isRenaming = state.designRenamingLayerKey === key;

    if (isAsset && assetLayer) {
      const t = assetLayer.transform;
      return `
        <div class="layer-card">
          <div class="layer-title-row">
            <button class="layer-collapse" data-toggle-layer-collapse="asset-base">${collapsed ? '▸' : '▾'}</button>
            ${isRenaming
              ? `<input class="rename-input" data-layer-rename-input="asset-base" value="${state.designRenamingLayerValue}" />`
              : `<strong data-rename-layer-key="asset-base" title="Double-click to rename.">${assetLayer.name}</strong>`}
            <div class="layer-actions"><button class="layer-move" data-move-layer-key="asset-base" data-dir="up">↑</button><button class="layer-move" data-move-layer-key="asset-base" data-dir="down">↓</button><button class="layer-delete" data-remove-asset-layer>Remove</button></div>
          </div>
          ${collapsed ? '' : `<div class="transform-block">
            <div class="transform-head"><span>Transform</span><button class="transform-reset" data-reset-asset-transform>Reset</button></div>
            <label class="transform-row"><span>Anchor Point</span><span><input type="number" class="transform-input" data-asset-transform-prop="anchorX" value="${t.anchorX}" /><input type="number" class="transform-input" data-asset-transform-prop="anchorY" value="${t.anchorY}" /></span></label>
            <label class="transform-row"><span>Position</span><span><input type="number" class="transform-input" data-asset-transform-prop="posX" value="${t.posX}" /><input type="number" class="transform-input" data-asset-transform-prop="posY" value="${t.posY}" /></span></label>
            <label class="transform-row"><span>Scale</span><span><button class="scale-lock ${t.scaleLinked ? 'on' : ''}" data-toggle-asset-scale-lock>${t.scaleLinked ? '🔗' : '⛓️'}</button><input type="number" class="transform-input" data-asset-transform-prop="scaleX" value="${t.scaleX}" /><input type="number" class="transform-input" data-asset-transform-prop="scaleY" value="${t.scaleY}" ${t.scaleLinked ? 'disabled' : ''} /></span></label>
            <label class="transform-row"><span>Rotation</span><span><input type="number" class="transform-input" data-asset-transform-prop="rotation" value="${t.rotation}" /></span></label>
            <label class="transform-row"><span>Opacity</span><span><input type="number" class="transform-input" data-asset-transform-prop="opacity" value="${t.opacity}" min="0" max="100" /></span></label>
          </div>`}
        </div>`;
    }

    const id = Number(key.replace('text-', ''));
    const layer = getTextLayerWithTransform(state.designTextLayers.find((item) => item.id === id));
    if (!layer) return '';
    const t = layer.transform;

    return `
      <div class="layer-card">
        <div class="layer-title-row">
          <button class="layer-collapse" data-toggle-layer-collapse="text-${layer.id}">${collapsed ? '▸' : '▾'}</button>
          ${isRenaming
            ? `<input class="rename-input" data-layer-rename-input="text-${layer.id}" value="${state.designRenamingLayerValue}" />`
            : `<strong data-rename-layer-key="text-${layer.id}" title="Double-click to rename.">${layer.name}</strong>`}
          <div class="layer-actions"><button class="layer-move" data-move-layer-key="text-${layer.id}" data-dir="up">↑</button><button class="layer-move" data-move-layer-key="text-${layer.id}" data-dir="down">↓</button><button class="layer-delete" data-remove-layer-id="${layer.id}">Remove</button></div>
        </div>
        ${collapsed ? '' : `<input data-layer-id="${layer.id}" data-prop="text" value="${layer.text}" />
        <div class="layer-row"><input type="number" data-layer-id="${layer.id}" data-prop="size" value="${layer.size}" /><input type="color" data-layer-id="${layer.id}" data-prop="color" value="${layer.color}" /></div>
        <select data-layer-id="${layer.id}" data-prop="bindKey">
          <option value="none" ${layer.bindKey === 'none' ? 'selected' : ''}>Manual</option>
          <option value="score" ${layer.bindKey === 'score' ? 'selected' : ''}>Bind Score</option>
          <option value="inning" ${layer.bindKey === 'inning' ? 'selected' : ''}>Bind Inning State</option>
          <option value="count" ${layer.bindKey === 'count' ? 'selected' : ''}>Bind Count/Outs</option>
          <option value="matchup" ${layer.bindKey === 'matchup' ? 'selected' : ''}>Bind Pitcher vs Batter</option>
          <option value="lastEvent" ${layer.bindKey === 'lastEvent' ? 'selected' : ''}>Bind Last Event</option>
        </select>
        <div class="transform-block">
          <div class="transform-head"><span>Transform</span><button class="transform-reset" data-reset-layer-transform="${layer.id}">Reset</button></div>
          <label class="transform-row"><span>Anchor Point</span><span><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="anchorX" value="${t.anchorX}" /><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="anchorY" value="${t.anchorY}" /></span></label>
          <label class="transform-row"><span>Position</span><span><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="posX" value="${t.posX}" /><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="posY" value="${t.posY}" /></span></label>
          <label class="transform-row"><span>Scale</span><span><button class="scale-lock ${t.scaleLinked ? 'on' : ''}" data-toggle-layer-scale-lock="${layer.id}">${t.scaleLinked ? '🔗' : '⛓️'}</button><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="scaleX" value="${t.scaleX}" /><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="scaleY" value="${t.scaleY}" ${t.scaleLinked ? 'disabled' : ''} /></span></label>
          <label class="transform-row"><span>Rotation</span><span><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="rotation" value="${t.rotation}" /></span></label>
          <label class="transform-row"><span>Opacity</span><span><input type="number" class="transform-input" data-transform-layer-id="${layer.id}" data-transform-prop="opacity" value="${t.opacity}" min="0" max="100" /></span></label>
        </div>`}
      </div>`;
  }).join('');

  return `
    <section class="panel design-layout">
      <div>
        <h3>Canvas · ${templateWidth} × ${templateHeight}</h3>
        <div class="design-stage-shell">
          <div class="design-stage" style="--asset-ratio:${ratio};">${canvasLayers || '<p class="muted canvas-empty">Stage is blank. Add an asset or text layer to begin.</p>'}</div>
        </div>
      </div>
      <aside class="design-sidebar">
        <div class="panel mini-panel">
          <div class="layer-head">
            <h3>Layer Stack</h3>
            <div class="layer-head-actions"><button id="newTemplateBtn" class="pill-btn">+New Template</button><button id="saveTemplateBtn" class="pill-btn">Save Template</button><button id="addAssetLayer" class="pill-btn" ${state.designAssetLayer ? 'disabled' : ''}>Add Asset Layer</button><button id="addTextLayer" class="pill-btn">Add Text Layer</button></div>
          </div>
          <label class="control-group">Template Size
            <select id="designTemplateSize">${TEMPLATE_SIZES.map((size) => `<option value="${size.id}" ${state.designTemplateSize === size.id ? 'selected' : ''}>${size.label}</option>`).join('')}</select>
          </label>
          <p class="muted">Viewport coordinates: top-left 0,0 · center ${Math.round(templateWidth / 2)},${Math.round(templateHeight / 2)} · bottom-right ${templateWidth},${templateHeight}</p>
          <div class="layer-controls">${layerCards || '<p class="muted">No layers yet. Add an asset layer or text layer.</p>'}</div>
        </div>
      </aside>
    </section>
    <section class="panel">
      <h3>Branded Assets Locker</h3>
      ${fileExplorerView({ showPermissions: false })}
    </section>
  `;
}

function dataEngineView() {
  return `
    <section class="panel">
      <h3>Data Simulation Engine · Pitch by Pitch</h3>
      <div class="sim-toolbar">
        <button id="toggleSimulation" class="utility-btn ${state.simulationRunning ? 'sim-on' : ''}">${state.simulationRunning ? 'Stop Simulation' : 'Start Simulation'}</button>
        <label class="control-group">Speed
          <select id="simulationSpeed">
            <option value="1800" ${state.simulationSpeedMs === 1800 ? 'selected' : ''}>Slow</option>
            <option value="1300" ${state.simulationSpeedMs === 1300 ? 'selected' : ''}>Normal</option>
            <option value="700" ${state.simulationSpeedMs === 700 ? 'selected' : ''}>Fast</option>
          </select>
        </label>
        <button id="resetSimulation" class="pill-btn">Reset Game</button>
      </div>
      <table class="table">
        <thead><tr><th>KEY</th><th>SOURCE</th><th>VALUE</th></tr></thead>
        <tbody>
          <tr><td>score</td><td>MLB Simulator</td><td>BOS ${state.gameState.score.BOS} - NYY ${state.gameState.score.NYY}</td></tr>
          <tr><td>inning</td><td>MLB Simulator</td><td>${state.gameState.inningState} ${state.gameState.inning}</td></tr>
          <tr><td>count</td><td>MLB Simulator</td><td>${state.gameState.balls}-${state.gameState.strikes}, ${state.gameState.outs} out</td></tr>
          <tr><td>runnersOnBase</td><td>MLB Simulator</td><td>${state.gameState.runnersOnBase}</td></tr>
          <tr><td>pitcher / batter</td><td>MLB Simulator</td><td>${state.gameState.pitcher} vs ${state.gameState.batter}</td></tr>
          <tr><td>pitch</td><td>MLB Simulator</td><td>${state.gameState.pitchType} · ${state.gameState.pitchVelocity} mph · ${state.gameState.pitchLocation}</td></tr>
          <tr><td>contact metrics</td><td>MLB Simulator</td><td>${state.gameState.batSpeed} mph · ${state.gameState.exitVelocity} mph · ${state.gameState.launchAngle}° · ${state.gameState.projectedDistance} ft</td></tr>
          <tr><td>lastEvent</td><td>MLB Simulator</td><td>${state.gameState.lastEvent}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="panel">
      <h3>Pitch Stream</h3>
      <div class="sim-feed">
        ${mlbSimulationFeed.map((play, index) => `<div class="feed-row ${index === state.simulationIndex ? 'active' : ''}"><strong>${play.inningState} ${play.inning}</strong><span>${play.pitch.type} ${play.pitch.velocity} mph · ${play.summary}</span><em>BOS ${play.score.BOS} - NYY ${play.score.NYY}</em></div>`).join('')}
      </div>
    </section>
  `;
}

function renderControlTemplateStage(template, panelLabel = 'PREVIEW') {
  if (!template) return `<div class="monitor-surface empty">No template selected.</div>`;
  const { width, height } = getTemplateDimensions(template.templateSize || template.dimension || '1920x1080');
  const ratio = width / height;
  const asset = template.assetId ? getNodeById(template.assetId) : null;
  const src = getRenderableAssetSrc(asset);
  const baseTransform = template.assetTransform || null;
  const textLayers = (template.textLayers || []).map(getTextLayerWithTransform);
  const order = template.layerOrder || [...(baseTransform ? ['asset-base'] : []), ...textLayers.map((layer) => `text-${layer.id}`)];

  const stageLayers = order.map((key) => {
    if (key === 'asset-base' && baseTransform && src) {
      const t = baseTransform;
      return `<img src="${src}" alt="${template.assetName || 'Template Asset'}" class="canvas-bg" style="transform-origin: top left; transform: translate(${toStagePercent(t.posX - t.anchorX, width)}%, ${toStagePercent(t.posY - t.anchorY, height)}%) rotate(${t.rotation}deg) scale(${t.scaleX / 100}, ${t.scaleY / 100}); opacity:${Math.max(0, Math.min(100, t.opacity)) / 100};" />`;
    }
    const id = Number(String(key).replace('text-', ''));
    const layer = textLayers.find((item) => item.id === id);
    if (!layer) return '';
    const t = layer.transform;
    return `<span class="text-layer" style="transform-origin: top left; font-size:${Math.max(12, layer.size * 0.35)}px;color:${layer.color};transform: translate(${toStagePercent(t.posX - t.anchorX, width)}%, ${toStagePercent(t.posY - t.anchorY, height)}%) rotate(${t.rotation}deg) scale(${t.scaleX / 100}, ${t.scaleY / 100});opacity:${Math.max(0, Math.min(100, t.opacity)) / 100};">${getBoundText(layer)}</span>`;
  }).join('');

  return `<div class="monitor-surface"><h4>${panelLabel}</h4><div class="control-stage" style="--asset-ratio:${ratio};">${stageLayers || '<p class="muted canvas-empty">No visual layers</p>'}</div></div>`;
}

function controlRoomView() {
  const selectedTemplate = state.templates.find((item) => item.id === state.selectedControlTemplateId) || state.templates[0] || null;
  const programTemplate = state.templates.find((item) => item.id === state.controlProgramTemplateId) || null;

  return `
    <section class="panel control-room-grid">
      <div class="control-templates-column">
        <h3>Templates</h3>
        <div class="control-template-list">
          ${state.templates.map((template) => `<button class="control-template-item ${selectedTemplate?.id === template.id ? 'active' : ''}" data-control-template-id="${template.id}"><strong>${template.name}</strong><span>${template.assetName} · ${template.templateSize || template.dimension}</span><em>Saved ${formatTemplateTimestamp(template.createdAt)}</em></button>`).join('')}
          ${!state.templates.length ? '<p class="muted">No templates saved yet. Go to Design and click Save Template.</p>' : ''}
        </div>
        <div class="control-room-actions">
          <button id="takeTemplateLiveBtn" class="pill-btn" ${selectedTemplate ? '' : 'disabled'}>Take Selected Live</button>
          ${selectedTemplate ? '<button id="loadTemplateToDesignBtn" class="pill-btn">Load Selected Template in Design</button>' : ''}
        </div>
      </div>
      <div class="control-monitors-column">
        <div class="monitor-grid">
          ${renderControlTemplateStage(selectedTemplate, 'PREVIEW')}
          ${renderControlTemplateStage(programTemplate, 'PROGRAM')}
        </div>
      </div>
      ${selectedTemplate ? '<button id="loadTemplateToDesignBtn" class="pill-btn">Load Selected Template in Design</button>' : ''}
    </section>
  `;
}

function outputView() {
  return `
    <section class="panel telemetry">
      <div class="fps-card">
        <h3>Performance Telemetry</h3>
        <div class="fps">${state.isStreaming ? '60 FPS' : '--'}</div>
        <div class="graph" style="opacity:${state.isStreaming ? '1' : '.25'}"></div>
      </div>
      <div>
        <h3>System Event Log</h3>
        <div class="log">${state.isStreaming ? '[12:00:01] INFO: Renderless Engine Initialized\n[12:00:04] SUCCESS: NDI sink linked\n[12:00:07] INFO: Preview chain healthy\n[12:00:10] INFO: Frame rate stable at 60 FPS\n[12:00:13] SUCCESS: Program output live\n[12:00:14] INFO: Audio embed synchronized\n[12:00:16] INFO: GPU utilization nominal\n[12:00:19] SUCCESS: Stream active to destination A' : '[idle] Streaming disabled. Press "Push to Stream" to start output telemetry.'}</div>
      </div>
    </section>
  `;
}

function renderView() {
  switch (state.activeTab) {
    case 'Dashboard':
      return dashboardView();
    case 'Design':
      return designView();
    case 'Data Engine':
      return dataEngineView();
    case 'Control Room':
      return controlRoomView();
    case 'Output':
      return outputView();
    default:
      return dashboardView();
  }
}

function runSimulationStep() {
  const nextIndex = state.simulationIndex + 1;
  if (nextIndex >= mlbSimulationFeed.length) {
    stopSimulation();
    return;
  }

  const play = mlbSimulationFeed[nextIndex];
  setState({
    simulationIndex: nextIndex,
    liveScore: `BOS ${play.score.BOS} - NYY ${play.score.NYY}`,
    gameState: {
      ...state.gameState,
      inning: play.inning,
      inningState: play.inningState,
      score: play.score,
      balls: play.count.balls,
      strikes: play.count.strikes,
      outs: play.count.outs,
      runnersOnBase: play.runnersOnBase,
      pitcher: play.pitcher,
      batter: play.batter,
      pitchType: play.pitch.type,
      pitchVelocity: play.pitch.velocity,
      pitchLocation: play.pitch.location,
      batSpeed: play.hit.batSpeed,
      exitVelocity: play.hit.exitVelocity,
      launchAngle: play.hit.launchAngle,
      projectedDistance: play.hit.projectedDistance,
      lastEvent: play.summary,
    },
  });
}

function startSimulation() {
  if (simulationTimer) return;
  setState({ simulationRunning: true });
  simulationTimer = setInterval(runSimulationStep, state.simulationSpeedMs);
}

function stopSimulation() {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
  if (state.simulationRunning) setState({ simulationRunning: false });
}

function resetSimulation() {
  stopSimulation();
  setState({ simulationIndex: -1, liveScore: 'BOS 0 - NYY 0', gameState: cloneValue(bootstrapData.initialGameState || {}) });
}

function updateLayer(layerId, prop, value) {
  const castValue = prop === 'x' || prop === 'y' || prop === 'size' ? Number(value) : value;
  const layers = state.designTextLayers.map((layer) => (layer.id === Number(layerId) ? { ...getTextLayerWithTransform(layer), [prop]: castValue } : layer));
  setState({ designTextLayers: layers });
}

function updateLayerTransform(layerId, prop, value) {
  const numeric = Number(value);
  const layers = state.designTextLayers.map((layer) => {
    if (layer.id !== Number(layerId)) return layer;
    const enriched = getTextLayerWithTransform(layer);
    const next = { ...enriched.transform, [prop]: Number.isNaN(numeric) ? 0 : numeric };
    if (prop === 'scaleX' && enriched.transform.scaleLinked) next.scaleY = next.scaleX;
    return { ...enriched, transform: next };
  });
  setState({ designTextLayers: layers });
}

function toggleLayerScaleLock(layerId) {
  const layers = state.designTextLayers.map((layer) => {
    if (layer.id !== Number(layerId)) return layer;
    const enriched = getTextLayerWithTransform(layer);
    const next = { ...enriched.transform, scaleLinked: !enriched.transform.scaleLinked };
    if (next.scaleLinked) next.scaleY = next.scaleX;
    return { ...enriched, transform: next };
  });
  setState({ designTextLayers: layers });
}

function resetLayerTransform(layerId) {
  const layers = state.designTextLayers.map((layer) => (layer.id === Number(layerId)
    ? { ...getTextLayerWithTransform(layer), transform: defaultTransform('text', layer) }
    : layer));
  setState({ designTextLayers: layers });
}

function updateAssetTransform(prop, value) {
  const numeric = Number(value);
  const current = getAssetLayer();
  if (!current) return;
  const next = { ...current.transform, [prop]: Number.isNaN(numeric) ? 0 : numeric };
  if (prop === 'scaleX' && current.transform.scaleLinked) next.scaleY = next.scaleX;
  setState({ designAssetLayer: { ...current, transform: next } });
}

function toggleAssetScaleLock() {
  const current = getAssetLayer();
  if (!current) return;
  const next = { ...current.transform, scaleLinked: !current.transform.scaleLinked };
  if (next.scaleLinked) next.scaleY = next.scaleX;
  setState({ designAssetLayer: { ...current, transform: next } });
}

function resetAssetTransform() {
  const current = getAssetLayer();
  if (!current) return;
  setState({ designAssetLayer: { ...current, transform: defaultTransform('asset') } });
}

function addTextLayer() {
  const id = state.nextTextLayerId;
  const newLayer = { id, name: `Layer ${id}`, text: 'New Text Layer', x: 32, y: 32 + state.designTextLayers.length * 48, size: 32, color: '#ffffff', bindKey: 'none', transform: defaultTransform('text', { x: 32, y: 32 + state.designTextLayers.length * 48 }) };
  setState({ designTextLayers: [...state.designTextLayers, newLayer], nextTextLayerId: id + 1, designLayerOrder: [...getOrderedLayerKeys(), `text-${id}`] });
}

function removeTextLayer(layerId) {
  const key = `text-${layerId}`;
  const layers = state.designTextLayers.filter((layer) => layer.id !== Number(layerId));
  setState({ designTextLayers: layers, designLayerOrder: getOrderedLayerKeys().filter((item) => item !== key) });
}

function moveLayer(layerKey, direction) {
  const order = [...getOrderedLayerKeys()];
  const idx = order.findIndex((key) => key === layerKey);
  if (idx < 0) return;
  const target = direction === 'up' ? idx - 1 : idx + 1;
  if (target < 0 || target >= order.length) return;
  const [item] = order.splice(idx, 1);
  order.splice(target, 0, item);
  setState({ designLayerOrder: order });
}


function toggleLayerCollapsed(layerKey) {
  setState({
    designCollapsedLayers: {
      ...state.designCollapsedLayers,
      [layerKey]: !state.designCollapsedLayers[layerKey],
    },
  });
}

function setDesignTemplateSize(size) {
  if (!TEMPLATE_SIZES.some((item) => item.id === size)) return;
  setState({ designTemplateSize: size });
}


function addAssetLayer() {
  if (state.designAssetLayer) return;
  setState({
    designAssetLayer: { id: 'asset-base', name: 'Stage Asset', transform: defaultTransform('asset') },
    designLayerOrder: ['asset-base', ...getOrderedLayerKeys()],
  });
}

function removeAssetLayer() {
  if (!state.designAssetLayer) return;
  setState({
    designAssetLayer: null,
    designLayerOrder: getOrderedLayerKeys().filter((key) => key !== 'asset-base'),
    designCollapsedLayers: { ...state.designCollapsedLayers, 'asset-base': false },
    designRenamingLayerKey: state.designRenamingLayerKey === 'asset-base' ? null : state.designRenamingLayerKey,
    designRenamingLayerValue: state.designRenamingLayerKey === 'asset-base' ? '' : state.designRenamingLayerValue,
  });
}

function toggleTreeFolder(folderId) {
  setState({
    designTreeExpanded: {
      ...state.designTreeExpanded,
      [folderId]: !state.designTreeExpanded[folderId],
    },
  });
}

function startLayerRename(layerKey, currentName) {
  setState({ designRenamingLayerKey: layerKey, designRenamingLayerValue: currentName });
}

function commitLayerRename(layerKey) {
  if (state.designRenamingLayerKey !== layerKey) return;
  const trimmed = state.designRenamingLayerValue.trim();
  if (!trimmed) {
    setState({ designRenamingLayerKey: null, designRenamingLayerValue: '' });
    return;
  }

  if (layerKey === 'asset-base' && state.designAssetLayer) {
    setState({ designAssetLayer: { ...state.designAssetLayer, name: trimmed }, designRenamingLayerKey: null, designRenamingLayerValue: '' });
    return;
  }

  if (!layerKey.startsWith('text-')) return;
  const id = Number(layerKey.replace('text-', ''));
  const nextLayers = state.designTextLayers.map((layer) => (layer.id === id ? { ...layer, name: trimmed } : layer));
  setState({ designTextLayers: nextLayers, designRenamingLayerKey: null, designRenamingLayerValue: '' });
}

function cancelLayerRename() {
  if (!state.designRenamingLayerKey) return;
  setState({ designRenamingLayerKey: null, designRenamingLayerValue: '' });
}

function detectImageSize(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, src: reader.result });
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadToCurrentFolder(files) {
  const folder = getCurrentFolder();
  if (!folder || folder.type !== 'folder') return;

  const nextExplorer = cloneValue(state.explorer);
  const nextFolder = nextExplorer.nodes.find((node) => node.id === folder.id);

  for (const file of files) {
    const metadata = await detectImageSize(file);
    const dimension = `${metadata.width}x${metadata.height}`;
    const newFile = makeFile({
      name: file.name,
      parentId: nextFolder.id,
      src: metadata.src,
      dimension,
    });
    newFile.srcRef = newFile.id;
    await storeAssetDataUrl(newFile.id, metadata.src);

    nextFolder.children.push(newFile.id);
    nextExplorer.nodes.push(newFile);
  }

  setState({ explorer: nextExplorer });
}


async function uploadToTemplateCurrentFolder(files) {
  const folder = getTemplateCurrentFolder();
  if (!folder || folder.type !== 'folder') return;

  const nextExplorer = cloneValue(state.templateExplorer);
  const nextFolder = nextExplorer.nodes.find((node) => node.id === folder.id);

  for (const file of files) {
    const metadata = await detectImageSize(file);
    const dimension = `${metadata.width}x${metadata.height}`;
    const newFile = makeFile({
      name: file.name,
      parentId: nextFolder.id,
      src: metadata.src,
      dimension,
    });
    newFile.srcRef = newFile.id;
    await storeAssetDataUrl(newFile.id, metadata.src);

    nextFolder.children.push(newFile.id);
    nextExplorer.nodes.push(newFile);
  }

  setState({ templateExplorer: nextExplorer });
}

function toggleTemplateTreeFolder(folderId) {
  setState({
    templateTreeExpanded: {
      ...state.templateTreeExpanded,
      [folderId]: !state.templateTreeExpanded[folderId],
    },
  });
}

function wireBrandedAssetInteractions() {
  const toggleButton = document.getElementById('toggleBrandedAssets');
  if (toggleButton) toggleButton.addEventListener('click', () => setState({ brandedAssetsOpen: !state.brandedAssetsOpen }));

  const toggleTemplateButton = document.getElementById('toggleTemplateLibrary');
  if (toggleTemplateButton) toggleTemplateButton.addEventListener('click', () => setState({ templatesLibraryOpen: !state.templatesLibraryOpen }));

  const requestFolderName = (title, initialValue = '') => {
    const value = window.prompt(title, initialValue);
    return typeof value === 'string' ? value.trim() : '';
  };

  const createFolderBtn = document.getElementById('createFolderBtn');
  if (createFolderBtn) {
    createFolderBtn.addEventListener('click', () => {
      const name = requestFolderName('Name this new folder');
      if (name) createSubfolder(name);
    });
  }

  const templateCreateFolderBtn = document.getElementById('templateCreateFolderBtn');
  if (templateCreateFolderBtn) {
    templateCreateFolderBtn.addEventListener('click', () => {
      const name = requestFolderName('Name this new folder');
      if (name) createTemplateSubfolder(name);
    });
  }

  const assetSearchInput = document.getElementById('assetSearchInput');
  if (assetSearchInput) {
    assetSearchInput.addEventListener('input', () => setState({ assetSearchQuery: assetSearchInput.value }));
  }

  const templateSearchInput = document.getElementById('templateSearchInput');
  if (templateSearchInput) {
    templateSearchInput.addEventListener('input', () => setState({ templateSearchQuery: templateSearchInput.value }));
  }

  const deleteFolderBtn = document.getElementById('deleteFolderBtn');
  if (deleteFolderBtn) deleteFolderBtn.addEventListener('click', () => deleteFolder(state.currentFolderId));

  const templateDeleteFolderBtn = document.getElementById('templateDeleteFolderBtn');
  if (templateDeleteFolderBtn) templateDeleteFolderBtn.addEventListener('click', () => deleteTemplateFolder(state.templateCurrentFolderId));

  const uploadInput = document.getElementById('brandAssetUpload');
  if (uploadInput) {
    uploadInput.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []).filter((file) => ['image/png', 'image/jpeg'].includes(file.type) || /\.(png|jpe?g)$/i.test(file.name));
      if (!files.length) return;
      await uploadToCurrentFolder(files);
    });
  }

  const templateUploadInput = document.getElementById('templateAssetUpload');
  if (templateUploadInput) {
    templateUploadInput.addEventListener('change', async (event) => {
      const files = Array.from(event.target.files || []).filter((file) => ['image/png', 'image/jpeg'].includes(file.type) || /\.(png|jpe?g)$/i.test(file.name));
      if (!files.length) return;
      await uploadToTemplateCurrentFolder(files);
    });
  }

  document.querySelectorAll('[data-open-folder-id]').forEach((el) => el.addEventListener('click', () => navigateToFolder(el.dataset.openFolderId)));
  document.querySelectorAll('[data-toggle-tree-id]').forEach((el) => el.addEventListener('click', () => toggleTreeFolder(el.dataset.toggleTreeId)));
  document.querySelectorAll('[data-rename-folder-id]').forEach((el) => {
    el.addEventListener('dblclick', (event) => {
      event.preventDefault();
      startFolderRename(el.dataset.renameFolderId);
    });
  });

  document.querySelectorAll('[data-rename-input-id]').forEach((input) => {
    input.focus();
    input.select();
    input.addEventListener('input', () => setState({ renamingFolderValue: input.value }));
    input.addEventListener('blur', () => commitFolderRename(input.dataset.renameInputId));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commitFolderRename(input.dataset.renameInputId);
      if (event.key === 'Escape') cancelFolderRename();
    });
  });

  document.querySelectorAll('[data-crumb-id]').forEach((el) => el.addEventListener('click', () => navigateToFolder(el.dataset.crumbId)));
  document.querySelectorAll('[data-asset-id]').forEach((row) => row.addEventListener('click', () => setState({ designSelectedAssetId: row.dataset.assetId, activeTab: 'Design' })));
  document.querySelectorAll('[data-template-id]').forEach((row) => row.addEventListener('click', () => applyTemplateToDesign(row.dataset.templateId)));

  document.querySelectorAll('[data-template-open-folder-id]').forEach((el) => el.addEventListener('click', () => navigateToTemplateFolder(el.dataset.templateOpenFolderId)));
  document.querySelectorAll('[data-template-toggle-tree-id]').forEach((el) => el.addEventListener('click', () => toggleTemplateTreeFolder(el.dataset.templateToggleTreeId)));
  document.querySelectorAll('[data-template-rename-folder-id]').forEach((el) => {
    el.addEventListener('dblclick', (event) => {
      event.preventDefault();
      startTemplateFolderRename(el.dataset.templateRenameFolderId);
    });
  });

  document.querySelectorAll('[data-template-rename-input-id]').forEach((input) => {
    input.focus();
    input.select();
    input.addEventListener('input', () => setState({ templateRenamingFolderValue: input.value }));
    input.addEventListener('blur', () => commitTemplateFolderRename(input.dataset.templateRenameInputId));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commitTemplateFolderRename(input.dataset.templateRenameInputId);
      if (event.key === 'Escape') cancelTemplateFolderRename();
    });
  });

  document.querySelectorAll('[data-template-crumb-id]').forEach((el) => el.addEventListener('click', () => navigateToTemplateFolder(el.dataset.templateCrumbId)));

  const currentFolder = getCurrentFolder();
  const ownersInput = document.getElementById('ownersInput');
  const editorsInput = document.getElementById('editorsInput');
  const viewersInput = document.getElementById('viewersInput');
  if (ownersInput) ownersInput.addEventListener('change', () => setFolderPermissions(currentFolder.id, 'owners', ownersInput.value));
  if (editorsInput) editorsInput.addEventListener('change', () => setFolderPermissions(currentFolder.id, 'editors', editorsInput.value));
  if (viewersInput) viewersInput.addEventListener('change', () => setFolderPermissions(currentFolder.id, 'viewers', viewersInput.value));

  const templateCurrentFolder = getTemplateCurrentFolder();
  const templateOwnersInput = document.getElementById('templateOwnersInput');
  const templateEditorsInput = document.getElementById('templateEditorsInput');
  const templateViewersInput = document.getElementById('templateViewersInput');
  if (templateOwnersInput) templateOwnersInput.addEventListener('change', () => setTemplateFolderPermissions(templateCurrentFolder.id, 'owners', templateOwnersInput.value));
  if (templateEditorsInput) templateEditorsInput.addEventListener('change', () => setTemplateFolderPermissions(templateCurrentFolder.id, 'editors', templateEditorsInput.value));
  if (templateViewersInput) templateViewersInput.addEventListener('change', () => setTemplateFolderPermissions(templateCurrentFolder.id, 'viewers', templateViewersInput.value));
}

function wireDesignInteractions() {
  document.querySelectorAll('[data-design-asset-id]').forEach((button) => {
    button.addEventListener('click', () => setState({ designSelectedAssetId: button.dataset.designAssetId }));
  });

  const newTemplateBtn = document.getElementById('newTemplateBtn');
  if (newTemplateBtn) newTemplateBtn.addEventListener('click', saveCurrentDesignTemplate);

  const saveTemplateBtn = document.getElementById('saveTemplateBtn');
  if (saveTemplateBtn) saveTemplateBtn.addEventListener('click', saveCurrentDesignTemplate);

  const addAssetLayerButton = document.getElementById('addAssetLayer');
  if (addAssetLayerButton) addAssetLayerButton.addEventListener('click', addAssetLayer);

  const addLayerButton = document.getElementById('addTextLayer');
  if (addLayerButton) addLayerButton.addEventListener('click', addTextLayer);

  document.querySelectorAll('[data-remove-layer-id]').forEach((button) => {
    button.addEventListener('click', () => removeTextLayer(button.dataset.removeLayerId));
  });

  const removeAssetLayerButton = document.querySelector('[data-remove-asset-layer]');
  if (removeAssetLayerButton) removeAssetLayerButton.addEventListener('click', removeAssetLayer);

  document.querySelectorAll('[data-layer-id]').forEach((control) => {
    control.addEventListener('change', () => updateLayer(control.dataset.layerId, control.dataset.prop, control.value));
  });

  document.querySelectorAll('[data-move-layer-key]').forEach((button) => {
    button.addEventListener('click', () => moveLayer(button.dataset.moveLayerKey, button.dataset.dir));
  });

  document.querySelectorAll('[data-transform-layer-id]').forEach((control) => {
    control.addEventListener('change', () => updateLayerTransform(control.dataset.transformLayerId, control.dataset.transformProp, control.value));
  });

  document.querySelectorAll('[data-toggle-layer-scale-lock]').forEach((button) => {
    button.addEventListener('click', () => toggleLayerScaleLock(button.dataset.toggleLayerScaleLock));
  });

  document.querySelectorAll('[data-reset-layer-transform]').forEach((button) => {
    button.addEventListener('click', () => resetLayerTransform(button.dataset.resetLayerTransform));
  });

  document.querySelectorAll('[data-asset-transform-prop]').forEach((control) => {
    control.addEventListener('change', () => updateAssetTransform(control.dataset.assetTransformProp, control.value));
  });

  const assetScaleLock = document.querySelector('[data-toggle-asset-scale-lock]');
  if (assetScaleLock) assetScaleLock.addEventListener('click', toggleAssetScaleLock);

  const assetReset = document.querySelector('[data-reset-asset-transform]');
  if (assetReset) assetReset.addEventListener('click', resetAssetTransform);

  const templateSizeSelect = document.getElementById('designTemplateSize');
  if (templateSizeSelect) templateSizeSelect.addEventListener('change', () => setDesignTemplateSize(templateSizeSelect.value));


  document.querySelectorAll('[data-rename-layer-key]').forEach((el) => {
    el.addEventListener('dblclick', () => startLayerRename(el.dataset.renameLayerKey, el.textContent.trim()));
  });

  document.querySelectorAll('[data-layer-rename-input]').forEach((input) => {
    input.focus();
    input.select();
    input.addEventListener('input', () => setState({ designRenamingLayerValue: input.value }));
    input.addEventListener('blur', () => commitLayerRename(input.dataset.layerRenameInput));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commitLayerRename(input.dataset.layerRenameInput);
      if (event.key === 'Escape') cancelLayerRename();
    });
  });
  document.querySelectorAll('[data-toggle-layer-collapse]').forEach((button) => {
    button.addEventListener('click', () => toggleLayerCollapsed(button.dataset.toggleLayerCollapse));
  });
}


function wireControlRoomInteractions() {
  document.querySelectorAll('[data-control-template-id]').forEach((button) => {
    button.addEventListener('click', () => setState({ selectedControlTemplateId: button.dataset.controlTemplateId }));
  });

  const takeLiveButton = document.getElementById('takeTemplateLiveBtn');
  if (takeLiveButton) {
    takeLiveButton.addEventListener('click', () => {
      const selected = state.selectedControlTemplateId || state.templates[0]?.id;
      if (!selected) return;
      setState({ controlProgramTemplateId: selected });
    });
  }

  const loadTemplateButton = document.getElementById('loadTemplateToDesignBtn');
  if (loadTemplateButton) {
    loadTemplateButton.addEventListener('click', () => {
      const selected = state.selectedControlTemplateId || state.templates[0]?.id;
      if (!selected) return;
      applyTemplateToDesign(selected);
    });
  }
}

function wireDataEngineInteractions() {
  const toggleSimulationButton = document.getElementById('toggleSimulation');
  if (toggleSimulationButton) {
    toggleSimulationButton.addEventListener('click', () => {
      if (state.simulationRunning) stopSimulation();
      else startSimulation();
    });
  }

  const speedSelect = document.getElementById('simulationSpeed');
  if (speedSelect) {
    speedSelect.addEventListener('change', (event) => {
      const nextSpeed = Number(event.target.value);
      const wasRunning = state.simulationRunning;
      stopSimulation();
      setState({ simulationSpeedMs: nextSpeed });
      if (wasRunning) startSimulation();
    });
  }

  const resetButton = document.getElementById('resetSimulation');
  if (resetButton) resetButton.addEventListener('click', resetSimulation);
}

function wireInteractions() {
  wireBrandedAssetInteractions();
  wireDesignInteractions();
  wireDataEngineInteractions();
  wireControlRoomInteractions();
}

function render() {
  renderTabs();
  viewContainer.innerHTML = renderView();
  streamButton.textContent = state.isStreaming ? 'Streaming Live' : 'Push to Stream';
  streamButton.classList.toggle('streaming', state.isStreaming);
  wireInteractions();
}

streamButton.addEventListener('click', () => setState({ isStreaming: !state.isStreaming, activeTab: 'Output' }));

state.explorer.nodes.filter((node) => node.type === 'file' && !node.src && (node.srcRef || node.id)).forEach((node) => hydrateAssetSource(node.id));

render();
