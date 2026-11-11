import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { buildGuide, guideSources, guideStart, resolveTravelDate, type GuideContext } from "../server/guide.js";
import { GuideStore } from "../server/guide-store.js";

const context = (...turns: string[]): GuideContext => ({ turns, today: "2026-11-11", country: "US" });
const route = { kind: "flight", origin: "Columbus, OH", destination: "Atlanta, GA" };

test("an exact flight retains the number, time, route and resolved date without a retail-model prompt", () => {
  const guide = buildGuide(context("Find me a flight from Columbus, OH to Atlanta, GA next Monday at 7:12 PM (flight # DL 2786)"), {
    ...route, departureDate: "next Monday", departureTime: "7:12 PM", flightNumber: "DL 2786",
  });
  assert.equal(guide.plan.kind, "flight");
  assert.equal(guide.plan.question, undefined);
  assert.match(guide.query!, /Flight DL 2786 from Columbus, OH to Atlanta, GA departing 2026-11-16 7:12 PM/);
  assert.equal(guide.matches("Delta flight DL2786 schedule"), true);
  assert.equal(guide.matches("DL2787 schedule"), false);
  assert.match(new URL(guide.plan.flightSearchUrl!).searchParams.get("q")!, /DL 2786.*2026-11-16.*7:12 PM/);
});

test("a route and morning window can be searched without knowing a flight number", () => {
  const guide = buildGuide(context("Find me a flight from Columbus to Atlanta next Monday morning"), {
    kind: "flight", origin: "Columbus", destination: "Atlanta", departureDate: "next Monday", departureTime: "morning", flightNumber: "DL 9999",
  });
  assert.equal(guide.plan.title, "Columbus → Atlanta");
  assert.match(guide.query!, /2026-11-16 morning/);
  assert.doesNotMatch(guide.query!, /9999/);
  assert.equal(guide.plan.question, undefined);
  assert.equal(guide.matches("Flights from Columbus to Atlanta"), true);
  assert.equal(guide.matches("Flights from Columbus to Phoenix"), false);
  assert.equal(resolveTravelDate("next Monday", "2026-11-16"), "2026-11-23");
  assert.equal(resolveTravelDate("tomorrow", "2026-12-31"), "2027-01-01");
  assert.equal(resolveTravelDate("Nov 16", "2026-11-11"), "2026-11-16");
});

test("broad discovery does not force an exact model or send a budget to public search", () => {
  const guide = buildGuide(context("Find a lightweight laptop for travel under $800, preferably under 700 dollars"), {
    kind: "discovery", target: "lightweight laptop", preferences: ["for travel", "under $800", "under 700 dollars", "blue"],
  });
  assert.match(guide.query!, /lightweight laptop for travel/);
  assert.doesNotMatch(guide.query!, /800|700|blue/);
  assert.equal(guide.plan.draft, undefined);
  assert.equal(guideStart.safeParse({ text: "Send prices to person@example.org", country: "US", today: "2026-11-11" }).success, false);
  const exact = buildGuide(context("Compare Sony WH-1000XM5 in black"), { kind: "product", product: "Sony WH-1000XM5", variant: "black" });
  assert.equal(exact.plan.draft?.product, "Sony WH-1000XM5");
  assert.equal(exact.query, undefined);
});

test("references require a privacy-checked response, relevant evidence and a public URL", () => {
  const items = [
    { title: "Columbus to Atlanta flights", url: "https://airline.example.org/routes?tracking=abc", content: "Route information" },
    { title: "Columbus to Atlanta flights", url: "https://airline.example.org/routes?tracking=def" },
    { title: "Columbus to Atlanta flights", url: "http://127.0.0.1/private" },
    { title: "Columbus to Phoenix flights", url: "https://airline.example.org/another" },
  ];
  const matches = (value: string) => value.includes("Atlanta");
  assert.throws(() => guideSources({ pii_checked: false, results: items }, matches), /privacy filtering/);
  const sources = guideSources({ pii_checked: true, results: items }, matches);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, "https://airline.example.org/routes");
});

test("a follow-up is accepted during discovery and supersedes stale work without losing the route", async () => {
  const calls: { query: string; signal: AbortSignal; finish: (value: unknown) => void }[] = [];
  const store = new GuideStore({
    plan: async (current) => buildGuide(current, { ...route, departureDate: current.turns.length === 2 ? "next Monday" : "" }),
    search: (query, _country, signal) => new Promise((finish) => calls.push({ query, signal, finish })),
  });
  try {
    const { guide, runKey } = store.create({ text: "Find flights from Columbus, OH to Atlanta, GA", country: "US", today: "2026-11-11" });
    assert.equal(guide.status, "planning");
    assert.equal(store.read(guide.id, "wrong key"), undefined);
    await setImmediate();
    const waiting = store.read(guide.id, runKey)!;
    assert.equal(waiting.status, "searching");
    assert.match(waiting.plan!.question!, /When would you like to leave/);
    assert.match(calls[0].query, /from Columbus, OH to Atlanta, GA/);
    assert.equal(store.reply(guide.id, runKey, "next Monday")?.revision, 2);
    assert.equal(calls[0].signal.aborted, true);
    await setImmediate();
    assert.match(calls[1].query, /from Columbus, OH to Atlanta, GA departing 2026-11-16/);
    calls[1].finish({ pii_checked: true, results: [{ title: "Columbus to Atlanta schedule", url: "https://airline.example.org/new" }] });
    calls[0].finish({ pii_checked: true, results: [{ title: "Columbus to Atlanta old result", url: "https://airline.example.org/old" }] });
    await setImmediate();
    const updated = store.read(guide.id, runKey)!;
    assert.equal(updated.status, "ready");
    assert.equal(updated.plan?.question, undefined);
    assert.equal(updated.turns.length, 2);
    assert.deepEqual(updated.sources.map(({ url }) => url), ["https://airline.example.org/new"]);
    assert.equal(store.clear(guide.id, runKey), true);
    assert.equal(store.read(guide.id, runKey), undefined);
  } finally {
    store.close();
  }
});
