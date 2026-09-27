import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { locateAbleton } from "./ableton-locator.js";
import { defaultProjectRoots, findProjects } from "./project-finder.js";
import { resolveProject } from "./resolve.js";
import { launchProject, listInstancePids } from "./launcher.js";
import { Ledger } from "./ledger.js";
import { warningsFor } from "./warnings.js";

export interface ServerDeps {
  locate: typeof locateAbleton;
  find: typeof findProjects;
  resolve: typeof resolveProject;
  launch: typeof launchProject;
  listPids: typeof listInstancePids;
  ledger: Ledger;
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Names the folders that were actually searched (the defaults, or whatever
 * ABLETON_PROJECTS_DIRS overrides them with), so a "not found" is honest
 * about where the server looked and how to point it somewhere else.
 */
function searchedRootsHint(env: NodeJS.ProcessEnv = process.env): string {
  const roots = defaultProjectRoots(env);
  const list =
    roots.length > 0 ? roots.map((r) => `  - ${r}`).join("\n") : "  (no folders)";
  const source = env.ABLETON_PROJECTS_DIRS
    ? `These folders come from ABLETON_PROJECTS_DIRS. Check that they exist ` +
      `and contain your .als files, or change the variable ` +
      `(a colon-separated list of folders).`
    : `If your projects live somewhere else, set the ABLETON_PROJECTS_DIRS ` +
      `environment variable to a colon-separated list of folders, for example:\n` +
      `  ABLETON_PROJECTS_DIRS="/Volumes/Audio/Projects:$HOME/Music/Sets"`;
  return (
    `Searched Spotlight's index and these folders:\n${list}\n\n${source}`
  );
}

export function createServer(overrides: Partial<ServerDeps> = {}): McpServer {
  const deps: ServerDeps = {
    locate: locateAbleton,
    find: findProjects,
    resolve: resolveProject,
    launch: launchProject,
    listPids: listInstancePids,
    ledger: new Ledger(),
    ...overrides,
  };

  const server = new McpServer({ name: "ableton-multi-mcp", version: "0.1.0" });

  server.registerTool(
    "find_projects",
    {
      title: "Find Ableton projects",
      description:
        "Search the user's Ableton Live Sets (.als files) by name. Auto-backup files are excluded. With no query, returns the most recently modified projects.",
      inputSchema: {
        query: z.string().optional().describe("Part of the project name to search for."),
        limit: z.number().int().min(1).max(100).optional().describe("Maximum results (default 20)."),
      },
    },
    async ({ query, limit }) => {
      try {
        const projects = await deps.find({ query, limit });
        if (projects.length === 0) {
          return text(
            query
              ? `No Ableton projects matched "${query}". ${searchedRootsHint()}`
              : `No Ableton projects were found. ${searchedRootsHint()}`
          );
        }
        const lines = projects.map(
          (p) => `- ${p.name}\n  path: ${p.path}\n  modified: ${p.modifiedAt.toISOString()}`
        );
        return text(`Found ${projects.length} project(s):\n${lines.join("\n")}`);
      } catch (err) {
        return text(`Could not search for projects: ${errorMessage(err)}`);
      }
    }
  );

  server.registerTool(
    "open_project",
    {
      title: "Open a project in a new Ableton instance",
      description:
        "Open an Ableton Live project in a NEW instance of Live, leaving any already-open project untouched. Accepts a project name or an absolute path to a .als file.",
      inputSchema: {
        name_or_path: z
          .string()
          .describe("Project name (e.g. \"Midnight Drive\") or absolute path to a .als file."),
      },
    },
    async ({ name_or_path }) => {
      let app;
      try {
        app = await deps.locate();
      } catch (err) {
        return text(errorMessage(err));
      }

      let resolution;
      try {
        resolution = await deps.resolve(name_or_path);
      } catch (err) {
        return text(`Could not resolve "${name_or_path}": ${errorMessage(err)}`);
      }

      if (resolution.kind === "none") {
        return text(
          `No Ableton project matched "${resolution.query}". ${searchedRootsHint()}\n\n` +
            `Try find_projects to see what is available.`
        );
      }
      if (resolution.kind === "ambiguous") {
        const list = resolution.candidates.map((c) => `- ${c.name}\n  ${c.path}`).join("\n");
        return text(
          `Several projects match "${name_or_path}". Which one did you mean?\n${list}`
        );
      }

      let result;
      try {
        result = await deps.launch({ appPath: app.appPath, projectPath: resolution.path });
      } catch (err) {
        return text(`Could not open the project: ${errorMessage(err)}`);
      }

      if (result.pid !== null) deps.ledger.record(result.pid, result.projectPath);

      const header = result.confirmed
        ? `Opened "${result.projectPath}" in a new instance of ${app.bundleName} (pid ${result.pid}). ${result.instanceCount} instance(s) of Live are now running.`
        : `Asked macOS to open "${result.projectPath}" with ${app.bundleName}, but could not confirm that a new instance started. Check whether Live is showing a dialog, such as a licence or authorisation prompt.`;

      const warnings = warningsFor(result.instanceCount);
      const warningText =
        warnings.length > 0 ? `\n\nThings to know about running multiple instances:\n${warnings.map((w) => `- ${w}`).join("\n")}` : "";

      return text(header + warningText);
    }
  );

  server.registerTool(
    "list_open_instances",
    {
      title: "List running Ableton instances",
      description:
        "List the currently running instances of Ableton Live and, where known, which project each one has open.",
      inputSchema: {},
    },
    async () => {
      let app;
      try {
        app = await deps.locate();
      } catch (err) {
        return text(errorMessage(err));
      }

      let pids: number[];
      try {
        pids = await deps.listPids(app.appPath);
      } catch (err) {
        return text(`Could not list Ableton instances: ${errorMessage(err)}`);
      }

      if (pids.length === 0) return text("No instances of Ableton Live are running.");

      const lines = pids.map((pid) => {
        const entry = deps.ledger.lookup(pid);
        return entry
          ? `- pid ${pid}: ${entry.projectPath} (launched by this server at ${entry.startedAt.toISOString()})`
          : `- pid ${pid}: project unknown (not launched by this server)`;
      });
      return text(`${pids.length} instance(s) of ${app.bundleName} running:\n${lines.join("\n")}`);
    }
  );

  return server;
}

export async function startServer(): Promise<void> {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
