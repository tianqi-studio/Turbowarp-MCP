import { AppError } from "../errors.js";
import { newUniqueId } from "../utils/ids.js";
import { normalizeColor } from "./assets.js";
import { isSb3Block, nextScriptPosition } from "./project.js";
import {
  getOpcodeSpec,
  isCapOpcode,
  isHatOpcode,
  isValueOpcode,
  PRIMITIVE_BY_KIND,
  resolveOpcode,
  type FieldKind,
  type FieldSpec,
  type InputKind,
  type InputSpec
} from "./registry.js";
import type {
  CompileWarning,
  Sb3Block,
  Sb3FieldValue,
  Sb3Input,
  Sb3Project,
  Sb3Target
} from "./types.js";
import {
  ensureBroadcast,
  ensureList,
  ensureVariable,
  type VariableScope
} from "./variables.js";

export interface VariableInputValue {
  variable: string;
  scope?: VariableScope;
}

export interface ListInputValue {
  list: string;
  scope?: VariableScope;
}

export interface BroadcastInputValue {
  broadcast: string;
}

export interface MenuInputValue {
  menu: string | number;
  opcode?: string;
  field?: string;
}

export interface LiteralInputValue {
  value: string | number | boolean;
  type?: InputKind | "text";
}

export interface NestedBlockInputValue {
  block: BlockSpec;
}

export interface RawInputValue {
  raw: Sb3Input;
}

export type BlockInputValue =
  | string
  | number
  | boolean
  | null
  | VariableInputValue
  | ListInputValue
  | BroadcastInputValue
  | MenuInputValue
  | LiteralInputValue
  | NestedBlockInputValue
  | RawInputValue;

export type FieldInputValue =
  | string
  | number
  | boolean
  | [string, string | null]
  | VariableInputValue
  | ListInputValue
  | BroadcastInputValue;

export interface BlockSpec {
  opcode: string;
  inputs?: Record<string, BlockInputValue>;
  fields?: Record<string, FieldInputValue>;
  substacks?: Record<string, BlockSpec[]>;
  mutation?: Record<string, unknown>;
  shadow?: boolean;
  id?: string;
  x?: number;
  y?: number;
}

export type InsertMode = "new" | "append" | "start" | "after" | "substack";
export type SubstackPosition = "start" | "end";

export interface InsertBlocksRequest {
  project: Sb3Project;
  target: Sb3Target;
  mode: InsertMode;
  blocks: BlockSpec[];
  blockId?: string;
  substack?: string;
  position?: SubstackPosition;
  x?: number;
  y?: number;
}

export interface InsertBlocksResult {
  rootId: string;
  ids: string[];
  warnings: CompileWarning[];
}

interface CompileState {
  project: Sb3Project;
  target: Sb3Target;
  newBlocks: Map<string, Sb3Block>;
  ids: string[];
  warnings: CompileWarning[];
}

interface CreateOptions {
  parentId: string | null;
  topLevel: boolean;
  x?: number;
  y?: number;
  shadow?: boolean;
}

function warn(state: CompileState, code: string, message: string): void {
  if (!state.warnings.some((warning) => warning.code === code && warning.message === message)) {
    state.warnings.push({ code, message });
  }
}

function blockIdExists(state: CompileState, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.target.blocks, id) || state.newBlocks.has(id);
}

function allocateId(state: CompileState, requested?: string): string {
  if (requested !== undefined) {
    const trimmed = requested.trim();
    if (!trimmed) {
      throw new AppError("INVALID_BLOCK_ID", "Block id must not be empty.");
    }
    if (blockIdExists(state, trimmed)) {
      throw new AppError("DUPLICATE_BLOCK_ID", `A block with id "${trimmed}" already exists.`);
    }
    return trimmed;
  }
  return newUniqueId({ has: (candidate: string) => blockIdExists(state, candidate) });
}

