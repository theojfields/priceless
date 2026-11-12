import { setTimeout as wait } from "node:timers/promises";
import { z } from "zod";
import type { FlightFare, FlightLeg } from "../shared/types.js";
import type { FlightRequest } from "./guide.js";
import { publicProductUrl } from "./privacy.js";

const providerBase = "https://partners.api.skyscanner.net/apiservices/v3";
const market = {
  US: ["US", "en-US", "USD"], GB: ["UK", "en-GB", "GBP"],
  CA: ["CA", "en-CA", "CAD"], AU: ["AU", "en-AU", "AUD"],
} as const;
const iata = z.string().regex(/^[A-Z]{3}$/);
const placeId = z.string().regex(/^\d{1,24}$/);
const ids = z.array(z.string().min(1).max(200));
const index = z.record(z.string(), z.unknown());
const place = z.object({ iata: iata.optional(), entityId: z.string().optional(), parentId: z.string().optional(), name: z.string().max(150).optional() });
const moment = z.object({
  year: z.number().int().min(2000).max(2200),
  month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31),
  hour: z.number().int().min(0).max(23).default(0), minute: z.number().int().min(0).max(59).default(0),
});
const leg = z.object({
  originPlaceId: z.string(), destinationPlaceId: z.string(),
  departureDateTime: moment, arrivalDateTime: moment, segmentIds: ids.min(1).max(8),
});
const segment = leg.omit({ segmentIds: true }).extend({ marketingCarrierId: z.string(), marketingFlightNumber: z.string() });
const carrier = z.object({ name: z.string().max(120), iata: z.string().regex(/^[A-Z0-9]{2}$/) });
const itinerary = z.object({ legIds: ids, pricingOptions: z.array(z.unknown()) });
const price = z.object({ amount: z.string().regex(/^\d{1,15}$/), unit: z.string() });
const option = z.object({
  price, transferType: z.string().optional(), agentIds: ids.optional(),
  items: z.array(z.object({ agentId: z.string(), deepLink: z.string().max(8192), price: price.optional() })).length(1),
});
const agent = z.object({ name: z.string().trim().min(1).max(120), type: z.literal("AGENT_TYPE_AIRLINE") });

type Place = { iata: string } | { entityId: string };
export type FlightLookup = { fares: FlightFare[]; question?: string };
const norm = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
const pad = (value: number) => String(value).padStart(2, "0");

function localTime(value: z.infer<typeof moment>) {
  return `${value.year}-${pad(value.month)}-${pad(value.day)}T${pad(value.hour)}:${pad(value.minute)}`;
}

function cents(value: z.infer<typeof price>) {
  const units: Record<string, number> = {
    PRICE_UNIT_WHOLE: 1, PRICE_UNIT_CENTI: 100, PRICE_UNIT_MILLI: 1000, PRICE_UNIT_MICRO: 1000000,
  };
  return Math.round((Number(value.amount) / units[value.unit]) * 100);
}

function bookingUrl(value: string) {
  try {
    // The supplier's query parameters identify the selected fare. Validate the
    // URL but keep those parameters; the server never fetches this link.
    publicProductUrl(value);
    return new URL(value).href;
  } catch { return undefined; }
}

