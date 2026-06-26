class UsageTracker {
  private counts = new Map<string, number>();

  recordUsage(identifier: string): void {
    this.counts.set(identifier, (this.counts.get(identifier) ?? 0) + 1);
  }

  boostFor(identifier: string): number {
    const count = this.counts.get(identifier) ?? 0;
    return Math.min(count * 0.5, 3);
  }

  clear(): void {
    this.counts.clear();
  }
}

const sessionTracker = new UsageTracker();

export { UsageTracker, sessionTracker };