function primitiveFor(kind: InputKind | undefined): number {
  return (kind && PRIMITIVE_BY_KIND[kind]) || 10;
}

function numericValue(value: string | number | boolean): string | number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  const trimmed = value.trim();
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return value;
}

function makePrimitive(
  kind: InputKind | undefined,
  value: string | number | boolean,
  explicitType?: InputKind | "text"
): Sb3Input {
  if (kind === "color" || explicitType === "color") {
    return [1, [9, normalizeColor(String(value))]];
  }

  const effective = explicitType === "text" ? "string" : explicitType ?? kind;
  const primitive = primitiveFor(effective);
  if (effective === "boolean") {
    return [1, [10, typeof value === "boolean" ? (value ? "true" : "false") : String(value)]];
  }
  if (effective === "number" || effective === "positive_number" || effective === "positive_integer" || effective === "integer" || effective === "angle") {
    return [1, [primitive, numericValue(value)]];
  }
  return [1, [primitive, String(value)]];
}

function resolveDefaultField(
  state: CompileState,
  spec: FieldSpec | undefined,
  name: string
): Sb3FieldValue {
  const kind: FieldKind =
    spec?.kind ?? (name === "VARIABLE" ? "variable" : name === "LIST" ? "list" : name === "BROADCAST_OPTION" ? "broadcast" : "plain");

  if (kind === "variable") {
    const info = ensureVariable(state.project, state.target, spec?.default || "my variable", "auto");
    return [info.name, info.id];
  }
  if (kind === "list") {
    const info = ensureList(state.project, state.target, spec?.default || "list1", "auto");
    return [info.name, info.id];
  }
  if (kind === "broadcast") {
    const info = ensureBroadcast(state.project, spec?.default || "message1");
    return [info.name, info.id];
  }
  return [spec?.default ?? ""];
}

function compileField(
  state: CompileState,
  spec: FieldSpec | undefined,
  name: string,
  value: FieldInputValue
): Sb3FieldValue {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    if ("variable" in value) {
      const info = ensureVariable(state.project, state.target, value.variable, value.scope ?? "auto");
      return [info.name, info.id];
    }
    if ("list" in value) {
      const info = ensureList(state.project, state.target, value.list, value.scope ?? "auto");
      return [info.name, info.id];
    }
    if ("broadcast" in value) {
      const info = ensureBroadcast(state.project, value.broadcast);
      return [info.name, info.id];
    }
    throw new AppError("INVALID_FIELD", `Field "${name}" has an unsupported value.`);
  }

  const kind: FieldKind =
    spec?.kind ?? (name === "VARIABLE" ? "variable" : name === "LIST" ? "list" : name === "BROADCAST_OPTION" ? "broadcast" : "plain");
  if (kind === "variable") {
    const info = ensureVariable(state.project, state.target, String(value), "auto");
    return [info.name, info.id];
  }
  if (kind === "list") {
    const info = ensureList(state.project, state.target, String(value), "auto");
    return [info.name, info.id];
  }
  if (kind === "broadcast") {
    const info = ensureBroadcast(state.project, String(value));
    return [info.name, info.id];
  }
  return [String(value)];
}

function defaultMenuValue(
  state: CompileState,
  menuOpcode: string
): string | number {
  switch (menuOpcode) {
    case "looks_costume":
      return state.target.costumes?.[0]?.name ?? "";
    case "looks_backdrops": {
      const stage = state.project.targets.find((target) => target.isStage);
      return stage?.costumes?.[0]?.name ?? "";
    }
    case "sound_sounds_menu":
      return state.target.sounds?.[0]?.name ?? "";
    case "sensing_of_object_menu":
      return "_stage_";
    case "control_create_clone_of_menu":
      return "_myself_";
    case "event_touchingobjectmenu":
    case "sensing_touchingobjectmenu":
      return "_mouse_";
    case "sensing_distancetomenu":
      return "_mouse_";
    case "sensing_keyoptions":
      return "space";
    case "event_broadcast_menu": {
      const info = ensureBroadcast(state.project, "message1");
      return info.name;
    }
    default: {
      const spec = getOpcodeSpec(menuOpcode);
      return spec?.fields[0]?.default ?? "";
    }
  }
}

