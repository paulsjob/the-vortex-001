export type InteractionMode = 'select' | 'pan';

export interface AssetItem {
  id: string;
  name: string;
  src: string;
  dimension: string;
  createdAt: string;
}

export interface FolderNode {
  id: string;
  type: 'folder';
  name: string;
  parentId: string | null;
  children: string[];
  createdAt: string;
  permissions: { owners: string[]; editors: string[]; viewers: string[] };
}

export interface FileNode {
  id: string;
  type: 'file';
  name: string;
  parentId: string;
  src: string;
  dimension: string;
  createdAt: string;
}

export type ExplorerNode = FolderNode | FileNode;
export interface ExplorerState {
  rootId: string;
  nodes: ExplorerNode[];
}

export interface LayerBase {
  id: string;
  name: string;
  x: number;
  y: number;
  zIndex: number;
  opacity: number;
  anchorX: number;
  anchorY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  color: string;
  size: number;
  fontFamily: string;
  dataBindingSource: string;
  dataBindingField: string;
}

export interface ShapeLayer extends LayerBase {
  kind: 'shape';
  width: number;
  height: number;
  fill: string;
}

export interface AssetLayer extends LayerBase {
  kind: 'asset';
  assetId: string;
  width: number;
  height: number;
}

export type Layer = TextLayer | ShapeLayer | AssetLayer;
