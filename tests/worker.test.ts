import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { createGoal, createPersona } from "../server/privacy.js";
import { runDisposableWorker } from "../server/runner.js";
import { RunStore } from "../server/runs.js";
import type { Broker } from "../server/tinfoil.js";

function fakeBroker(): Broker & { calls: string[]; closed: boolean } {
  const source = {
    url: "https://shop.com/headphones",
    title: "Sony WH-1000XM5 Black",
    content: "Sony WH-1000XM5 Black. New. Current public price $269.99.",
    fetchedAt: new Date().toISOString(),
  };
  return {
    calls: [],
    closed: false,
    async call(method) {
      this.calls.push(method);
      return method === "extract"
        ? {
            offers: [
              {
                sourceIndex: 0,
                title: source.title,
                price: 269.99,
                currency: "USD",
                evidence: "Current public price $269.99.",
                exactMatch: true,
                currentPublicPrice: true,
                condition: "new",
              },
            ],
          }
        : [source];
    },
    async close() {
      this.closed = true;
    },
  };
}
const input = {
  product: "Sony WH-1000XM5",
  variant: "Black",
  country: "US",
  sourceUrls: [],
};
test("a real disposable child completes the broker workflow and exits before returning results", async () => {
  const broker = fakeBroker();
  const result = await runDisposableWorker(
    createGoal(input),
    createPersona("neutral"),
    broker,
    new AbortController().signal,
    () => {},
  );
  assert.equal(result.offers[0].price, 269.99);
  assert.deepEqual(broker.calls, ["search", "fetch", "extract"]);
  assert.equal(broker.closed, true);
});
test("cancellation terminates the child and closes its broker", async () => {
  const abort = new AbortController();
  const broker = fakeBroker();
  broker.call = async () => {
    await delay(10000, undefined, { signal: abort.signal });
    return [];
  };
  const running = runDisposableWorker(
    createGoal(input),
    createPersona("neutral"),
    broker,
    abort.signal,
    () => {},
  );
  setTimeout(() => abort.abort(), 50);
  await assert.rejects(running, /cancelled/);
  assert.equal(broker.closed, true);
});
test("run capabilities prevent cross-run reads; all workers finish and clear removes the record", async () => {
  const store = new RunStore({
    apiKey: "test-key",
    brokerFactory: () => fakeBroker(),
  });
  try {
    const { run, runKey } = store.create(input);
    assert.equal(store.read(run.id, "0".repeat(64)), undefined);
    assert.equal(store.clear(run.id, "0".repeat(64)), false);
    for (let tries = 0; tries < 100 && run.status === "running"; tries++)
      await delay(50);
    assert.equal(run.status, "complete");
    assert.equal(run.workersDisposed, 3);
    assert.equal(run.offers.length, 3);
    assert.equal(store.clear(run.id, runKey), true);
    assert.equal(store.read(run.id, runKey), undefined);
  } finally {
    store.close();
  }
});

test("cancelling a run waits for its launched worker to be disposed", async () => {
  let closed = false;
  const store = new RunStore({
    apiKey: "test-key",
    brokerFactory: (_goal, _persona, signal) => ({
      async call() {
        await delay(10000, undefined, { signal });
        return [];
      },
      async close() {
        closed = true;
      },
    }),
  });
  try {
    const { run, runKey } = store.create(input);
    await delay(60);
    assert.equal(await store.cancel(run.id, "0".repeat(64)), false);
    assert.equal(await store.cancel(run.id, runKey), true);
    assert.equal(run.status, "cancelled");
    assert.equal(run.workersDisposed, 1);
    assert.equal(closed, true);
  } finally {
    store.close();
  }
});
