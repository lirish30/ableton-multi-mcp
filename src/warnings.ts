export const MULTI_INSTANCE_WARNINGS: readonly string[] = [
  "Only the first Live instance has a fully functional browser. Secondary instances have a read-only browser: no saving presets, no tagging, no collections, no folder management.",
  "All instances share a single preferences file, so they cannot be given different audio or MIDI settings.",
  "The first instance holds the Live library, plugin folders and linked browser folders.",
  "Expect higher CPU and RAM use, and possible audio device contention if your interface is claimed exclusively.",
  "Running multiple instances is a community workaround and is not supported by Ableton. Save your work often.",
];

export function warningsFor(instanceCount: number): string[] {
  return instanceCount > 1 ? [...MULTI_INSTANCE_WARNINGS] : [];
}
