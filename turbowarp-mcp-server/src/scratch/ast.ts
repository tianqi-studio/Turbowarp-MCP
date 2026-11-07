import { isSb3Block, listScripts } from "./project.js";
import { getOpcodeSpec, isValueOpcode } from "./registry.js";
import type {
  BlockAst,
  InputAst,
  Sb3Block,
  Sb3FieldValue,
  Sb3Input,
  Sb3Primitive,
  Sb3Target,
  ScriptAst
} from "./types.js";

export interface BuildAstOptions {
  /** Maximum number of blocks to include. Defaults to 5000. */
  maxBlocks?: number;
}

export interface BuildAstResult {
  scripts: ScriptAst[];
  blockCount: number;
  truncated: boolean;
  warnings: string[];
}

interface AstState {
  target: Sb3Target;
  seen: Set<string>;
  blockCount: number;
  maxBlocks: number;
  truncated: boolean;
  warnings: string[];
  depth: number;
}

function isPrimitive(value: unknown): value is Sb3Primitive {
  return Array.isArray(value) && typeof value[0] === "number";
}

function primitiveValue(primitive: Sb3Primitive): unknown {
  return primitive.length > 1 ? primitive[1] : null;
}

function firstFieldValue(fields: Record<string, unknown>): unknown {
  const first = Object.values(fields)[0];
  if (Array.isArray(first)) {
    return first[0];
  }
  return first;
}

function errorBlock(id: string, opcode: string, message: string): BlockAst {
  return {
    id,
    opcode,
    shadow: false,
    fields: {},
    inputs: {},
    error: message
  };
}

function parseShadowMenu(state: AstState, blockId: string): InputAst {
  const entry = state.target.blocks[blockId];
  if (!isSb3Block(entry)) {
    state.warnings.push(`Input references missing menu block "${blockId}".`);
    return { type: "empty" };
  }
  const fields: Record<string, Sb3FieldValue> = {};
  for (const [name, value] of Object.entries(entry.fields ?? {})) {
    fields[name] = Array.isArray(value) ? [...value] : value;
  }
  return {
    type: "menu",
    opcode: entry.opcode,
    fields,
    value: firstFieldValue(fields)
  };
}

function isSubstackInput(parentOpcode: string, name: string): boolean {
  const spec = getOpcodeSpec(parentOpcode);
  if (spec?.substacks.includes(name)) {
    return true;
  }
  return name.startsWith("SUBSTACK");
}

function parseInput(
  state: AstState,
  parentOpcode: string,
  name: string,
  raw: Sb3Input
): InputAst {
  if (!Array.isArray(raw)) {
    return { type: "empty" };
  }

  const inputType = raw[0];
  const payload = raw[1];

  if (inputType === 1) {
    if (typeof payload === "string") {
      return parseShadowMenu(state, payload);
    }
    if (isPrimitive(payload)) {
      return {
        type: "literal",
        value: primitiveValue(payload),
        primitiveType: String(payload[0])
      };
    }
    return { type: "literal", value: payload, primitiveType: "unknown" };
  }

  if (inputType === 2) {
    if (typeof payload === "string") {
      if (isSubstackInput(parentOpcode, name)) {
        return { type: "stack", stack: parseChain(state, payload) };
      }
      const block = parseBlock(state, payload);
      return block ? { type: "block", block } : { type: "empty" };
    }
    return { type: "empty" };
  }

  if (inputType === 3) {
    const coveringId = typeof payload === "string" ? payload : null;
    if (!coveringId) {
      return { type: "empty" };
    }
    const block = parseBlock(state, coveringId);
    if (!block) {
      return { type: "empty" };
    }
    const shadowRaw = raw[2];
    const shadow =
      Array.isArray(shadowRaw) && shadowRaw[0] === 1
        ? parseInput(state, parentOpcode, name, shadowRaw as Sb3Input)
        : undefined;
    return { type: "block", block, ...(shadow ? { shadow } : {}) };
  }

  state.warnings.push(`Unknown input encoding ${String(inputType)} for "${parentOpcode}.${name}".`);
  return { type: "literal", value: payload, primitiveType: "unknown" };
}

function parseBlock(state: AstState, blockId: string): BlockAst | null {
  if (state.blockCount >= state.maxBlocks) {
    state.truncated = true;
    return null;
  }
  if (state.seen.has(blockId)) {
    const entry = state.target.blocks[blockId];
    const opcode = isSb3Block(entry) ? entry.opcode : "unknown";
    state.warnings.push(`Block "${blockId}" is referenced more than once or creates a cycle.`);
    return errorBlock(blockId, opcode, "Block appears more than once or creates a cycle.");
  }
  if (state.depth > 200) {
    state.warnings.push(`Maximum nesting depth reached at block "${blockId}".`);
    return errorBlock(blockId, "unknown", "Maximum nesting depth reached.");
  }

  const entry = state.target.blocks[blockId];
  if (!isSb3Block(entry)) {
    state.warnings.push(`Missing block "${blockId}".`);
    return null;
  }

  state.seen.add(blockId);
  state.blockCount += 1;

  const fields: Record<string, Sb3FieldValue> = {};
  for (const [name, value] of Object.entries(entry.fields ?? {})) {
    fields[name] = Array.isArray(value) ? [...value] : value;
  }

  const inputs: Record<string, InputAst> = {};
  state.depth += 1;
  for (const [name, value] of Object.entries(entry.inputs ?? {})) {
    inputs[name] = parseInput(state, entry.opcode, name, value);
  }
  state.depth -= 1;

  const block: BlockAst = {
    id: blockId,
    opcode: entry.opcode,
    shadow: entry.shadow === true,
    fields,
    inputs
  };
  if (entry.mutation) {
    block.mutation = { ...entry.mutation };
  }
  return block;
}

function parseChain(state: AstState, startId: string): BlockAst[] {
  const chain: BlockAst[] = [];
  const visited = new Set<string>();
  let currentId: string | null = startId;

  while (currentId) {
    if (visited.has(currentId)) {
      state.warnings.push(`Stack cycle detected at block "${currentId}".`);
      break;
    }
    visited.add(currentId);
    if (state.blockCount >= state.maxBlocks) {
      state.truncated = true;
      break;
    }

    const block = parseBlock(state, currentId);
    if (!block) {
      break;
    }
    chain.push(block);

    const entry = state.target.blocks[currentId] as Sb3Block;
    currentId = typeof entry.next === "string" ? entry.next : null;
  }

  return chain;
}

export function buildScripts(
  target: Sb3Target,
  options: BuildAstOptions = {}
): BuildAstResult {
  const state: AstState = {
    target,
    seen: new Set<string>(),
    blockCount: 0,
    maxBlocks: Math.max(1, Math.trunc(options.maxBlocks ?? 5000)),
    truncated: false,
    warnings: [],
    depth: 0
  };

  const roots = listScripts(target);
  const scripts: ScriptAst[] = [];

  roots.forEach((root, index) => {
    if (state.blockCount >= state.maxBlocks) {
      state.truncated = true;
      return;
    }
    const kind = isValueOpcode(root.block.opcode) ? "reporter" : "script";
    const stack =
      kind === "reporter"
        ? (() => {
            const block = parseBlock(state, root.blockId);
            return block ? [block] : [];
          })()
        : parseChain(state, root.blockId);

    scripts.push({
      index,
      kind,
      rootId: root.blockId,
      x: root.x,
      y: root.y,
      stack
    });
  });

  return {
    scripts,
    blockCount: state.blockCount,
    truncated: state.truncated,
    warnings: state.warnings
  };
}
