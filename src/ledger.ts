export interface LedgerEntry {
  pid: number;
  projectPath: string;
  startedAt: Date;
}

/**
 * In-memory only. A server restart forgets prior launches, and those instances
 * then report an unknown project. This is deliberate: reading another process's
 * open document reliably would require accessibility permissions, which is a
 * disproportionate ask for a cosmetic field.
 */
export class Ledger {
  private entries = new Map<number, LedgerEntry>();

  record(pid: number, projectPath: string): void {
    this.entries.set(pid, { pid, projectPath, startedAt: new Date() });
  }

  lookup(pid: number): LedgerEntry | undefined {
    return this.entries.get(pid);
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }
}