function createMenuShadow(
  state: CompileState,
  menuOpcode: string,
  value: string | number,
  parentId: string,
  fieldOverride?: string
): string {
  const resolved = resolveOpcode(menuOpcode);
  const spec = getOpcodeSpec(resolved);
  if (!spec || spec.shape !== "menu") {
    throw new AppError(
      "UNKNOWN_MENU",
      `"${menuOpcode}" is not a known Scratch menu block. Pass a raw input instead.`
    );
  }
  const fieldName = fieldOverride ?? spec.fields[0]?.name;
  if (!fieldName) {
    throw new AppError("INVALID_MENU", `Menu block "${resolved}" has no documented field.`);
  }
  const id = allocateId(state);
  const block: Sb3Block = {
    opcode: resolved,
    next: null,
    parent: parentId,
    inputs: {},
    fields: {},
    shadow: true,
    topLevel: false
  };

  if (spec.fields[0]?.kind === "broadcast") {
    const info = ensureBroadcast(state.project, String(value));
    block.fields![fieldName] = [info.name, info.id];
  } else {
    block.fields![fieldName] = [String(value)];
  }

  state.newBlocks.set(id, block);
  state.ids.push(id);
  return id;
}

function isVariableInput(value: BlockInputValue): value is VariableInputValue {
  return typeof value === "object" && value !== null && "variable" in value;
}

function isListInput(value: BlockInputValue): value is ListInputValue {
  return typeof value === "object" && value !== null && "list" in value;
}

function isBroadcastInput(value: BlockInputValue): value is BroadcastInputValue {
  return typeof value === "object" && value !== null && "broadcast" in value;
}

function isMenuInput(value: BlockInputValue): value is MenuInputValue {
  return typeof value === "object" && value !== null && "menu" in value;
}

function isBlockInput(value: BlockInputValue): value is NestedBlockInputValue {
  return typeof value === "object" && value !== null && "block" in value;
}

function isLiteralInput(value: BlockInputValue): value is LiteralInputValue {
  return typeof value === "object" && value !== null && "value" in value;
}

function isRawInput(value: BlockInputValue): value is RawInputValue {
  return typeof value === "object" && value !== null && "raw" in value;
}

