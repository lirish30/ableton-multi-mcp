import { describe, it, expect, afterEach, vi } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { Ledger } from "../src/ledger.js";
import type { LiveProject } from "../src/project-finder.js";

const APP = { appPath: "/A/Ableton Live 11 Suite.app", bundleName: "Ableton Live 11 Suite.app", version: 11 };

function proj(name: string, path: string): LiveProject {
  return { name, path, modifiedAt: new Date("2026-01-01T00:00:00Z"), projectFolder: null };
}

async function connect(deps: Parameters<typeof createServer>[0]) {
  const server = createServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(result: unknown): string {
  return (result as { content: { type: string; text: string }[] }).content
    .map((c) => c.text)
    .join("\n");
}

describe("MCP server", () => {
  it("exposes exactly the three documented tools", async () => {
    const client = await connect({});
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "find_projects",
      "list_open_instances",
      "open_project",
    ]);
  });

  it("find_projects returns matching project names", async () => {
    const client = await connect({
      find: async () => [proj("Midnight Drive", "/a/Midnight Drive.als")],
    });
    const result = await client.callTool({ name: "find_projects", arguments: { query: "mid" } });
    expect(textOf(result)).toContain("Midnight Drive");
  });

  it("find_projects reports plainly when nothing matches", async () => {
    const client = await connect({ find: async () => [] });
    const result = await client.callTool({ name: "find_projects", arguments: { query: "zzz" } });
    expect(textOf(result)).toMatch(/no .*projects/i);
  });

  it("open_project launches and reports the new instance", async () => {
    const ledger = new Ledger();
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({ kind: "resolved", path: "/a/Set.als", project: null }),
      launch: async () => ({
        pid: 4242,
        confirmed: true,
        projectPath: "/a/Set.als",
        appPath: APP.appPath,
        instanceCount: 2,
      }),
      ledger,
    });
    const text = textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } }));
    expect(text).toContain("4242");
    expect(text).toContain("Ableton Live 11 Suite.app");
    expect(ledger.lookup(4242)?.projectPath).toBe("/a/Set.als");
  });

  it("open_project surfaces the multi-instance warnings on the second instance", async () => {
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({ kind: "resolved", path: "/a/Set.als", project: null }),
      launch: async () => ({
        pid: 1,
        confirmed: true,
        projectPath: "/a/Set.als",
        appPath: APP.appPath,
        instanceCount: 2,
      }),
    });
    expect(textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } })))
      .toMatch(/read-only browser/i);
  });

  it("open_project refuses to guess between ambiguous names", async () => {
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({
        kind: "ambiguous",
        candidates: [proj("A Set", "/a/A Set.als"), proj("A Set 2", "/a/A Set 2.als")],
      }),
      launch: async () => {
        throw new Error("must not launch when ambiguous");
      },
    });
    const text = textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "a set" } }));
    expect(text).toMatch(/which/i);
    expect(text).toContain("A Set 2");
  });

  it("open_project explains when Ableton cannot be found", async () => {
    const client = await connect({
      locate: async () => {
        throw new Error("Could not find Ableton Live. Set ABLETON_APP_PATH.");
      },
    });
    const result = await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } });
    expect(textOf(result)).toMatch(/ABLETON_APP_PATH/);
  });

  it("open_project reports an unconfirmed launch honestly", async () => {
    const client = await connect({
      locate: async () => APP,
      resolve: async () => ({ kind: "resolved", path: "/a/Set.als", project: null }),
      launch: async () => ({
        pid: null,
        confirmed: false,
        projectPath: "/a/Set.als",
        appPath: APP.appPath,
        instanceCount: 0,
      }),
    });
    expect(textOf(await client.callTool({ name: "open_project", arguments: { name_or_path: "Set" } })))
      .toMatch(/could not confirm/i);
  });

  it("list_open_instances labels instances it did not launch as unknown", async () => {
    const ledger = new Ledger();
    ledger.record(11, "/a/Known.als");
    const client = await connect({
      locate: async () => APP,
      listPids: async () => [11, 22],
      ledger,
    });
    const text = textOf(await client.callTool({ name: "list_open_instances", arguments: {} }));
    expect(text).toContain("Known.als");
    expect(text).toMatch(/unknown/i);
  });

  describe("project-not-found messages name the roots actually searched", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("find_projects lists the ABLETON_PROJECTS_DIRS override, one root per line", async () => {
      vi.stubEnv("ABLETON_PROJECTS_DIRS", "/nonexistent/one:/Volumes/Audio/Sets");
      const client = await connect({ find: async () => [] });
      const text = textOf(await client.callTool({ name: "find_projects", arguments: { query: "zzz" } }));
      expect(text).toContain("  - /nonexistent/one\n");
      expect(text).toContain("  - /Volumes/Audio/Sets");
      expect(text).toMatch(/ABLETON_PROJECTS_DIRS/);
      expect(text).not.toContain("Music/Ableton");
    });

    it("find_projects lists the default roots when there is no override", async () => {
      vi.stubEnv("ABLETON_PROJECTS_DIRS", "");
      const client = await connect({ find: async () => [] });
      const text = textOf(await client.callTool({ name: "find_projects", arguments: {} }));
      expect(text).toContain(`  - ${join(homedir(), "Music", "Ableton")}`);
      expect(text).toContain(`  - ${join(homedir(), "Documents", "Ableton")}`);
      expect(text).toMatch(/set the ABLETON_PROJECTS_DIRS/i);
    });

    it("open_project lists the override when no project matches", async () => {
      vi.stubEnv("ABLETON_PROJECTS_DIRS", "/nonexistent");
      const client = await connect({
        locate: async () => APP,
        resolve: async () => ({ kind: "none", query: "Ghost Set" }),
        launch: async () => {
          throw new Error("must not launch when nothing matched");
        },
      });
      const text = textOf(
        await client.callTool({ name: "open_project", arguments: { name_or_path: "Ghost Set" } })
      );
      expect(text).toContain('No Ableton project matched "Ghost Set"');
      expect(text).toContain("  - /nonexistent");
      expect(text).toMatch(/ABLETON_PROJECTS_DIRS/);
    });
  });

  it("list_open_instances says so when nothing is running", async () => {
    const client = await connect({ locate: async () => APP, listPids: async () => [] });
    expect(textOf(await client.callTool({ name: "list_open_instances", arguments: {} })))
      .toMatch(/no .*instances/i);
  });
});
