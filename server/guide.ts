import { z } from "zod";
import type { Goal, GuidePlan, GuideSource } from "../shared/types.js";
import { validateDraft } from "./intake.js";
import { containsIdentifier, publicProductUrl } from "./privacy.js";

export const guideText = z.string().trim().min(2).max(500).refine(
  (value) => !containsIdentifier(value),
  "Describe what you’re looking for without contact details or a street address.",
);
export const guideStart = z.object({
  text: guideText,
  country: z.enum(["US", "GB", "CA", "AU"]),
  today: z.string().refine((value) => !!isoDay(value), "Use a valid calendar date."),
}).strict();

const field = z.string().max(160).optional();
const interpretation = z.object({
  kind: z.enum(["flight", "discovery", "product"]),
  target: field,
  product: field,
  variant: field,
  origin: field,
  destination: field,
  departureDate: field,
  departureTime: field,
  flightNumber: field,
  returnDate: field,
  preferences: z.array(z.string().max(100)).max(5).optional(),
});

export interface GuideContext {
  turns: readonly string[];
  country: Goal["country"];
  today: string;
}

export interface GuideResearchPlan {
  plan: GuidePlan;
  query?: string;
  matches: (text: string) => boolean;
}

const fold = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function isoDay(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isFinite(+date) && date.toISOString().slice(0, 10) === value) return date;
}

export function resolveTravelDate(value: string, today: string): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isoDay(value) ? value : "";
  const base = isoDay(today);
  if (!base) return value;
  const input = value.toLowerCase().trim();
  if (input === "today" || input === "tomorrow") {
    base.setUTCDate(base.getUTCDate() + Number(input === "tomorrow"));
    return base.toISOString().slice(0, 10);
  }
  const weekday = /^(?:(next|this|on) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(input);
  if (weekday) {
    const offset = (days.indexOf(weekday[2]) - base.getUTCDay() + 7) % 7;
    base.setUTCDate(base.getUTCDate() + (weekday[1] === "next" && offset === 0 ? 7 : offset));
    return base.toISOString().slice(0, 10);
  }
  const named = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(input);
  if (named) {
    const month = months.findIndex((name) => name === named[1] || name.slice(0, 3) === named[1] || (named[1] === "sept" && name === "september"));
    if (month >= 0) {
      const suffix = `-${String(month + 1).padStart(2, "0")}-${named[2].padStart(2, "0")}`;
      let candidate = `${named[3] ?? base.getUTCFullYear()}${suffix}`;
      if (!named[3] && candidate < today) candidate = `${base.getUTCFullYear() + 1}${suffix}`;
      return isoDay(candidate) ? candidate : "";
    }
  }
  // Keep date ranges and flexible periods as stated, rather than picking a day.
  return value;
}

