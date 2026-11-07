import { AppError } from "../errors.js";
import {
  DEFAULT_BACKDROP_SVG,
  DEFAULT_SPRITE_SVG,
  registerSvgAsset
} from "./assets.js";
import type {
  Sb3Block,
  Sb3BlockEntry,
  Sb3Costume,
  Sb3Project,
  Sb3Target,
  TargetSummary
} from "./types.js";

export interface NewProjectOptions {
  displayName?: string;
  withDefaultSprite?: boolean;
}

export interface NewProjectResult {
  project: Sb3Project;
  assets: Map<string, Uint8Array>;
  displayName: string;
}

export function createEmptyProject(options: NewProjectOptions = {}): NewProjectResult {
  const assets = new Map<string, Uint8Array>();

  const backdrop = registerSvgAsset(assets, DEFAULT_BACKDROP_SVG);
  const stage: Sb3Target = {
    isStage: true,
    name: "Stage",
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [
      {
        name: "backdrop1",
        assetId: backdrop.assetId,
        dataFormat: "svg",
        md5ext: backdrop.md5ext,
        rotationCenterX: 240,
        rotationCenterY: 180
      }
    ],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null
  };

  const targets: Sb3Target[] = [stage];

  if (options.withDefaultSprite !== false) {
    const costume = registerSvgAsset(assets, DEFAULT_SPRITE_SVG);
    targets.push({
      isStage: false,
      name: "Sprite1",
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [
        {
          name: "costume1",
          assetId: costume.assetId,
          dataFormat: "svg",
          md5ext: costume.md5ext,
          rotationCenterX: 48,
          rotationCenterY: 50
        }
      ],
      sounds: [],
      volume: 100,
      layerOrder: 1,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: "all around"
    });
  }

  const project: Sb3Project = {
    meta: {
      semver: "3.0.0",
      vm: "5.0.300",
      agent: "turbowarp-mcp-server/1.0.0"
    },
    targets,
    extensions: []
  };

  return {
    project,
    assets,
    displayName: options.displayName?.trim() || "Untitled"
  };
}

export function getStage(project: Sb3Project): Sb3Target {
  const stage = project.targets.find((target) => target.isStage);
  if (!stage) {
    throw new AppError("PROJECT_CORRUPT", "Project does not contain a Stage target.");
  }
  return stage;
}

export function findTarget(project: Sb3Project, name: string): Sb3Target | undefined {
  const exact = project.targets.find((target) => target.name === name);
  if (exact) {
    return exact;
  }
  const lower = name.toLowerCase();
  const matches = project.targets.filter((target) => target.name.toLowerCase() === lower);
  if (matches.length > 1) {
    throw new AppError(
      "AMBIGUOUS_TARGET",
      `More than one target matches "${name}" case-insensitively: ${matches
        .map((target) => target.name)
        .join(", ")}. Use the exact name.`
    );
  }
  return matches[0];
}

export function requireTarget(project: Sb3Project, name: string): Sb3Target {
  const target = findTarget(project, name);
  if (!target) {
    throw new AppError(
      "TARGET_NOT_FOUND",
      `Target "${name}" was not found. Available targets: ${project.targets
        .map((item) => item.name)
        .join(", ")}`
    );
  }
  return target;
}

export function listSprites(project: Sb3Project): Sb3Target[] {
  return project.targets.filter((target) => !target.isStage);
}

export function isSb3Block(entry: Sb3BlockEntry): entry is Sb3Block {
  return !Array.isArray(entry) && typeof entry === "object" && entry !== null;
}

export interface ScriptRoot {
  block: Sb3Block;
  blockId: string;
  x: number;
  y: number;
}

export function listScripts(target: Sb3Target): ScriptRoot[] {
  const scripts: ScriptRoot[] = [];
  for (const [blockId, entry] of Object.entries(target.blocks ?? {})) {
    if (!isSb3Block(entry)) {
      continue;
    }
    const isTopLevel =
      entry.topLevel === true ||
      (entry.topLevel === undefined &&
        (entry.parent === null || entry.parent === undefined) &&
        entry.shadow !== true);
    if (!isTopLevel || entry.shadow === true) {
      continue;
    }
    scripts.push({
      block: entry,
      blockId,
      x: typeof entry.x === "number" ? entry.x : 0,
      y: typeof entry.y === "number" ? entry.y : 0
    });
  }

  scripts.sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    if (left.x !== right.x) {
      return left.x - right.x;
    }
    return left.blockId.localeCompare(right.blockId);
  });

  return scripts;
}

export function countBlocks(target: Sb3Target): number {
  return Object.values(target.blocks ?? {}).filter(isSb3Block).length;
}

