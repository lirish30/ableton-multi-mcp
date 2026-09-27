export class UnsupportedPlatformError extends Error {
  constructor(public readonly detected: NodeJS.Platform) {
    super(
      `ableton-multi-mcp requires macOS, but detected platform "${detected}". ` +
        `The multi-instance mechanism this server uses (the macOS "open -n" command) ` +
        `does not exist on other platforms.`
    );
    this.name = "UnsupportedPlatformError";
  }
}

export function assertMacOS(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "darwin") {
    throw new UnsupportedPlatformError(platform);
  }
}
