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
  adults: field,
  cabin: field,
  airline: field,
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
  flight?: FlightRequest;
  matches: (text: string) => boolean;
}

export interface FlightRequest {
  origin: string;
  destination: string;
  date: string;
  returnDate?: string;
  time?: { from: number; to: number };
  number?: string;
  nonstop: boolean;
  airline?: string;
  adults: number;
  cabin: "economy" | "premium economy" | "business" | "first";
  country: Goal["country"];
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
  const named = /^(?:(sunday|monday|tuesday|wednesday|thursday|friday|saturday),? )?([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(input);
  if (named) {
    const [, statedWeekday, name, day, year] = named;
    const month = months.findIndex((full) => full === name || full.slice(0, 3) === name || (name === "sept" && full === "september"));
    if (month >= 0) {
      const suffix = `-${String(month + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
      let candidate = `${year ?? base.getUTCFullYear()}${suffix}`;
      if (!year && candidate < today) candidate = `${base.getUTCFullYear() + 1}${suffix}`;
      const resolved = isoDay(candidate);
      return resolved && (!statedWeekday || days[resolved.getUTCDay()] === statedWeekday) ? candidate : "";
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

function flightNumber(value: string) {
  const match = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s*-?\s*(\d{1,4}[A-Z]?)$/i.exec(value);
  return match ? `${match[1].toUpperCase()} ${match[2].toUpperCase()}` : "";
}

function explicitFlightNumbers(turn: string): string[] {
  const marked = /\bflight\s*(?:number\s*#?\s*|#\s*)((?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*-?\s*\d{1,4}[A-Z]?)(?![\w:]|\s*(?:a\.?m\.?|p\.?m\.?)\b)/gi;
  const bare = /\b((?:[A-Z][A-Z0-9]|[0-9][A-Z])\s*-?\s*\d{1,4}[A-Z]?)(?![\w:]|\s*(?:[aApP]\.?[mM]\.?)\b)/g;
  return [...turn.matchAll(marked), ...turn.matchAll(bare)].map((match) => flightNumber(match[1])).filter(Boolean);
}

function travelTime(value: string): FlightRequest["time"] {
  const input = value.toLowerCase().replace(/\./g, "").trim();
  const windows: Record<string, [number, number]> = {
    morning: [0, 719], afternoon: [720, 1019], evening: [1020, 1259], night: [1260, 1439],
  };
  if (windows[input]) return { from: windows[input][0], to: windows[input][1] };
  const clock = /^(?:(at|after|before) )?(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/.exec(input);
  if (!clock) return;
  const [, modifier, hour, minute, meridiem] = clock;
  const h = Number(hour);
  if (meridiem ? h < 1 || h > 12 : h > 23 || !minute) return;
  const minutes = (meridiem ? (h % 12) + (meridiem === "pm" ? 12 : 0) : h) * 60 + Number(minute ?? 0);
  return modifier === "after" ? { from: minutes + 1, to: 1439 } : modifier === "before" ? { from: 0, to: minutes - 1 } : { from: minutes, to: minutes };
}

export function buildGuide(context: GuideContext, output: unknown): GuideResearchPlan {
  const parsed = interpretation.safeParse(output);
  const data = parsed.success ? parsed.data : { kind: "discovery" as const };
  const { turns, country, today } = context;
  const get = (value: string | undefined) => publicField(value, turns);
  const preferences = [...new Set((data.preferences ?? []).map(get).filter(Boolean))];
  const latest = turns.at(-1) ?? "";
  const statedNumbers = explicitFlightNumbers(latest);
  const marked = /\bflight\s*(?:number\b|#)/i.test(latest);
  if (data.kind === "flight" || (marked && statedNumbers.length)) {
    const origin = get(data.origin), destination = get(data.destination);
    const date = resolveTravelDate(get(data.departureDate), today);
    const time = get(data.departureTime);
    const proposed = flightNumber(get(data.flightNumber));
    const number = proposed && turns.some((turn) => explicitFlightNumbers(turn).includes(proposed))
      ? proposed : marked ? statedNumbers[0] ?? "" : "";
    const tripChoice = turns.toReversed().map((turn) => [...turn.matchAll(/\b(round[ -]trip|one[ -]way)\b/gi)].at(-1)?.[1]).find(Boolean);
    const returning = /^one/i.test(tripChoice ?? "") ? "" : resolveTravelDate(get(data.returnDate), today);
    const roundTrip = returning || /^round/i.test(tripChoice ?? "");
    const trip = roundTrip ? "Round trip" : tripChoice ? "One way" : "One way for now";
    const route = origin && destination ? `${origin} → ${destination}` : origin ? `Flights from ${origin}` : destination ? `Flights to ${destination}` : "";
    const title = route || (number ? `Flight ${number}` : "Flight search");
    const adultField = get(data.adults);
    const adultCount = /\b([1-9]|one|two|three|four|five|six|seven|eight|nine)\b/i.exec(adultField)?.[1].toLowerCase();
    const adults = adultCount ? (Number(adultCount) || ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].indexOf(adultCount) + 1) : 1;
    const cabinField = get(data.cabin).toLowerCase().replace(/ class$/, "");
    const cabin = (["economy", "premium economy", "business", "first"] as const).find((item) => item === cabinField) ?? "economy";
    const airline = get(data.airline);
    const nonstop = preferences.some((value) => /^(?:only )?(?:non[ -]?stop|no stops|direct)(?: flights?| only)?$/i.test(value));
    const timeWindow = travelTime(time);
    const other = preferences.filter((value) => !/^(?:only )?(?:non[ -]?stop|no stops|direct)(?: flights?| only)?$/i.test(value) &&
      ![adultField, cabinField, airline].some((field) => field && fold(field) === fold(value)));
    const details = [
      { label: "From", value: origin }, { label: "To", value: destination },
      { label: "Departure date", value: date }, { label: "Departure time", value: time },
      { label: "Flight", value: number }, { label: "Return date", value: returning },
      { label: "Trip", value: trip }, { label: "Preferences", value: preferences.join(", ") },
      { label: "Passengers", value: `${adults} ${adults === 1 ? "adult" : "adults"}` },
      { label: "Cabin", value: cabin }, { label: "Airline", value: airline },
    ].filter(({ value }) => value);
    const question = !origin && !destination ? "Where are you flying from and to?" :
      !origin ? "Where are you flying from?" :
      !destination ? "Where are you flying to?" :
      !isoDay(date) || date < today ? "Which departure date should I check for fares?" :
      roundTrip && (!isoDay(returning) || returning < date) ? "Which date would you like to fly back?" :
      time && !timeWindow ? "What local departure time should I check? Try 4:10 PM or a window like morning." :
      other.length || (adultField && !adultCount) || (cabinField && cabinField !== cabin) ? "I can check dates, departure times, cabin, adult travelers, airlines and nonstop flights. Which of those should I use?" : undefined;
    const terms = [number ? `Flight ${number}` : "Flights", origin && `from ${origin}`, destination && `to ${destination}`, date && `departing ${date}`, time, returning && `returning ${returning}`, roundTrip ? "round trip" : "one way", ...preferences].filter(Boolean).join(" ");
    const flightSearchUrl = origin && destination ? `https://www.google.com/travel/flights?q=${encodeURIComponent(terms)}` : undefined;
    return {
      plan: { kind: "flight", title, details, question, flightSearchUrl, canCheckFares: !question },
      flight: question ? undefined : {
        origin, destination, date, returnDate: returning || undefined, time: timeWindow,
        number: number || undefined, nonstop, airline: airline || undefined, adults, cabin, country,
      },
      matches: () => false,
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