export function targetSummary(target: Sb3Target): TargetSummary {
  const currentCostume = target.costumes?.[target.currentCostume];
  return {
    name: target.name,
    isStage: target.isStage,
    ...(target.isStage
      ? {}
      : {
          visible: target.visible,
          x: target.x,
          y: target.y,
          size: target.size,
          direction: target.direction
        }),
    currentCostume: target.currentCostume ?? 0,
    currentCostumeName: currentCostume?.name ?? null,
    costumeCount: target.costumes?.length ?? 0,
    costumes: target.costumes ?? [],
    soundCount: target.sounds?.length ?? 0,
    sounds: target.sounds ?? [],
    blockCount: countBlocks(target),
    scriptCount: listScripts(target).length,
    variableCount: Object.keys(target.variables ?? {}).length,
    listCount: Object.keys(target.lists ?? {}).length
  };
}

export function nextLayerOrder(project: Sb3Project): number {
  const maximum = Math.max(0, ...project.targets.map((target) => target.layerOrder ?? 0));
  return maximum + 1;
}

export function nextScriptPosition(target: Sb3Target): { x: number; y: number } {
  const scripts = listScripts(target);
  if (scripts.length === 0) {
    return { x: 48, y: 48 };
  }
  const maxY = Math.max(...scripts.map((script) => script.y));
  return { x: 48, y: maxY + 160 };
}

export function validateSpriteName(project: Sb3Project, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError("INVALID_NAME", "Sprite name must not be empty.");
  }
  if (trimmed.toLowerCase() === "stage") {
    throw new AppError("INVALID_NAME", 'A sprite cannot be named "Stage".');
  }
  if (trimmed === "_stage_") {
    throw new AppError("INVALID_NAME", 'A sprite cannot be named "_stage_".');
  }
  const existing = project.targets.find(
    (target) => target.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (existing) {
    throw new AppError(
      "DUPLICATE_NAME",
      `A target named "${existing.name}" already exists. Sprite names must be unique.`
    );
  }
  return trimmed;
}

export function normalizeProject(project: Sb3Project): Sb3Project {
  if (!project.meta || typeof project.meta !== "object") {
    project.meta = { semver: "3.0.0" };
  }
  if (!project.meta.semver || !/^3\.\d+\.\d+$/.test(project.meta.semver)) {
    project.meta.semver = "3.0.0";
  }
  if (!Array.isArray(project.targets)) {
    project.targets = [];
  }

  let stageFound = false;
  for (const target of project.targets) {
    target.variables ??= {};
    target.lists ??= {};
    target.broadcasts ??= {};
    target.blocks ??= {};
    target.comments ??= {};
    target.costumes ??= [];
    target.sounds ??= [];
    target.volume ??= 100;
    target.currentCostume ??= 0;

    for (const costume of target.costumes) {
      normalizeAssetDescriptor(costume);
    }
    for (const sound of target.sounds) {
      normalizeAssetDescriptor(sound);
    }

    if (target.isStage) {
      stageFound = true;
      target.name = "Stage";
      target.layerOrder = 0;
      target.tempo ??= 60;
      target.videoTransparency ??= 50;
      target.videoState ??= "on";
      target.textToSpeechLanguage ??= null;
    } else {
      target.layerOrder = Math.max(1, Math.trunc(target.layerOrder ?? 1));
      target.visible ??= true;
      target.x ??= 0;
      target.y ??= 0;
      target.size ??= 100;
      target.direction ??= 90;
      target.draggable ??= false;
      target.rotationStyle ??= "all around";
    }

    if (target.costumes.length > 0) {
      target.currentCostume = Math.min(
        Math.max(0, Math.trunc(target.currentCostume)),
        target.costumes.length - 1
      );
    } else {
      target.currentCostume = 0;
    }
  }

  if (!stageFound) {
    throw new AppError("PROJECT_CORRUPT", "Project does not contain a Stage target.");
  }

  return project;
}

function normalizeAssetDescriptor(asset: Sb3Costume | { [key: string]: unknown }): void {
  const record = asset as Record<string, unknown>;
  let md5ext = typeof record.md5ext === "string" ? record.md5ext : undefined;
  let assetId = typeof record.assetId === "string" ? record.assetId : undefined;
  let dataFormat = typeof record.dataFormat === "string" ? record.dataFormat : undefined;

  if (!md5ext && assetId && dataFormat) {
    md5ext = `${assetId}.${dataFormat}`;
    record.md5ext = md5ext;
  }
  if (!assetId && md5ext && md5ext.includes(".")) {
    assetId = md5ext.slice(0, md5ext.lastIndexOf("."));
    record.assetId = assetId;
  }
  if (!dataFormat && md5ext && md5ext.includes(".")) {
    dataFormat = md5ext.slice(md5ext.lastIndexOf(".") + 1);
    record.dataFormat = dataFormat;
  }
  if (typeof record.rotationCenterX !== "number") {
    record.rotationCenterX = 0;
  }
  if (typeof record.rotationCenterY !== "number") {
    record.rotationCenterY = 0;
  }
}