export function matchFlightFares(raw: unknown, request: FlightRequest, origin: Place, destination: Place, checkedAt = new Date().toISOString()): FlightFare[] {
  const parsed = z.object({
    itineraries: index, legs: index, segments: index, places: index, carriers: index, agents: index,
  }).safeParse(raw);
  if (!parsed.success) return [];
  const data = parsed.data;
  const currency = market[request.country][2];
  const found = new Map<string, FlightFare>();
  const samePlace = (actual: string, expected: Place) => {
    const p = place.safeParse(data.places[actual]);
    return p.success && ("iata" in expected
      ? p.data.iata === expected.iata
      : [actual, p.data.entityId, p.data.parentId].includes(expected.entityId));
  };

  for (const value of Object.values(data.itineraries)) {
    const trip = itinerary.safeParse(value);
    if (!trip.success || trip.data.legIds.length !== (request.returnDate ? 2 : 1)) continue;
    const legs: FlightLeg[] = [];
    let rejected = false;
    for (const [idx, id] of trip.data.legIds.entries()) {
      const result = leg.safeParse(data.legs[id]);
      if (!result.success) { rejected = true; break; }
      const current = result.data;
      const depart = localTime(current.departureDateTime);
      const minute = current.departureDateTime.hour * 60 + current.departureDateTime.minute;
      const stops = current.segmentIds.length - 1;
      if (!samePlace(current.originPlaceId, idx ? destination : origin) ||
          !samePlace(current.destinationPlaceId, idx ? origin : destination) ||
          depart.slice(0, 10) !== (idx ? request.returnDate : request.date) ||
          (request.nonstop && stops > 0) ||
          (!idx && request.time && (minute < request.time.from || minute > request.time.to))) {
        rejected = true;
        break;
      }
      const departureAirport = place.parse(data.places[current.originPlaceId]);
      const arrivalAirport = place.parse(data.places[current.destinationPlaceId]);
      const from = departureAirport.iata;
      const to = arrivalAirport.iata;
      const segments: FlightLeg["segments"] = [];
      for (const segId of current.segmentIds) {
        const seg = segment.safeParse(data.segments[segId]);
        if (!seg.success || !/^\d{1,4}[A-Z]?$/.test(seg.data.marketingFlightNumber)) break;
        const code = carrier.safeParse(data.carriers[seg.data.marketingCarrierId]);
        const segmentFrom = place.safeParse(data.places[seg.data.originPlaceId]);
        const segmentTo = place.safeParse(data.places[seg.data.destinationPlaceId]);
        if (!code.success || !segmentFrom.success || !segmentTo.success || !segmentFrom.data.iata || !segmentTo.data.iata) break;
        segments.push({
          flight: `${code.data.iata} ${seg.data.marketingFlightNumber}`, airline: code.data.name,
          from: segmentFrom.data.iata, to: segmentTo.data.iata,
          departure: localTime(seg.data.departureDateTime), arrival: localTime(seg.data.arrivalDateTime),
        });
      }
      const flights = segments.map((item) => item.flight);
      const requestedAirline = norm(request.airline ?? "").replace(/ airlines?$/, "");
      if (!from || !to || flights.length !== current.segmentIds.length ||
          segments[0]?.from !== from || segments.at(-1)?.to !== to ||
          segments[0]?.departure !== depart ||
          (!idx && request.number && !flights.includes(request.number)) ||
          (requestedAirline && !segments.every((item) =>
            norm(item.airline).replace(/ airlines?$/, "") === requestedAirline || norm(item.flight.split(" ")[0]) === requestedAirline))) {
        rejected = true;
        break;
      }
      legs.push({ from, to, fromName: departureAirport.name, toName: arrivalAirport.name, departure: depart, arrival: localTime(current.arrivalDateTime), flights, stops, segments });
    }
    if (rejected) continue;

    for (const value of trip.data.pricingOptions) {
      const quote = option.safeParse(value);
      if (!quote.success || (quote.data.transferType && !["TRANSFER_TYPE_MANAGED", "TRANSFER_TYPE_UNSPECIFIED"].includes(quote.data.transferType))) continue;
      const [item] = quote.data.items;
      if (quote.data.agentIds && (quote.data.agentIds.length !== 1 || quote.data.agentIds[0] !== item.agentId)) continue;
      const seller = agent.safeParse(data.agents[item.agentId]);
      const href = bookingUrl(item.deepLink);
      const amount = cents(quote.data.price);
      if (!seller.success || !href || !Number.isSafeInteger(amount) || amount < 1 || (item.price && cents(item.price) !== amount)) continue;
      const key = JSON.stringify([seller.data.name, legs.map((l) => [l.departure, l.flights]), amount]);
      found.set(key, { seller: seller.data.name, total: amount / 100, currency, bookingUrl: href, legs, adults: request.adults, checkedAt });
    }
  }

  return [...found.values()].sort((a, b) => a.total - b.total || a.seller.localeCompare(b.seller)).slice(0, 8);
}

