import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestManager } from "../lib/request-manager.ts";

test("foreground work cancels selection work and prevents new selection requests", () => {
  const requests = new RequestManager();
  const selection = requests.begin("selection")!;
  const main = requests.begin("main")!;
  assert.equal(selection.signal.aborted, true);
  assert.equal(main.signal.aborted, false);
  assert.equal(requests.begin("selection"), null);
  requests.finish("main", main);
  assert.ok(requests.begin("selection"));
});

test("stop aborts every request and stale cleanup cannot release a newer task", () => {
  const requests = new RequestManager();
  const old = requests.begin("selection")!;
  const next = requests.begin("selection")!;
  assert.equal(old.signal.aborted, true);
  requests.finish("selection", old);
  requests.cancelAll();
  assert.equal(next.signal.aborted, true);
  assert.ok(requests.begin("main"));
});
