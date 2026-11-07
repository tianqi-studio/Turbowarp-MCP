import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AppError } from "../errors.js";
import { log } from "../log.js";
import {
  findMissingAssets,
  serializeProject
} from "../scratch/parser.js";
import { countBlocks } from "../scratch/project.js";
import {
  defaultExportFileName,
  joinDefaultExportPath,
  assertConfirmation,
  getProject,
  runTool,
  toolResult,
  type ServerContext
} from "./common.js";
import { ensureSb3Extension, resolveUserPath } from "../utils/path.js";

const inputSchema = {
  path: z
    .string()
    .optional()
    .describe(
      "Destination .sb3 path. Relative paths resolve inside TW_MCP_WORKSPACE. " +
        "If omitted, overwrites the loaded source file, or writes <workspace>/<project name>.sb3 for a new project."
    ),
  pretty: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Pretty-print project.json inside the archive. Larger but easier to inspect. Defaults to false."
    ),
  allow_missing_assets: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Export even when costume/sound references have no bytes in the archive. Defaults to false because TurboWarp may fail to load such a project."
    ),
  confirm: z
    .boolean()
    .optional()
    .describe("Required when the confirmation policy gates this tool.")
};

const outputSchema = z.object({
  exported: z.literal(true),
  path: z.string(),
  displayName: z.string(),
  bytes: z.number().int(),
  assetCount: z.number().int(),
  blockCount: z.number().int(),
  missingAssets: z.array(z.string()),
  dirty: z.literal(false)
});

async function isDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function chooseExportPath(
  context: ServerContext,
  displayName: string,
  sourcePath: string | null,
  requested: string | undefined
): Promise<string> {
  if (requested && requested.trim()) {
    let resolved = resolveUserPath(context.config, requested);
    const looksLikeDirectory =
      /[\\/]$/.test(requested) || (await isDirectory(resolved));
    if (looksLikeDirectory) {
      resolved = path.join(resolved, defaultExportFileName(displayName));
    }
    return ensureSb3Extension(resolved);
  }

  if (sourcePath) {
    return sourcePath;
  }

  return ensureSb3Extension(
    joinDefaultExportPath(context.config.workspace, displayName)
  );
}

export function registerExportSb3(
  server: McpServer,
  context: ServerContext
): void {
  server.registerTool(
    "export_sb3",
    {
      title: "Export SB3 project",
      description:
        "Serialize the active project to a valid SB3 ZIP archive, preserving original assets. " +
        "Refuses to export when a costume/sound reference has no asset bytes unless allow_missing_assets=true. " +
        "If no path is given, overwrites the loaded source file or writes <workspace>/<project>.sb3 for a new project. " +
        "Parent directories are created as needed. This writes to the filesystem and marks the in-memory project as saved.",
      inputSchema,
      outputSchema: outputSchema.shape,
      annotations: {
        title: "Export SB3 project",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false
      }
    },
    async (args) =>
      runTool(async () => {
        assertConfirmation(context, "export_sb3", "mutating", args.confirm);

        const loaded = getProject(context);
        const project = loaded.project;
        const missingAssets = findMissingAssets(project, loaded.assets);

        if (missingAssets.length > 0 && args.allow_missing_assets !== true) {
          throw new AppError(
            "MISSING_ASSETS",
            `Refusing to export: ${missingAssets.length} referenced asset(s) are missing. ` +
              "This usually means the SB3 was assembled by hand or the archive is incomplete. " +
              'Pass "allow_missing_assets": true to export anyway.',
            { missingAssets }
          );
        }

        const outputPath = await chooseExportPath(
          context,
          loaded.displayName,
          loaded.sourcePath,
          args.path
        );
        const archive = serializeProject(
          project,
          loaded.assets,
          args.pretty === true
        );

        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, archive);

        loaded.sourcePath = outputPath;
        loaded.dirty = false;

        const blockCount = project.targets.reduce(
          (total, target) => total + countBlocks(target),
          0
        );

        log.info("Exported SB3 project", {
          path: outputPath,
          bytes: archive.byteLength,
          assets: loaded.assets.size,
          missingAssets: missingAssets.length
        });

        return toolResult(
          {
            exported: true as const,
            path: outputPath,
            displayName: loaded.displayName,
            bytes: archive.byteLength,
            assetCount: loaded.assets.size,
            blockCount,
            missingAssets,
            dirty: false as const
          },
          `Exported "${loaded.displayName}" to ${outputPath} ` +
            `(${archive.byteLength} bytes, ${loaded.assets.size} asset(s), ${blockCount} block(s)).` +
            (missingAssets.length > 0
              ? `\nWARNING: ${missingAssets.length} missing asset(s) were allowed.`
              : "")
        );
      })
  );
}
