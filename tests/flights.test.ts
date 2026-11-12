import test from "node:test";
import assert from "node:assert/strict";
import { lookupFlightFares, matchFlightFares } from "../server/flights.js";
import type { FlightRequest } from "../server/guide.js";
import type { Goal, Offer } from "../shared/types.js";
import { bestRetailOffer } from "../shared/retail.js";

const request: FlightRequest = {
  origin: "CMH", destination: "Atlanta", date: "2026-11-16", time: { from: 970, to: 970 },
  nonstop: true, adults: 1, cabin: "economy", country: "US",
};
const quote = (amount: number, seller: string, href = "https://www.southwest.com/air/booking/select.html?offer=selected") => ({
  price: { amount: String(amount * 1000), unit: "PRICE_UNIT_MILLI" },
  agentIds: [seller], items: [{ agentId: seller, deepLink: href }],
});
const stamp = { year: 2026, month: 11, day: 16, hour: 16, minute: 10 };
const leg = {
  originPlaceId: "cmh", destinationPlaceId: "atl", departureDateTime: stamp,
  arrivalDateTime: { ...stamp, hour: 17, minute: 50 }, segmentIds: ["southwest"],
};
const results = {
  itineraries: {
    exact: { legIds: ["exact"], pricingOptions: [
      quote(404, "wn"), quote(474, "wn"), quote(201, "ota"),
      quote(120, "wn", "http://127.0.0.1/private"), quote(160, "wn", ""),
    ] },
    wrongTime: { legIds: ["early"], pricingOptions: [quote(99, "wn")] },
    wrongDate: { legIds: ["tomorrow"], pricingOptions: [quote(109, "wn")] },
    wrongAirport: { legIds: ["other"], pricingOptions: [quote(119, "wn")] },
  },
  legs: {
    exact: leg,
    early: { ...leg, departureDateTime: { ...stamp, minute: 9 } },
    tomorrow: { ...leg, departureDateTime: { ...stamp, day: 17 } },
    other: { ...leg, originPlaceId: "lck" },
  },
  segments: { southwest: { ...leg, marketingCarrierId: "WN", marketingFlightNumber: "1234" } },
  places: { cmh: { iata: "CMH" }, atl: { iata: "ATL", parentId: "123" }, lck: { iata: "LCK" } },
  carriers: { WN: { iata: "WN", name: "Southwest Airlines" } },
  agents: { wn: { name: "Southwest", type: "AGENT_TYPE_AIRLINE" }, ota: { name: "Unverified OTA", type: "AGENT_TYPE_TRAVEL_AGENT" } },
};

test("the lowest matching airline-direct total wins over cheaper non-matches, unknown sellers and non-bookable quotes", () => {
  const args = [{ iata: "CMH" }, { entityId: "123" }] as const;
  const fares = matchFlightFares(results, request, ...args);
  assert.deepEqual(fares.map((f) => f.total), [404, 474]);
  assert.equal(fares[0].seller, "Southwest");
  assert.equal(fares[0].legs[0].departure, "2026-11-16T16:10");
  assert.equal(new URL(fares[0].bookingUrl).searchParams.get("offer"), "selected");
  assert.deepEqual(matchFlightFares(results, { ...request, number: "DL 2786" }, ...args), []);
  assert.deepEqual(matchFlightFares(results, { ...request, returnDate: "2026-11-19" }, ...args), []);
});

test("fare lookup sends only structured itinerary fields to the named provider", async () => {
  const requests: { url: string; body: any }[] = [];
  const fetchFixture: typeof fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    assert.equal(new URL(url).hostname, "partners.api.skyscanner.net");
    assert.equal(new Headers(init?.headers).get("x-api-key"), "fixture-key");
    assert.equal(init?.redirect, "error");
    return url.endsWith("/autosuggest/flights")
      ? Response.json({ places: [{ entityId: "123", name: "Atlanta" }, { entityId: "987", name: "Atlantic City" }] })
      : Response.json({ status: "RESULT_STATUS_COMPLETE", content: { results } });
  };
  const found = await lookupFlightFares(request, "fixture-key", new AbortController().signal, fetchFixture);
  assert.deepEqual(found.fares.map((f) => f.total), [404, 474]);
  assert.deepEqual(requests[1].body, {
    query: {
      market: "US", locale: "en-US", currency: "USD", adults: 1, cabinClass: "CABIN_CLASS_ECONOMY",
      queryLegs: [{ originPlaceId: { iata: "CMH" }, destinationPlaceId: { entityId: "123" }, date: { year: 2026, month: 11, day: 16 } }],
    },
  });
});

test("a cheaper listing from an unfamiliar seller does not become the retail recommendation", () => {
  const goal = { country: "US", currency: "USD" } as Goal;
  const offer = (url: string, price: number) => ({ url, price, currency: "USD" } as Offer);
  assert.equal(bestRetailOffer([
    offer("https://www.bestbuy.com.fakeshop.com/headphones", 59),
    offer("https://www.bestbuy.com/site/headphones", 89),
    { ...offer("https://www.bestbuy.com/site/other", 279), evidence: "$279. Sold by Best Buy." },
    offer("https://www.bhphotovideo.com/c/product/123", 269),
  ], goal)?.price, 269);
  assert.equal(bestRetailOffer([offer("https://unfamiliar.com/product", 89)], goal), undefined);
});