function compileInput(
  state: CompileState,
  def: InputSpec | undefined,
  name: string,
  value: BlockInputValue,
  ownerId: string
): Sb3Input | undefined {
  if (value === null) {
    return [2, null];
  }

  if (isRawInput(value)) {
    return value.raw;
  }

  if (isLiteralInput(value)) {
    if (value.type === "color") {
      return makePrimitive("color", value.value);
    }
    return makePrimitive(def?.kind, value.value, value.type);
  }

  if (isVariableInput(value)) {
    const info = ensureVariable(state.project, state.target, value.variable, value.scope ?? "auto");
    const created = createBlock(
      state,
      {
        opcode: "data_variable",
        fields: { VARIABLE: [info.name, info.id] }
      },
      { parentId: ownerId, topLevel: false }
    );
    return [2, created.rootId];
  }

  if (isListInput(value)) {
    const info = ensureList(state.project, state.target, value.list, value.scope ?? "auto");
    const created = createBlock(
      state,
      {
        opcode: "data_listcontents",
        fields: { LIST: [info.name, info.id] }
      },
      { parentId: ownerId, topLevel: false }
    );
    return [2, created.rootId];
  }

  if (isBroadcastInput(value)) {
    const info = ensureBroadcast(state.project, value.broadcast);
    return [1, [11, info.name, info.id]];
  }

  if (isMenuInput(value)) {
    const menuOpcode = value.opcode ?? def?.menu;
    if (!menuOpcode) {
      throw new AppError(
        "MISSING_MENU",
        `Input "${name}" does not have a default menu. Specify menu.opcode.`
      );
    }
    const id = createMenuShadow(state, menuOpcode, value.menu, ownerId, value.field);
    return [1, id];
  }

  if (isBlockInput(value)) {
    const resolved = resolveOpcode(value.block.opcode);
    const shape = getOpcodeSpec(resolved)?.shape;
    if (shape && !["reporter", "boolean", "menu"].includes(shape) && value.block.shadow !== true) {
      throw new AppError(
        "INVALID_INPUT_BLOCK",
        `Input "${name}" needs a reporter/boolean/menu block, but "${resolved}" is a ${shape} block.`
      );
    }
    const created = createBlock(state, value.block, {
      parentId: ownerId,
      topLevel: false,
      shadow: value.block.shadow ?? shape === "menu"
    });
    if (shape === "menu" || value.block.shadow === true) {
      return [1, created.rootId];
    }
    return [2, created.rootId];
  }

  if (typeof value === "object" && value !== null) {
    throw new AppError(
      "INVALID_INPUT",
      `Input "${name}" has an unsupported object value. Use {"block": ...}, ` +
        `{"variable": ...}, {"list": ...}, {"broadcast": ...}, {"menu": ...}, ` +
        `{"value": ...}, or {"raw": ...}.`
    );
  }

  // Scalar (or boolean) shorthand.
  if (def?.kind === "menu") {
    if (!def.menu) {
      throw new AppError("MISSING_MENU", `Input "${name}" is a menu without a menu opcode.`);
    }
    const id = createMenuShadow(state, def.menu, value as string | number, ownerId);
    return [1, id];
  }

  if (def?.kind === "broadcast" || name === "BROADCAST_INPUT") {
    const info = ensureBroadcast(state.project, String(value));
    return [1, [11, info.name, info.id]];
  }

  if (def?.kind === "boolean") {
    if (typeof value === "boolean") {
      return [1, [10, value ? "true" : "false"]];
    }
    return [1, [10, String(value)]];
  }

  return makePrimitive(def?.kind, value);
}

