export type RequestKind = "main" | "selection";

/** One foreground task takes priority over disposable selection translations. */
export class RequestManager {
  private active = new Map<RequestKind, AbortController>();

  begin(kind: RequestKind): AbortController | null {
    if (kind === "selection" && this.active.has("main")) return null;
    if (kind === "main") this.cancelAll();
    else this.active.get(kind)?.abort();
    const controller = new AbortController();
    this.active.set(kind, controller);
    return controller;
  }

  finish(kind: RequestKind, controller: AbortController): void {
    if (this.active.get(kind) === controller) this.active.delete(kind);
  }

  cancelAll(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }
}