export async function lookupFlightFares(request: FlightRequest, apiKey: string, signal: AbortSignal, transport: typeof fetch = fetch): Promise<FlightLookup> {
  const [marketId, locale, currency] = market[request.country];
  signal = AbortSignal.any([signal, AbortSignal.timeout(40_000)]);
  async function post(path: string, body?: object) {
    const response = await transport(providerBase + path, {
      method: "POST", redirect: "error", signal, cache: "no-store",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error("Flight pricing provider unavailable.");
    return response.json() as Promise<unknown>;
  }
  async function resolve(input: string, isDestination: boolean): Promise<Place | undefined> {
    const code = iata.safeParse(input);
    if (code.success) return { iata: code.data };
    const raw = await post("/autosuggest/flights", {
      query: { market: marketId, locale, searchTerm: input, includedEntityTypes: ["PLACE_TYPE_CITY", "PLACE_TYPE_AIRPORT"] },
      limit: 12, isDestination,
    });
    const { places } = z.object({ places: z.array(z.unknown()) }).parse(raw);
    const candidate = z.object({ name: z.string(), entityId: placeId, hierarchy: z.string().optional() });
    const [name, ...qualifiers] = input.split(",").map(norm);
    const matching = new Map<string, Place>();
    for (const value of places) {
      const parsed = candidate.safeParse(value);
      if (!parsed.success || norm(parsed.data.name) !== name) continue;
      const hierarchy = (parsed.data.hierarchy ?? "").split(/[|,]/).map(norm);
      if (qualifiers.some((part) => !hierarchy.includes(part))) continue;
      matching.set(parsed.data.entityId, { entityId: parsed.data.entityId });
    }
    return matching.size === 1 ? matching.values().next().value : undefined;
  }

  const [origin, destination] = await Promise.all([resolve(request.origin, false), resolve(request.destination, true)]);
  if (!origin || !destination) {
    const side = !origin && !destination ? "departure and arrival airport codes" : !origin ? "departure airport code" : "arrival airport code";
    return { fares: [], question: `Which ${side} should I use? Three-letter codes let me check the exact route.` };
  }

  const queryLeg = (from: Place, to: Place, date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return { originPlaceId: from, destinationPlaceId: to, date: { year, month, day } };
  };
  const queryLegs = [queryLeg(origin, destination, request.date)];
  if (request.returnDate) queryLegs.push(queryLeg(destination, origin, request.returnDate));
  const status = z.object({
    status: z.enum(["RESULT_STATUS_COMPLETE", "RESULT_STATUS_INCOMPLETE", "RESULT_STATUS_FAILED"]),
    sessionToken: z.string().max(2048).optional(), action: z.string().optional(),
    content: z.object({ results: z.unknown() }).optional(),
  });
  let snapshot = status.parse(await post("/flights/live/search/create", {
    query: { market: marketId, locale, currency, queryLegs, adults: request.adults,
      cabinClass: `CABIN_CLASS_${request.cabin.toUpperCase().replace(" ", "_")}` },
  }));
  const session = snapshot.sessionToken;
  let latest = snapshot.content?.results;
  for (let attempt = 0; snapshot.status === "RESULT_STATUS_INCOMPLETE" && session && attempt < 9; attempt++) {
    await wait(1500, undefined, { signal });
    snapshot = status.parse(await post(`/flights/live/search/poll/${encodeURIComponent(session)}`));
    if (snapshot.action === "RESULT_ACTION_REPLACED") latest = snapshot.content?.results;
    else if (latest === undefined && snapshot.action !== "RESULT_ACTION_NOT_MODIFIED") latest = snapshot.content?.results;
  }
  if (snapshot.status !== "RESULT_STATUS_COMPLETE") throw new Error("The flight pricing provider did not finish the search.");
  return { fares: matchFlightFares(latest, request, origin, destination) };
}