function createBlock(
  state: CompileState,
  spec: BlockSpec,
  options: CreateOptions
): { rootId: string; ids: string[] } {
  const opcode = resolveOpcode(spec.opcode);
  const opcodeSpec = getOpcodeSpec(opcode);
  if (!opcodeSpec) {
    warn(
      state,
      "UNKNOWN_OPCODE",
      `Opcode "${opcode}" is not in the built-in registry. Defaults and input metadata cannot be applied; verify the block manually.`
    );
  }

  const id = allocateId(state, spec.id);
  const block: Sb3Block = {
    opcode,
    next: null,
    parent: options.parentId,
    inputs: {},
    fields: {},
    shadow: options.shadow ?? spec.shadow ?? false,
    topLevel: options.topLevel
  };
  if (options.topLevel) {
    block.x = options.x ?? 0;
    block.y = options.y ?? 0;
  }
  if (spec.mutation) {
    block.mutation = { ...spec.mutation };
  }
  state.newBlocks.set(id, block);
  state.ids.push(id);

  const fieldSpecs = new Map<string, FieldSpec>();
  for (const fieldDef of opcodeSpec?.fields ?? []) {
    fieldSpecs.set(fieldDef.name, fieldDef);
    const provided = spec.fields?.[fieldDef.name];
    block.fields![fieldDef.name] =
      provided === undefined
        ? resolveDefaultField(state, fieldDef, fieldDef.name)
        : compileField(state, fieldDef, fieldDef.name, provided);
  }
  for (const [name, provided] of Object.entries(spec.fields ?? {})) {
    if (fieldSpecs.has(name) || provided === undefined) {
      continue;
    }
    block.fields![name] = compileField(state, undefined, name, provided);
  }

  const inputSpecs = new Map<string, InputSpec>();
  for (const inputDef of opcodeSpec?.inputs ?? []) {
    inputSpecs.set(inputDef.name, inputDef);
    const provided = spec.inputs?.[inputDef.name];
    if (provided !== undefined) {
      const compiled = compileInput(state, inputDef, inputDef.name, provided, id);
      if (compiled !== undefined) {
        block.inputs![inputDef.name] = compiled;
      }
      continue;
    }

    if (inputDef.kind === "menu" && inputDef.menu) {
      const defaultValue = defaultMenuValue(state, inputDef.menu);
      const menuId = createMenuShadow(state, inputDef.menu, defaultValue, id);
      block.inputs![inputDef.name] = [1, menuId];
      continue;
    }

    if (inputDef.default !== undefined) {
      block.inputs![inputDef.name] = makePrimitive(inputDef.kind, inputDef.default);
    }
  }

  for (const [name, provided] of Object.entries(spec.inputs ?? {})) {
    if (inputSpecs.has(name) || provided === undefined) {
      continue;
    }
    const compiled = compileInput(state, undefined, name, provided, id);
    if (compiled !== undefined) {
      block.inputs![name] = compiled;
    }
  }

  const substackNames = new Set<string>(opcodeSpec?.substacks ?? []);
  for (const name of substackNames) {
    const provided = spec.substacks?.[name];
    if (provided === undefined) {
      continue;
    }
    if (provided.length === 0) {
      block.inputs![name] = [2, null];
      continue;
    }
    const created = createChain(state, provided, {
      parentId: id,
      topLevel: false
    });
    block.inputs![name] = [2, created.rootId];
  }

  for (const [name, provided] of Object.entries(spec.substacks ?? {})) {
    if (substackNames.has(name) || !provided || provided.length === 0) {
      continue;
    }
    if (!name.startsWith("SUBSTACK")) {
      warn(state, "CUSTOM_SUBSTACK", `Input "${name}" is not a standard SUBSTACK input.`);
    }
    const created = createChain(state, provided, {
      parentId: id,
      topLevel: false
    });
    block.inputs![name] = [2, created.rootId];
  }

  return { rootId: id, ids: [id] };
}

function createChain(
  state: CompileState,
  specs: BlockSpec[],
  options: Omit<CreateOptions, "shadow">
): { rootId: string; ids: string[] } {
  if (specs.length === 0) {
    throw new AppError("EMPTY_STACK", "A block chain must contain at least one block.");
  }

  const ids: string[] = [];
  let rootId: string | null = null;
  let previousId: string | null = null;

  for (let index = 0; index < specs.length; index += 1) {
    const created = createBlock(state, specs[index], {
      parentId: index === 0 ? options.parentId : previousId,
      topLevel: options.topLevel && index === 0,
      x: index === 0 ? options.x : undefined,
      y: index === 0 ? options.y : undefined
    });

    if (index === 0) {
      rootId = created.rootId;
    } else if (previousId) {
      const previous = state.newBlocks.get(previousId);
      if (!previous) {
        throw new AppError("INTERNAL_ERROR", "Lost a newly created block while linking a stack.");
      }
      previous.next = created.rootId;
    }

    ids.push(created.rootId);
    previousId = created.rootId;
  }

  if (!rootId) {
    throw new AppError("EMPTY_STACK", "A block chain must contain at least one block.");
  }
  return { rootId, ids };
}

