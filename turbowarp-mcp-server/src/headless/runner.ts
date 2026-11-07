import { createRequire } from "node:module";

import { AppError, errorMessage } from "../errors.js";

const require = createRequire(import.meta.url);

export interface HeadlessOptions {
  durationMs: number;
  turbo: boolean;
  stopWhenIdle: boolean;
  /** CommonJS module name/path for scratch-vm. Defaults to "scratch-vm". */
  vmModule: string;
}

export interface SayEvent {
  target: string;
  type: string;
  text: string;
  atMs: number;
}

export interface VariableSnapshot {
  name: string;
  owner: string;
  value: unknown;
  isCloud: boolean;
}

export interface ListSnapshot {
  name: string;
  owner: string;
  value: unknown[];
}

export interface MonitorSnapshot {
  id: string;
  opcode: string;
  owner: string | null;
  value: unknown;
  visible: boolean;
}

export interface HeadlessResult {
  durationMs: number;
  timedOut: boolean;
  targetCount: number;
  threadCount: number;
  say: SayEvent[];
  variables: VariableSnapshot[];
  lists: ListSnapshot[];
  monitors: MonitorSnapshot[];
  errors: string[];
}

interface RuntimeLike {
  targets?: RuntimeTarget[];
  threads?: unknown[];
  turboMode?: boolean;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
  getMonitorState?(): unknown;
}

interface RuntimeVariable {
  id?: string;
  name?: string;
  value?: unknown;
  type?: string;
  isCloud?: boolean;
}

interface RuntimeTarget {
  id?: string;
  name?: string;
  isStage?: boolean;
  variables?: Record<string, RuntimeVariable>;
  getName?(): string;
}

interface VirtualMachineLike {
  runtime: RuntimeLike;
  attachStorage?(storage: unknown): void;
  loadProject(input: Buffer): Promise<void>;
  start(): void;
  greenFlag(): void;
  stopAll(): void;
  quit(): void;
  setTurboMode?(enabled: boolean): void;
}

type VirtualMachineConstructor = new () => VirtualMachineLike;

function isConstructor(value: unknown): value is VirtualMachineConstructor {
  return typeof value === "function";
}

function loadVmConstructor(moduleName: string): VirtualMachineConstructor {
  let imported: unknown;
  try {
    imported = require(moduleName);
  } catch (error) {
    throw new AppError(
      "HEADLESS_DEPENDENCY_MISSING",
      `Could not load the headless VM module "${moduleName}": ${errorMessage(error)}. ` +
        "Run npm install in the server directory, or point TW_MCP_VM_MODULE at a CommonJS scratch-vm build.",
      error
    );
  }

  if (isConstructor(imported)) {
    return imported;
  }
  const withDefault = imported as { default?: unknown };
  if (isConstructor(withDefault?.default)) {
    return withDefault.default;
  }
  throw new AppError(
    "HEADLESS_DEPENDENCY_INVALID",
    `The VM module "${moduleName}" did not export a constructor. ` +
      "Use a CommonJS build such as scratch-vm@5's dist/node/scratch-vm.js."
  );
}

function loadStorageConstructor(): new () => unknown {
  let imported: unknown;
  try {
    imported = require("scratch-storage");
  } catch (error) {
    throw new AppError(
      "HEADLESS_DEPENDENCY_MISSING",
      `Could not load scratch-storage: ${errorMessage(error)}. Run npm install in the server directory.`,
      error
    );
  }
  if (isConstructor(imported)) {
    return imported as new () => unknown;
  }
  const exportsObject = imported as {
    default?: unknown;
    ScratchStorage?: unknown;
  };
  const candidate = exportsObject.default ?? exportsObject.ScratchStorage;
  if (isConstructor(candidate)) {
    return candidate as new () => unknown;
  }
  throw new AppError(
    "HEADLESS_DEPENDENCY_INVALID",
    "scratch-storage did not export a constructor (expected ScratchStorage)."
  );
}

