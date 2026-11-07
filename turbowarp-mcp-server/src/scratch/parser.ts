import { createRequire } from "node:module";
import * as fs from "node:fs/promises";

import { strToU8, unzipSync, zipSync } from "fflate";

import { AppError, errorMessage, isNotFoundError } from "../errors.js";
import type { Sb3Project } from "./types.js";

const require = createRequire(import.meta.url);

type ParserCallback = (error: unknown, result?: [Sb3Project, unknown]) => void;
type ScratchParser = (
  input: Buffer | string,
  isSprite: boolean,
  callback: ParserCallback
) => void;

const scratchParser = require("scratch-parser") as ScratchParser;

export class Sb3ParseError extends AppError {
  constructor(message: string, details?: unknown) {
    super("SB3_PARSE_ERROR", message, details);
    this.name = "Sb3ParseError";
  }
}

function summarizeValidationError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.validationError === "string") {
      const sb3Errors = Array.isArray(record.sb3Errors) ? record.sb3Errors : [];
      const firstErrors = sb3Errors.slice(0, 5).map((entry) => {
        if (typeof entry === "object" && entry !== null) {
          const item = entry as Record<string, unknown>;
          return `${String(item.instancePath ?? "")} ${String(item.message ?? "")}`.trim();
        }
        return String(entry);
      });
      return [record.validationError, ...firstErrors].join(" | ");
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

/**
 * Unpack and validate an SB3 buffer using TurboWarp's scratch-parser fork.
 * SB2/SB1 inputs are rejected explicitly; this server's write path only
 * produces SB3.
 */
export function parseProjectBuffer(buffer: Buffer): Promise<Sb3Project> {
  return new Promise((resolve, reject) => {
    scratchParser(buffer, false, (error, result) => {
      if (error) {
        reject(new Sb3ParseError(`Could not parse SB3 project: ${summarizeValidationError(error)}`, error));
        return;
      }
      if (!result || !result[0]) {
        reject(new Sb3ParseError("scratch-parser returned an empty project."));
        return;
      }

      const project = result[0];
      if (project.projectVersion !== undefined && project.projectVersion !== 3) {
        reject(
          new Sb3ParseError(
            `Only Scratch 3 / SB3 projects are supported (detected projectVersion=${project.projectVersion}). ` +
              "Open the project in TurboWarp Desktop and export it as SB3 first.",
            { projectVersion: project.projectVersion }
          )
        );
        return;
      }

      // scratch-parser appends projectVersion to the parsed object. It is not
      // part of the SB3 file format, so keep it out of the stored project.
      delete project.projectVersion;
      resolve(project);
    });
  });
}

export async function readSb3File(
  filePath: string,
  maxBytes: number
): Promise<{ buffer: Buffer; assets: Map<string, Uint8Array> }> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new AppError("FILE_NOT_FOUND", `SB3 file not found: ${filePath}`);
    }
    throw new AppError(
      "FILE_READ_FAILED",
      `Could not read SB3 file "${filePath}": ${errorMessage(error)}`
    );
  }
  if (!stat.isFile()) {
    throw new AppError("NOT_A_FILE", `Not a file: ${filePath}`);
  }
  if (stat.size > maxBytes) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `SB3 file is ${stat.size} bytes, exceeding the configured limit of ${maxBytes} bytes. ` +
        "Increase TW_MCP_MAX_SB3_MB if this is intentional."
    );
  }

  const buffer = await fs.readFile(filePath);
  const assets = unzipAssets(buffer);
  return { buffer, assets };
}

export function unzipAssets(buffer: Buffer): Map<string, Uint8Array> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    throw new Sb3ParseError(`Not a valid SB3/ZIP archive: ${errorMessage(error)}`, error);
  }

  const assets = new Map<string, Uint8Array>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name === "project.json" || name.endsWith("/")) {
      continue;
    }
    // SB3 assets live at the archive root. Ignore path traversal or nested
    // entries rather than writing them back to disk later.
    if (name.includes("..") || name.includes("/") || name.includes("\\")) {
      continue;
    }
    assets.set(name, bytes);
  }
  return assets;
}

export function serializeProject(
  project: Sb3Project,
  assets: Map<string, Uint8Array>,
  pretty = false
): Uint8Array {
  const clean: Sb3Project = { ...project };
  delete clean.projectVersion;

  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(clean, null, pretty ? 2 : 0))
  };

  for (const [name, bytes] of assets) {
    if (name === "project.json") {
      continue;
    }
    files[name] = bytes;
  }

  return zipSync(files, { level: 6 });
}

export function collectAssetReferences(project: Sb3Project): {
  references: string[];
  missing: string[];
} {
  const references = new Set<string>();
  for (const target of project.targets) {
    for (const costume of target.costumes ?? []) {
      const md5ext =
        costume.md5ext ?? (costume.assetId ? `${costume.assetId}.${costume.dataFormat}` : "");
      if (md5ext) {
        references.add(md5ext);
      }
    }
    for (const sound of target.sounds ?? []) {
      const md5ext =
        sound.md5ext ?? (sound.assetId ? `${sound.assetId}.${sound.dataFormat}` : "");
      if (md5ext) {
        references.add(md5ext);
      }
    }
  }
  return { references: [...references], missing: [] };
}

export function findMissingAssets(
  project: Sb3Project,
  assets: Map<string, Uint8Array>
): string[] {
  const { references } = collectAssetReferences(project);
  return references.filter((reference) => !assets.has(reference));
}