function validateChain(
  specs: BlockSpec[],
  mode: InsertMode,
  warnings: CompileWarning[],
  isSubstack = false
): void {
  if (specs.length === 0) {
    throw new AppError("EMPTY_STACK", "Provide at least one block.");
  }

  specs.forEach((blockSpec, index) => {
    const opcode = resolveOpcode(blockSpec.opcode);
    const spec = getOpcodeSpec(opcode);
    const shape = spec?.shape;

    if (!spec) {
      if (!warnings.some((warning) => warning.code === "UNKNOWN_OPCODE" && warning.message.includes(opcode))) {
        warnings.push({
          code: "UNKNOWN_OPCODE",
          message: `Opcode "${opcode}" is not in the built-in registry. Verify it in TurboWarp before exporting.`
        });
      }
    }

    if (blockSpec.shadow === true && shape !== "menu") {
      throw new AppError("INVALID_SHADOW", `Only menu blocks may be marked shadow: true ("${opcode}").`);
    }

    if (shape === "menu") {
      throw new AppError("INVALID_STATEMENT", `Menu block "${opcode}" cannot be used as a statement.`);
    }

    if (shape === "hat") {
      if (index > 0) {
        throw new AppError("INVALID_HAT", `Hat block "${opcode}" must be the first block in a script.`);
      }
      if (mode !== "new") {
        throw new AppError(
          "INVALID_HAT",
          `Hat block "${opcode}" can only be inserted with mode "new"; a hat cannot be nested or attached after another block.`
        );
      }
    }

    if (isValueOpcode(opcode)) {
      if (index > 0 || specs.length > 1) {
        throw new AppError("INVALID_STATEMENT", `Reporter/boolean block "${opcode}" cannot be followed by another block.`);
      }
      if (mode !== "new") {
        throw new AppError(
          "INVALID_STATEMENT",
          `Reporter/boolean block "${opcode}" can only be inserted as a standalone top-level block with mode "new".`
        );
      }
    }

    if (isCapOpcode(opcode) && index !== specs.length - 1) {
      throw new AppError("INVALID_CAP", `Cap block "${opcode}" must be the last block in a stack.`);
    }

    for (const substack of Object.values(blockSpec.substacks ?? {})) {
      if (substack && substack.length > 0) {
        validateChain(substack, "substack", warnings, true);
      }
    }

    for (const inputValue of Object.values(blockSpec.inputs ?? {})) {
      if (isBlockInput(inputValue)) {
        const nestedOpcode = resolveOpcode(inputValue.block.opcode);
        const nestedShape = getOpcodeSpec(nestedOpcode)?.shape;
        if (nestedShape && !["reporter", "boolean", "menu"].includes(nestedShape)) {
          throw new AppError(
            "INVALID_INPUT_BLOCK",
            `Nested input for "${opcode}" must be a reporter, boolean, or menu block; got ${nestedShape}.`
          );
        }
      }
    }
  });

  if (isSubstack) {
    const firstShape = getOpcodeSpec(resolveOpcode(specs[0].opcode))?.shape;
    if (firstShape === "hat") {
      throw new AppError("INVALID_HAT", "Hat blocks cannot be placed inside a substack.");
    }
  }
}

export function lastBlockInChain(target: Sb3Target, blockId: string): string {
  const visited = new Set<string>();
  let currentId = blockId;
  for (let guard = 0; guard < 100_000; guard += 1) {
    if (visited.has(currentId)) {
      throw new AppError("BLOCK_CYCLE", `The script contains a cycle at block "${currentId}".`);
    }
    visited.add(currentId);
    const entry = target.blocks[currentId];
    if (!isSb3Block(entry)) {
      throw new AppError("BLOCK_NOT_FOUND", `Block "${currentId}" was not found in target "${target.name}".`);
    }
    const next = typeof entry.next === "string" ? entry.next : null;
    if (!next) {
      return currentId;
    }
    currentId = next;
  }
  throw new AppError("BLOCK_CYCLE", "The script is too long or contains a cycle.");
}

function requireBlock(target: Sb3Target, blockId: string): Sb3Block {
  const entry = target.blocks[blockId];
  if (!isSb3Block(entry)) {
    throw new AppError(
      "BLOCK_NOT_FOUND",
      `Block "${blockId}" was not found in target "${target.name}".`
    );
  }
  return entry;
}

