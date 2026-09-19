export class MutationRoots {
  private readonly roots = new Set<Node>();

  get size(): number {
    return this.roots.size;
  }

  add(root: Node | null): boolean {
    if (root === null || !root.isConnected) return true;
    for (const queued of this.roots) {
      if (queued === root || queued.contains(root)) return true;
      if (root.contains(queued)) this.roots.delete(queued);
    }
    if (this.roots.size >= 64) return false;
    this.roots.add(root);
    return true;
  }

  take(): Node | undefined {
    const root = this.roots.values().next().value;
    if (root !== undefined) this.roots.delete(root);
    return root;
  }

  clear(): void {
    this.roots.clear();
  }
}
