import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Goal, Offer, SourcePage } from "../shared/types.js";
import { productMatches, publicProductUrl } from "./privacy.js";

export const extractedSchema = z.object({
  offers: z
    .array(
      z.object({
        sourceIndex: z.number().int().min(0),
        title: z.string().max(250),
        price: z.number().positive().max(1000000),
        currency: z.string().length(3),
        evidence: z.string().min(4).max(1000),
        exactMatch: z.boolean(),
        currentPublicPrice: z.boolean(),
        condition: z.enum(["new", "used", "unknown"]),
      }),
    )
    .max(8),
});

const normalize = (v: string) =>
  v.normalize("NFKC").replace(/\s+/g, " ").trim();
export function evidenceContainsPrice(
  evidence: string,
  price: number,
  currency: string,
): boolean {
  const symbols: Record<string, string> = {
    USD: "\\$|USD|US\\$",
    GBP: "£|GBP",
    CAD: "CA\\$|CAD|C\\$|\\$",
    AUD: "AU\\$|AUD|A\\$|\\$",
  };
  const escaped = symbols[currency];
  if (!escaped) return false;
  const re = new RegExp(
    `(?:${escaped})\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\\.[0-9]{1,2})?)\\s*(?:${escaped})`,
    "gi",
  );
  return [...normalize(evidence).matchAll(re)].some(
    (match) =>
      Math.round(Number((match[1] || match[2]).replace(/,/g, "")) * 100) ===
      Math.round(price * 100),
  );
}

export function groundedOffers(
  raw: unknown,
  sources: SourcePage[],
  goal: Goal,
  personaId: string,
): Offer[] {
  const parsed = extractedSchema.parse(raw);
  return parsed.offers.flatMap((item) => {
    const source = sources[item.sourceIndex];
    if (
      !source ||
      !item.exactMatch ||
      !item.currentPublicPrice ||
      item.condition !== "new" ||
      item.currency !== goal.currency ||
      !productMatches(goal, item.title) ||
      !productMatches(goal, `${source.title} ${source.content}`) ||
      !normalize(source.content).includes(normalize(item.evidence)) ||
      !evidenceContainsPrice(item.evidence, item.price, item.currency) ||
      /\b(refurbished|pre-owned|renewed|per month|monthly|installment|was\s+[$£]|used condition)\b/i.test(
        item.evidence,
      )
    )
      return [];
    let url: string;
    try {
      url = publicProductUrl(source.url);
    } catch {
      return [];
    }
    return [
      {
        id: randomBytes(8).toString("hex"),
        merchant: new URL(url).hostname.replace(/^www\./, ""),
        title: item.title,
        url,
        price: item.price,
        currency: item.currency,
        shipping: null,
        stock: "unknown" as const,
        evidence: item.evidence,
        observedAt: source.fetchedAt,
        personaId,
        match: "exact" as const,
      },
    ];
  });
}