function lastIdInNewChain(state: CompileState, blockId: string): string {
  const visited = new Set<string>();
  let currentId = blockId;
  for (let guard = 0; guard < 100_000; guard += 1) {
    if (visited.has(currentId)) {
      throw new AppError("BLOCK_CYCLE", `The new script contains a cycle at block "${currentId}".`);
    }
    visited.add(currentId);
    const block = state.newBlocks.get(currentId);
    if (!block) {
      throw new AppError("INTERNAL_ERROR", `New block "${currentId}" disappeared while linking a script.`);
    }
    const next = typeof block.next === "string" ? block.next : null;
    if (!next) {
      return currentId;
    }
    currentId = next;
  }
  throw new AppError("BLOCK_CYCLE", "The new script is too long or contains a cycle.");
}

export function insertBlocks(request: InsertBlocksRequest): InsertBlocksResult {
  const { project, target, mode, blocks } = request;
  if (blocks.length === 0) {
    throw new AppError("EMPTY_STACK", "Provide at least one block to insert.");
  }

  const warnings: CompileWarning[] = [];
  validateChain(blocks, mode, warnings);

  const state: CompileState = {
    project,
    target,
    newBlocks: new Map<string, Sb3Block>(),
    ids: [],
    warnings
  };

  if (mode === "new") {
    const position = nextScriptPosition(target);
    const created = createChain(state, blocks, {
      parentId: null,
      topLevel: true,
      x: request.x ?? position.x,
      y: request.y ?? position.y
    });
    for (const [id, block] of state.newBlocks) {
      target.blocks[id] = block;
    }
    return { rootId: created.rootId, ids: state.ids, warnings };
  }

  if (!request.blockId) {
    throw new AppError("MISSING_ANCHOR", `Insert mode "${mode}" requires block_id.`);
  }

  const anchor = requireBlock(target, request.blockId);
  const anchorShape = getOpcodeSpec(anchor.opcode)?.shape;

  if (mode === "append") {
    if (isValueOpcode(anchor.opcode)) {
      throw new AppError("INVALID_ANCHOR", "Cannot append a statement after a reporter/boolean block.");
    }
    if (isCapOpcode(anchor.opcode)) {
      throw new AppError("INVALID_ANCHOR", `Cannot append after cap block "${anchor.opcode}".`);
    }
    const lastId = lastBlockInChain(target, request.blockId);
    const last = requireBlock(target, lastId);
    if (isCapOpcode(last.opcode)) {
      throw new AppError("INVALID_ANCHOR", `Cannot append after cap block "${last.opcode}".`);
    }

    const created = createChain(state, blocks, {
      parentId: lastId,
      topLevel: false
    });
    for (const [id, block] of state.newBlocks) {
      target.blocks[id] = block;
    }
    last.next = created.rootId;
    return { rootId: created.rootId, ids: state.ids, warnings };
  }

  if (mode === "after") {
    if (isValueOpcode(anchor.opcode)) {
      throw new AppError("INVALID_ANCHOR", "Cannot insert after a reporter/boolean block.");
    }
    if (anchorShape === "cap") {
      throw new AppError("INVALID_ANCHOR", `Cannot insert after cap block "${anchor.opcode}".`);
    }

    const oldNext = typeof anchor.next === "string" ? anchor.next : null;
    if (oldNext) {
      requireBlock(target, oldNext);
    }
    const created = createChain(state, blocks, {
      parentId: request.blockId,
      topLevel: false
    });
    const lastId = lastIdInNewChain(state, created.rootId);
    const last = state.newBlocks.get(lastId);
    if (!last) {
      throw new AppError("INTERNAL_ERROR", "Could not find the last inserted block.");
    }

    for (const [id, block] of state.newBlocks) {
      target.blocks[id] = block;
    }
    anchor.next = created.rootId;
    last.next = oldNext;
    if (oldNext) {
      const oldNextBlock = requireBlock(target, oldNext);
      oldNextBlock.parent = lastId;
    }
    return { rootId: created.rootId, ids: state.ids, warnings };
  }

  if (mode === "start") {
    if (isValueOpcode(anchor.opcode)) {
      throw new AppError("INVALID_ANCHOR", "Cannot insert before a reporter/boolean block.");
    }
    if (isHatOpcode(anchor.opcode)) {
      throw new AppError("INVALID_ANCHOR", "A hat block cannot have a block inserted before it.");
    }

    const wasTopLevel = anchor.topLevel === true;
    const created = createChain(state, blocks, {
      parentId: typeof anchor.parent === "string" ? anchor.parent : null,
      topLevel: wasTopLevel,
      x: wasTopLevel && typeof anchor.x === "number" ? anchor.x : undefined,
      y: wasTopLevel && typeof anchor.y === "number" ? anchor.y : undefined
    });
    const lastId = lastIdInNewChain(state, created.rootId);
    const last = state.newBlocks.get(lastId);
    if (!last) {
      throw new AppError("INTERNAL_ERROR", "Could not find the last inserted block.");
    }

    for (const [id, block] of state.newBlocks) {
      target.blocks[id] = block;
    }
    last.next = request.blockId;
    anchor.parent = lastId;
    if (wasTopLevel) {
      anchor.topLevel = false;
      delete anchor.x;
      delete anchor.y;
    }
    return { rootId: created.rootId, ids: state.ids, warnings };
  }

  // mode === "substack"
  const substackName = request.substack ?? "SUBSTACK";
  const substackSpec = getOpcodeSpec(anchor.opcode);
  const knownSubstack = substackSpec?.substacks.includes(substackName) === true;
  const existingInput = anchor.inputs?.[substackName];
  if (!knownSubstack && existingInput === undefined) {
    throw new AppError(
      "NOT_A_C_BLOCK",
      `Block "${anchor.opcode}" (${request.blockId}) does not have a "${substackName}" substack.`
    );
  }

  const position = request.position ?? "end";
  const created = createChain(state, blocks, {
    parentId: request.blockId,
    topLevel: false
  });
  const lastId = lastIdInNewChain(state, created.rootId);
  const last = state.newBlocks.get(lastId);
  if (!last) {
    throw new AppError("INTERNAL_ERROR", "Could not find the last inserted block.");
  }

  const firstExisting =
    Array.isArray(existingInput) && existingInput[0] === 2 && typeof existingInput[1] === "string"
      ? existingInput[1]
      : null;

  if (existingInput !== undefined && existingInput !== null && firstExisting === null && !(Array.isArray(existingInput) && existingInput[0] === 2 && existingInput[1] === null)) {
    throw new AppError(
      "UNSUPPORTED_SUBSTACK",
      `The existing "${substackName}" input is not a normal statement substack and cannot be extended safely.`
    );
  }

  for (const [id, block] of state.newBlocks) {
    target.blocks[id] = block;
  }

  if (!firstExisting) {
    anchor.inputs ??= {};
    anchor.inputs[substackName] = [2, created.rootId];
    return { rootId: created.rootId, ids: state.ids, warnings };
  }

  const first = requireBlock(target, firstExisting);
  if (position === "start") {
    last.next = firstExisting;
    first.parent = lastId;
    anchor.inputs![substackName] = [2, created.rootId];
  } else {
    const oldLastId = lastBlockInChain(target, firstExisting);
    const oldLast = requireBlock(target, oldLastId);
    oldLast.next = created.rootId;
    const root = state.newBlocks.get(created.rootId);
    if (root) {
      root.parent = oldLastId;
    }
    anchor.inputs![substackName] = [2, firstExisting];
  }

  return { rootId: created.rootId, ids: state.ids, warnings };
}
