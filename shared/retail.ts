import type { Goal, Offer } from "./types.js";

// A conservative list of first-party stores. An unfamiliar seller can be
// shown for inspection, but a domain alone cannot vouch for a marketplace listing.
const knownStores: Record<Goal["country"], string[]> = {
  US: ["apple.com", "bestbuy.com", "bhphotovideo.com", "costco.com", "homedepot.com",
    "lowes.com", "microcenter.com", "rei.com", "sony.com"],
  GB: ["apple.com", "currys.co.uk", "johnlewis.com", "richersounds.com", "sony.co.uk"],
  CA: ["apple.com", "bestbuy.ca", "canadacomputers.com", "costco.ca", "visions.ca"],
  AU: ["apple.com", "jbhifi.com.au", "thegoodguys.com.au", "sony.com.au"],
};

export function knownRetailSeller(offer: Pick<Offer, "url" | "evidence">, country: Goal["country"]) {
  try {
    const parsed = new URL(offer.url);
    const domain = parsed.hostname.replace(/^(?:www|electronics)\./, "");
    if (parsed.protocol !== "https:" || !knownStores[country].includes(domain)) return false;
    if (domain === "bestbuy.com" || domain === "bestbuy.ca") {
      return /(?:^|[.\n])\s*sold(?:\s*(?:&|and)\s*shipped)?\s+by\s+best buy\s*(?:[.\n]|$)/i.test(offer.evidence ?? "");
    }
    return true;
  } catch {
    return false;
  }
}

export function bestRetailOffer(offers: readonly Offer[], goal: Goal): Offer | undefined {
  return offers.reduce<Offer | undefined>((best, item) =>
    item.currency === goal.currency && knownRetailSeller(item, goal.country) &&
    (!best || item.price < best.price) ? item : best, undefined);
}