function targetName(target: RuntimeTarget): string {
  if (target.isStage) {
    return "Stage";
  }
  if (typeof target.getName === "function") {
    return target.getName();
  }
  return target.name ?? "unknown";
}

function jsonSafe(value: unknown, depth = 0): unknown {
  if (depth > 20) {
    return "[deep value]";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => jsonSafe(item, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    const maybeImmutable = value as { toJS?: () => unknown };
    if (typeof maybeImmutable.toJS === "function") {
      return jsonSafe(maybeImmutable.toJS(), depth + 1);
    }
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = jsonSafe(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

function summarizeVmError(error: unknown): string {
  if (typeof error === "string") {
    try {
      return summarizeVmError(JSON.parse(error));
    } catch {
      return error;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.validationError === "string") {
      const sb3Errors = Array.isArray(record.sb3Errors) ? record.sb3Errors : [];
      const details = sb3Errors
        .slice(0, 5)
        .map((entry) => {
          if (typeof entry === "object" && entry !== null) {
            const item = entry as Record<string, unknown>;
            return `${String(item.instancePath ?? "")} ${String(item.message ?? "")}`.trim();
          }
          return String(entry);
        })
        .filter(Boolean);
      return [record.validationError, ...details].join(" | ");
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function monitorEntries(
  monitorState: unknown
): Array<{ id: string; record: Record<string, unknown> }> {
  const entries: Array<{ id: string; record: Record<string, unknown> }> = [];
  const add = (id: unknown, record: unknown): void => {
    if (typeof record === "object" && record !== null) {
      const maybeImmutable = record as { toJS?: () => unknown };
      const plain =
        typeof maybeImmutable.toJS === "function"
          ? (maybeImmutable.toJS() as unknown)
          : record;
      if (typeof plain === "object" && plain !== null) {
        entries.push({
          id: String(id ?? (plain as Record<string, unknown>).id ?? ""),
          record: plain as Record<string, unknown>
        });
      }
    }
  };

  if (typeof monitorState === "object" && monitorState !== null) {
    const maybeMap = monitorState as {
      forEach?: (callback: (value: unknown, key: unknown) => void) => void;
    };
    if (typeof maybeMap.forEach === "function") {
      maybeMap.forEach((value, key) => add(key, value));
      return entries;
    }
    for (const [key, value] of Object.entries(monitorState)) {
      add(key, value);
    }
  }
  return entries;
}

function collectSnapshot(
  runtime: RuntimeLike,
  say: SayEvent[],
  startedAt: number
): Omit<HeadlessResult, "durationMs" | "timedOut"> {
  const targets = runtime.targets ?? [];
  const ownerById = new Map<string, string>();
  for (const target of targets) {
    if (typeof target.id === "string") {
      ownerById.set(target.id, targetName(target));
    }
  }

  const variables: VariableSnapshot[] = [];
  const lists: ListSnapshot[] = [];

  for (const target of targets) {
    const owner = targetName(target);
    for (const variable of Object.values(target.variables ?? {})) {
      const name = variable.name ?? "";
      if (variable.type === "list") {
        const value = Array.isArray(variable.value) ? variable.value : [];
        lists.push({
          name,
          owner,
          value: value.map((item) => jsonSafe(item))
        });
      } else {
        variables.push({
          name,
          owner,
          value: jsonSafe(variable.value),
          isCloud: variable.isCloud === true
        });
      }
    }
  }

  variables.sort((left, right) =>
    `${left.owner}\u0000${left.name}`.localeCompare(`${right.owner}\u0000${right.name}`)
  );
  lists.sort((left, right) =>
    `${left.owner}\u0000${left.name}`.localeCompare(`${right.owner}\u0000${right.name}`)
  );

  const monitors: MonitorSnapshot[] = [];
  if (typeof runtime.getMonitorState === "function") {
    for (const { id, record } of monitorEntries(runtime.getMonitorState())) {
      const targetId =
        typeof record.targetId === "string" ? record.targetId : undefined;
      monitors.push({
        id: id || String(record.id ?? ""),
        opcode: String(record.opcode ?? ""),
        owner:
          (typeof record.spriteName === "string" && record.spriteName) ||
          (targetId ? ownerById.get(targetId) ?? null : null),
        value: jsonSafe(record.value),
        visible: record.visible !== false
      });
    }
  }
  monitors.sort((left, right) => left.id.localeCompare(right.id));

  return {
    targetCount: targets.length,
    threadCount: runtime.threads?.length ?? 0,
    say: say.map((event) => ({ ...event, atMs: event.atMs - startedAt })),
    variables,
    lists,
    monitors,
    errors: []
  };
}

/**
 * Run an SB3 archive with scratch-vm in Node, without a renderer or audio
 * engine. The VM is stopped and disposed before this function resolves.
 */
export async function runProjectHeadless(
  archive: Buffer,
  options: HeadlessOptions
): Promise<HeadlessResult> {
  const VirtualMachine = loadVmConstructor(options.vmModule);
  const ScratchStorage = loadStorageConstructor();

  let vm: VirtualMachineLike | null = null;
  let runtime: RuntimeLike | null = null;
  const say: SayEvent[] = [];
  const startedAt = Date.now();
  const onSay = (...args: unknown[]): void => {
    const target = args[0] as RuntimeTarget | undefined;
    const type = typeof args[1] === "string" ? args[1] : "say";
    const text = args[2] === undefined ? "" : String(args[2]);
    say.push({
      target: target ? targetName(target) : "unknown",
      type,
      text,
      atMs: Date.now()
    });
  };

  try {
    vm = new VirtualMachine();
    if (typeof vm.attachStorage === "function") {
      vm.attachStorage(new ScratchStorage());
    }

    try {
      await vm.loadProject(archive);
    } catch (error) {
      throw new AppError(
        "HEADLESS_LOAD_FAILED",
        `The headless scratch-vm could not load this project: ${summarizeVmError(error)}. ` +
          "This usually means the project uses a TurboWarp-only extension or block unavailable in vanilla scratch-vm. " +
          "Editing, get_scripts, and export_sb3 still work; only run_headless is limited.",
        error
      );
    }

    runtime = vm.runtime;
    runtime.on("SAY", onSay);

    if (options.turbo && typeof vm.setTurboMode === "function") {
      vm.setTurboMode(true);
    }

    vm.start();
    vm.greenFlag();

    let timedOut = false;
    const runStarted = Date.now();
    let lastActivity = runStarted;
    let sawThread = false;

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        const now = Date.now();
        const elapsed = now - runStarted;
        const threads = runtime?.threads?.length ?? 0;

        if (threads > 0) {
          sawThread = true;
          lastActivity = now;
        }

        if (elapsed >= options.durationMs) {
          timedOut = threads > 0;
          clearInterval(interval);
          resolve();
          return;
        }

        if (!options.stopWhenIdle) {
          return;
        }

        if (!sawThread && elapsed >= Math.min(750, options.durationMs)) {
          clearInterval(interval);
          resolve();
          return;
        }

        if (
          sawThread &&
          threads === 0 &&
          now - lastActivity >= 200 &&
          elapsed >= 250
        ) {
          clearInterval(interval);
          resolve();
        }
      }, 25);
    });

    if (!runtime) {
      throw new AppError(
        "HEADLESS_NO_RUNTIME",
        "The VM did not expose a runtime after loading the project."
      );
    }

    const snapshot = collectSnapshot(runtime, say, startedAt);
    return {
      ...snapshot,
      durationMs: Date.now() - runStarted,
      timedOut
    };
  } finally {
    if (vm) {
      try {
        vm.stopAll();
      } catch {
        // Best-effort cleanup.
      }
      if (runtime && typeof runtime.removeListener === "function") {
        try {
          runtime.removeListener("SAY", onSay);
        } catch {
          // Best-effort cleanup.
        }
      }
      try {
        vm.quit();
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}
