/**
 * Minimal, permissive types for the Scratch 3 / SB3 project format.
 *
 * These types intentionally describe the serialized JSON shape, not the
 * scratch-vm runtime objects. Keeping them permissive makes it possible to
 * round-trip projects that use extensions or fields we do not know about.
 */

export type Sb3Scalar = string | number | boolean | null;

export interface Sb3Meta {
  semver?: string;
  vm?: string;
  agent?: string;
  origin?: string;
  [key: string]: unknown;
}

export interface Sb3Costume {
  name: string;
  assetId: string;
  dataFormat: string;
  md5ext?: string;
  rotationCenterX?: number;
  rotationCenterY?: number;
  bitmapResolution?: number;
  [key: string]: unknown;
}

export interface Sb3Sound {
  name: string;
  assetId: string;
  dataFormat: string;
  md5ext?: string;
  rate?: number;
  sampleCount?: number;
  [key: string]: unknown;
}

export type Sb3FieldValue =
  | string
  | number
  | boolean
  | null
  | Array<string | null>;

export type Sb3Primitive = [number, ...unknown[]];

export type Sb3Input =
  | [1, Sb3Primitive | string]
  | [2, string | null]
  | [3, string, Sb3Primitive];

export interface Sb3Mutation {
  tagName?: string;
  children?: unknown[];
  proccode?: string;
  argumentids?: string;
  warp?: string | boolean;
  hasnext?: string | boolean;
  [key: string]: unknown;
}

export interface Sb3Block {
  opcode: string;
  next?: string | null;
  parent?: string | null;
  inputs?: Record<string, Sb3Input>;
  fields?: Record<string, Sb3FieldValue>;
  shadow?: boolean;
  topLevel?: boolean;
  x?: number;
  y?: number;
  mutation?: Sb3Mutation;
  comment?: string;
  [key: string]: unknown;
}

export type Sb3TopLevelPrimitive = Sb3Primitive;

export type Sb3BlockEntry = Sb3Block | Sb3TopLevelPrimitive;

export interface Sb3Variable {
  0: string;
  1: Sb3Scalar;
  2?: boolean;
}

export type Sb3VariableEntry = [string, Sb3Scalar, boolean?];

export type Sb3ListEntry = [string, Sb3Scalar[]];

export interface Sb3Comment {
  text: string;
  blockId?: string | null;
  minimized?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  [key: string]: unknown;
}

export interface Sb3Target {
  name: string;
  isStage: boolean;
  variables: Record<string, Sb3VariableEntry>;
  lists: Record<string, Sb3ListEntry>;
  broadcasts: Record<string, string>;
  blocks: Record<string, Sb3BlockEntry>;
  comments: Record<string, Sb3Comment>;
  currentCostume: number;
  costumes: Sb3Costume[];
  sounds: Sb3Sound[];
  volume: number;
  layerOrder: number;

  // Stage-only
  tempo?: number;
  videoTransparency?: number;
  videoState?: "on" | "off" | "on-flipped" | string;
  textToSpeechLanguage?: string | null;

  // Sprite-only
  visible?: boolean;
  x?: number;
  y?: number;
  size?: number;
  direction?: number;
  draggable?: boolean;
  rotationStyle?: "all around" | "left-right" | "don't rotate" | string;
}

export interface Sb3Project {
  meta: Sb3Meta;
  targets: Sb3Target[];
  extensions?: string[];
  projectVersion?: number;
  [key: string]: unknown;
}

export interface LoadedProject {
  project: Sb3Project;
  /** Asset bytes keyed by md5ext (for example "0123....svg"). */
  assets: Map<string, Uint8Array>;
  sourcePath: string | null;
  displayName: string;
  dirty: boolean;
  loadedAt: string;
}

export interface TargetSummary {
  name: string;
  isStage: boolean;
  visible?: boolean;
  x?: number;
  y?: number;
  size?: number;
  direction?: number;
  currentCostume: number;
  currentCostumeName: string | null;
  costumeCount: number;
  costumes: Sb3Costume[];
  soundCount: number;
  sounds: Sb3Sound[];
  blockCount: number;
  scriptCount: number;
  variableCount: number;
  listCount: number;
}

export interface ScriptAst {
  index: number;
  kind: "script" | "reporter";
  rootId: string;
  x: number;
  y: number;
  stack: BlockAst[];
}

export interface BlockAst {
  id: string;
  opcode: string;
  shadow: boolean;
  fields: Record<string, Sb3FieldValue>;
  inputs: Record<string, InputAst>;
  mutation?: Sb3Mutation;
  error?: string;
}

export type InputAst =
  | { type: "literal"; value: unknown; primitiveType: string }
  | { type: "menu"; value: unknown; opcode?: string; fields?: Record<string, Sb3FieldValue> }
  | { type: "block"; block: BlockAst; shadow?: InputAst }
  | { type: "stack"; stack: BlockAst[] }
  | { type: "empty" }
  | { type: "shadowBlock"; block: BlockAst };

export interface CompileWarning {
  code: string;
  message: string;
}
