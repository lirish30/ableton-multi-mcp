#!/usr/bin/env node
import { assertMacOS, UnsupportedPlatformError } from "./platform.js";
import { startServer } from "./server.js";

// Never write to stdout: it carries the MCP protocol stream.
try {
  assertMacOS();
} catch (err) {
  if (err instanceof UnsupportedPlatformError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}

startServer().catch((err) => {
  console.error(`ableton-multi-mcp failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