function publicField(value: string | undefined, turns: readonly string[]): string {
  const text = value?.trim() ?? "";
  if (!text || !fold(text) || !turns.some((turn) => fold(turn).includes(fold(text)))) return "";
  if (containsIdentifier(text) || /[$€£¥@]|\b(?:passport|booking reference|reservation code|confirmation code|loyalty number|frequent flyer number)\b/i.test(text)) return "";
  if (/\bbudget\s+(?:of\s+)?\d|\b(?:under|below|up to|max(?:imum)?|at most)\s+\d[\d,.]*$|\b\d[\d,.]*\s*(?:dollars|pounds sterling|euros|USD|CAD|AUD|GBP|EUR)\b/i.test(text)) return "";
  if (!/^[\p{L}\p{M}\p{N} .,'’&()/+:_\-–—]+$/u.test(text)) return "";
  return text;
}

function routeMatch(value: string, text: string) {
  // State and country qualifiers disambiguate the search, but are not always present in a result.
  const name = fold(value.split(",")[0]);
  return !name || text.includes(name);
}

function flightNumber(value: string) {
  const match = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s*-?\s*(\d{1,4}[A-Z]?)$/i.exec(value);
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : "";
}

function explicitFlightNumber(turn: string) {
  return flightNumber(/\bflight\s*(?:number\s*|#\s*)?((?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*-?\s*\d{1,4}[A-Z]?)\b/i.exec(turn)?.[1] ?? "");
}

export function buildGuide(context: GuideContext, output: unknown): GuideResearchPlan {
  const parsed = interpretation.safeParse(output);
  const data = parsed.success ? parsed.data : { kind: "discovery" as const };
  const { turns, country, today } = context;
  const get = (value: string | undefined) => publicField(value, turns);
  const preferences = [...new Set((data.preferences ?? []).map(get).filter(Boolean))];
  const statedNumber = explicitFlightNumber(turns.at(-1) ?? "");
  if (data.kind === "flight" || statedNumber) {
    const origin = get(data.origin), destination = get(data.destination);
    const date = resolveTravelDate(get(data.departureDate), today);
    const time = get(data.departureTime);
    const number = flightNumber(get(data.flightNumber)) || statedNumber;
    const tripChoice = turns.toReversed().map((turn) => [...turn.matchAll(/\b(round[ -]trip|one[ -]way)\b/gi)].at(-1)?.[1]).find(Boolean);
    const returning = /^one/i.test(tripChoice ?? "") ? "" : resolveTravelDate(get(data.returnDate), today);
    const roundTrip = returning || /^round/i.test(tripChoice ?? "");
    const trip = roundTrip ? "Round trip" : tripChoice ? "One way" : "One way for now";
    const route = origin && destination ? `${origin} → ${destination}` : origin ? `Flights from ${origin}` : destination ? `Flights to ${destination}` : "";
    const title = route || (number ? `Flight ${number}` : "Flight search");
    const details = [
      { label: "From", value: origin }, { label: "To", value: destination },
      { label: "Departure date", value: date }, { label: "Departure time", value: time },
      { label: "Flight", value: number }, { label: "Return date", value: returning },
      { label: "Trip", value: trip }, { label: "Preferences", value: preferences.join(", ") },
    ].filter(({ value }) => value);
    const question = !origin && !destination && !number ? "Where are you flying from and to?" :
      !origin && !number ? "Where are you flying from?" :
      !destination && !number ? "Where are you flying to?" :
      !date ? "When would you like to leave? A date or a flexible window is fine." :
      roundTrip && !returning ? "When would you like to fly back?" : undefined;
    const terms = [number ? `Flight ${number}` : "Flights", origin && `from ${origin}`, destination && `to ${destination}`, date && `departing ${date}`, time, returning && `returning ${returning}`, roundTrip ? "round trip" : "one way", ...preferences].filter(Boolean).join(" ");
    const flightSearchUrl = origin && destination ? `https://www.google.com/travel/flights?q=${encodeURIComponent(terms)}` : undefined;
    return {
      plan: { kind: "flight", title, details, question, flightSearchUrl },
      query: origin || destination || number ? `${terms} airline schedule`.slice(0, 390) : undefined,
      matches: (text) => number ? fold(text).includes(fold(number)) : routeMatch(origin, fold(text)) && routeMatch(destination, fold(text)),
    };
  }

  const product = get(data.product), variant = get(data.variant);
  if (data.kind === "product" && product) {
    const source = turns.join("\n");
    const result = validateDraft({ kind: "goal", text: source, country }, { product, variant }, source);
    if ("draft" in result) return {
      plan: { kind: "product", title: product, details: variant ? [{ label: "Variant", value: variant }] : [], draft: result.draft },
      matches: () => false,
    };
  }

  const target = get(data.target) || product;
  const terms = target.split(/\s+/).filter((word) => fold(word).length > 2 && !/^(the|and|for|with|new)$/i.test(word));
  return {
    plan: {
      kind: "discovery",
      title: target || "Shopping search",
      details: preferences.map((value) => ({ label: "Preference", value })),
      question: !target ? "What would you like to find? A category or use case is enough." : !preferences.length ? "Any must-have features, size, or brand? You can also review the first sources as they arrive." : undefined,
    },
    query: target ? `${target} ${preferences.join(" ")} options comparison`.slice(0, 390) : undefined,
    matches: (text) => terms.some((word) => fold(text).includes(fold(word))) || (!terms.length && !!target && fold(text).includes(fold(target))),
  };
}

export function guideSources(raw: unknown, matches: (text: string) => boolean): GuideSource[] {
  const result = z.object({ pii_checked: z.literal(true), results: z.array(z.unknown()) }).safeParse(raw);
  if (!result.success) throw new Error("Search privacy filtering was not confirmed.");
  const item = z.object({ url: z.string().max(2000), title: z.string().max(1000).optional(), content: z.string().optional() });
  const sources = new Map<string, GuideSource>();
  for (const hit of result.data.results.slice(0, 12)) {
    const parsed = item.safeParse(hit);
    if (!parsed.success) continue;
    const { url, title, content } = parsed.data;
    const excerpt = (content ?? "").replace(/\s+/g, " ").trim().slice(0, 420);
    if (!matches(`${title ?? ""} ${excerpt}`)) continue;
    try {
      const clean = publicProductUrl(url);
      const domain = new URL(clean).hostname.replace(/^www\./, "");
      if (!sources.has(clean)) sources.set(clean, { url: clean, title: title?.trim().slice(0, 180) || domain, domain, excerpt });
    } catch { /* Ignore invalid or non-public results. */ }
    if (sources.size >= 6) break;
  }
  return [...sources.values()];
}
