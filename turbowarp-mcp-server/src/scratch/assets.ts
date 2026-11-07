import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { AppError, errorMessage, isNotFoundError } from "../errors.js";

export type CostumeDataFormat = "png" | "svg";

export interface AssetRecord {
  assetId: string;
  md5ext: string;
  dataFormat: CostumeDataFormat;
  bytes: Uint8Array;
}

export interface CostumeFileInfo extends AssetRecord {
  name: string;
  rotationCenterX: number;
  rotationCenterY: number;
  bitmapResolution?: number;
}

export const DEFAULT_BACKDROP_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="480" height="360" viewBox="0 0 480 360">
  <rect width="480" height="360" fill="#ffffff"/>
</svg>
`;

export const DEFAULT_SPRITE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="96" height="100" viewBox="0 0 96 100">
  <path d="M 20 20 L 28 4 L 38 19 Z" fill="#ffab19" stroke="#cf8b17" stroke-width="2"/>
  <path d="M 58 19 L 68 4 L 76 20 Z" fill="#ffab19" stroke="#cf8b17" stroke-width="2"/>
  <ellipse cx="48" cy="52" rx="42" ry="44" fill="#ffab19" stroke="#cf8b17" stroke-width="2"/>
  <circle cx="34" cy="43" r="6" fill="#231f20"/>
  <circle cx="62" cy="43" r="6" fill="#231f20"/>
  <circle cx="36" cy="41" r="2" fill="#ffffff"/>
  <circle cx="64" cy="41" r="2" fill="#ffffff"/>
  <path d="M 31 67 Q 48 82 65 67" stroke="#231f20" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>
`;

export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

export function registerAsset(
  assets: Map<string, Uint8Array>,
  bytes: Uint8Array,
  dataFormat: CostumeDataFormat
): AssetRecord {
  const assetId = md5Hex(bytes);
  const md5ext = `${assetId}.${dataFormat}`;
  if (!assets.has(md5ext)) {
    assets.set(md5ext, bytes);
  }
  return { assetId, md5ext, dataFormat, bytes };
}

export function registerSvgAsset(
  assets: Map<string, Uint8Array>,
  svg: string
): AssetRecord {
  return registerAsset(assets, new TextEncoder().encode(svg), "svg");
}

export interface ParsedDimensions {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSvgDimensions(svg: string): ParsedDimensions {
  const text = svg.replace(/^\uFEFF/, "");

  const width =
    parseNumber(text.match(/\swidth\s*=\s*["']([^"']+)["']/i)?.[1]) ?? undefined;
  const height =
    parseNumber(text.match(/\sheight\s*=\s*["']([^"']+)["']/i)?.[1]) ?? undefined;

  const viewBox = text.match(
    /\sviewBox\s*=\s*["']\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*["']/i
  );

  const viewBoxX = viewBox ? Number(viewBox[1]) : 0;
  const viewBoxY = viewBox ? Number(viewBox[2]) : 0;
  const viewBoxWidth = viewBox ? Number(viewBox[3]) : undefined;
  const viewBoxHeight = viewBox ? Number(viewBox[4]) : undefined;

  const finalWidth = width ?? viewBoxWidth ?? 100;
  const finalHeight = height ?? viewBoxHeight ?? 100;

  return {
    width: finalWidth,
    height: finalHeight,
    centerX: viewBoxX + finalWidth / 2,
    centerY: viewBoxY + finalHeight / 2
  };
}

export function parsePngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !pngSignature.every((byte, index) => bytes[index] === byte)) {
    throw new AppError("INVALID_PNG", "File is not a valid PNG image.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16, false),
    height: view.getUint32(20, false)
  };
}

export function sniffCostumeFormat(bytes: Uint8Array): CostumeDataFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }

  const head = new TextDecoder()
    .decode(bytes.slice(0, Math.min(bytes.length, 4096)))
    .replace(/^\uFEFF/, "")
    .trimStart();

  if (head.startsWith("<") && /<svg[\s>]/i.test(head)) {
    return "svg";
  }
  return null;
}

export interface ReadCostumeOptions {
  maxBytes: number;
  name?: string;
  rotationCenterX?: number;
  rotationCenterY?: number;
  /** Asset map that receives the costume bytes. */
  assets: Map<string, Uint8Array>;
}

export async function readCostumeFile(
  filePath: string,
  options: ReadCostumeOptions
): Promise<CostumeFileInfo> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new AppError("FILE_NOT_FOUND", `Costume file not found: ${filePath}`);
    }
    throw new AppError(
      "FILE_READ_FAILED",
      `Could not read costume file "${filePath}": ${errorMessage(error)}`
    );
  }
  if (!stat.isFile()) {
    throw new AppError("NOT_A_FILE", `Costume path is not a file: ${filePath}`);
  }
  if (stat.size > options.maxBytes) {
    throw new AppError(
      "FILE_TOO_LARGE",
      `Costume file is ${stat.size} bytes, exceeding the limit of ${options.maxBytes} bytes.`
    );
  }

  const bytes = await fs.readFile(filePath);
  const dataFormat = sniffCostumeFormat(bytes);
  if (dataFormat === null) {
    throw new AppError(
      "UNSUPPORTED_COSTUME",
      `Unsupported costume format for "${filePath}". This server supports PNG and SVG costumes. ` +
        "Convert other formats to PNG first."
    );
  }

  const baseName = path.basename(filePath, path.extname(filePath)) || "costume";
  const record = registerAsset(options.assets, bytes, dataFormat);
  const parsed =
    dataFormat === "png"
      ? (() => {
          const dims = parsePngDimensions(bytes);
          return {
            width: dims.width,
            height: dims.height,
            centerX: dims.width / 2,
            centerY: dims.height / 2
          };
        })()
      : parseSvgDimensions(bytes.toString("utf8"));

  const rotationCenterX = options.rotationCenterX ?? parsed.centerX;
  const rotationCenterY = options.rotationCenterY ?? parsed.centerY;

  return {
    ...record,
    name: options.name?.trim() || baseName,
    rotationCenterX,
    rotationCenterY,
    ...(dataFormat === "png" ? { bitmapResolution: 1 } : {})
  };
}

export function normalizeColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  throw new AppError(
    "INVALID_COLOR",
    `Invalid color "${value}". Use a Scratch color literal such as "#ff8800".`
  );
}

export function describeAssetError(error: unknown): string {
  return errorMessage(error);
}
