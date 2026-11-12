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
  assert.equal(guide.flight?.number, "DL 2786");
  assert.deepEqual(guide.flight?.time, { from: 19 * 60 + 12, to: 19 * 60 + 12 });
  assert.equal(guide.query, undefined);
  assert.match(new URL(guide.plan.flightSearchUrl!).searchParams.get("q")!, /DL 2786.*2026-11-16.*7:12 PM/);
});

test("a route and morning window can be searched without knowing a flight number", () => {
  const guide = buildGuide(context("Find me a flight from Columbus to Atlanta next Monday morning"), {
    kind: "flight", origin: "Columbus", destination: "Atlanta", departureDate: "next Monday", departureTime: "morning", flightNumber: "DL 9999",
  });
  assert.equal(guide.plan.title, "Columbus → Atlanta");
  assert.equal(guide.flight?.date, "2026-11-16");
  assert.deepEqual(guide.flight?.time, { from: 0, to: 719 });
  assert.equal(guide.flight?.number, undefined);
  assert.equal(guide.plan.question, undefined);
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

test("the reported time is not a flight number and the quoted price is not a search term", () => {
  for (const phrasing of ["flight at 4:10 PM", "FLIGHT AT 4:10 PM", "flight at 4 PM"]) {
    const time = phrasing.includes(":10") ? "4:10 PM" : "4 PM";
    const guide = buildGuide(context(
      "Find me a one way flight from CMH to Atlanta next Monday at 4:10 PM",
      `I see $404. Find a ${phrasing} on Monday, Nov 16th.`,
    ), {
      kind: "flight", origin: "CMH", destination: "Atlanta", departureDate: "Monday, Nov 16th", departureTime: time, flightNumber: "AT 4",
    });
    assert.equal(guide.flight?.date, "2026-11-16");
    assert.equal(guide.flight?.number, undefined);
    assert.equal(guide.flight?.time?.from, time.includes(":10") ? 970 : 960);
    assert.equal(guide.plan.question, undefined);
    assert.doesNotMatch(guide.plan.flightSearchUrl!, /404|Flight%20AT%204/);
  }
});

test("a flight follow-up preserves the route, invalidates stale work and requires a new explicit fare check", async () => {
  const calls: { date: string; signal: AbortSignal; finish: (result: { fares: []; question?: string }) => void }[] = [];
  const store = new GuideStore({
    plan: async (current) => buildGuide(current, {
      ...route, departureDate: current.turns.at(-1)?.includes("Tuesday") ? "next Tuesday" : "next Monday",
    }),
    search: async () => { throw new Error("Do not search indexed pages for flight fares"); },
    fares: (flight, signal) => new Promise((finish) => calls.push({ date: flight.date, signal, finish })),
  });
  try {
    const { guide, runKey } = store.create({ text: "Find flights from Columbus, OH to Atlanta, GA next Monday", country: "US", today: "2026-11-11" });
    assert.equal(guide.status, "planning");
    assert.equal(store.read(guide.id, "wrong key"), undefined);
    await setImmediate();
    assert.equal(store.read(guide.id, runKey)?.status, "ready");
    assert.equal(calls.length, 0);
    assert.equal(store.checkFares(guide.id, runKey, 1)?.status, "searching");
    assert.equal(calls[0].date, "2026-11-16");
    assert.equal(store.reply(guide.id, runKey, "next Tuesday")?.revision, 2);
    assert.equal(calls[0].signal.aborted, true);
    await setImmediate();
    assert.equal(store.checkFares(guide.id, runKey, 1), undefined);
    assert.equal(calls.length, 1);
    assert.equal(store.read(guide.id, runKey)?.plan?.title, "Columbus, OH → Atlanta, GA");
    assert.equal(store.checkFares(guide.id, runKey, 2)?.status, "searching");
    assert.equal(calls[1].date, "2026-11-17");
    calls[0].finish({ fares: [], question: "Outdated question" });
    calls[1].finish({ fares: [] });
    await setImmediate();
    const updated = store.read(guide.id, runKey)!;
    assert.equal(updated.status, "ready");
    assert.equal(updated.plan?.question, undefined);
    assert.equal(updated.turns.length, 2);
    assert.equal(store.clear(guide.id, runKey), true);
    assert.equal(store.read(guide.id, runKey), undefined);
  } finally {
    store.close();
  }
});
