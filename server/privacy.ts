import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import type { Goal, Persona, PersonaKind } from "../shared/types.js";

const productText = z
  .string()
  .trim()
  .min(2)
  .max(160)
  .refine(
    (value) => !containsIdentifier(value),
    "Use a product name or model, without email addresses, phone numbers, or personal details.",
  );
export const taskInput = z
  .object({
    product: productText,
    variant: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => !containsIdentifier(value),
        "Remove personal details from the variant.",
      ),
    country: z.enum(["US", "GB", "CA", "AU"]),
    sourceUrls: z.array(z.string().max(1500)).max(4).default([]),
  })
  .strict();

export function containsIdentifier(value: string): boolean {
  return (
    /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) ||
    /(?:\+\d{1,3}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/.test(value) ||
    /\b\d{1,5}\s+[\w\s]{2,40}\s(?:street|avenue|road|lane|drive|boulevard)\b/i.test(
      value,
    )
  );
}

export function publicProductUrl(input: string): string {
  const url = new URL(input);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    isIP(host.replace(/^\[|\]$/g, "")) ||
    !host.includes(".") ||
    /(?:^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(
      host,
    ) ||
    /[\u0000-\u0020]/.test(input) ||
    containsIdentifier(decodeURIComponent(url.pathname))
  ) {
    throw new Error(
      "Use a public HTTPS product link without personal information.",
    );
  }
  const allowed = new URLSearchParams();
  for (const key of ["sku", "pid", "variant", "id"]) {
    const value = url.searchParams.get(key);
    if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) allowed.set(key, value);
  }
  url.search = allowed.toString();
  url.hash = "";
  return url.toString();
}

export function createGoal(input: unknown): Goal {
  const parsed = taskInput.parse(input);
  const currencies = { US: "USD", GB: "GBP", CA: "CAD", AU: "AUD" } as const;
  const body = {
    id: randomBytes(12).toString("hex"),
    product: parsed.product,
    variant: parsed.variant,
    country: parsed.country,
    currency: currencies[parsed.country],
    condition: "new" as const,
    sourceUrls: parsed.sourceUrls.map(publicProductUrl),
  };
  return Object.freeze({
    ...body,
    sourceUrls: Object.freeze(body.sourceUrls) as unknown as string[],
    digest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  });
}

// This function accepts no goal, user profile, or conversation. The seed is independent.
export function createPersona(
  kind: PersonaKind,
  seed = randomBytes(24).toString("hex"),
): Persona {
  const n = createHash("sha256").update(seed).digest().readUInt32BE();
  const descriptions = {
    neutral: [
      "A fresh shopper looking for the exact product at its public price.",
    ],
    comparison: [
      "A patient shopper who compares retailers before choosing.",
      "A practical shopper who checks public sale prices across stores.",
    ],
    deliberate: [
      "A careful shopper who checks the exact model, condition, and seller.",
      "A methodical shopper who values a clear, itemized offer.",
    ],
  };
  const description = descriptions[kind][n % descriptions[kind].length];
  return {
    id: createHash("sha256")
      .update(seed + kind)
      .digest("hex")
      .slice(0, 12),
    kind,
    label: {
      neutral: "Fresh start",
      comparison: "Comparison shopper",
      deliberate: "Careful researcher",
    }[kind],
    description,
    backstory: `${description} This is a synthetic shopping style, with no name, age, income, address, account, or personal history.`,
    querySuffix: {
      neutral: "buy new current price",
      comparison: "new sale price retailers",
      deliberate: "new exact model retail price",
    }[kind],
    color: { neutral: "green", comparison: "purple", deliberate: "orange" }[
      kind
    ],
  };
}

export function assertGoal(goal: Goal): void {
  const { digest, ...body } = goal;
  if (
    createHash("sha256").update(JSON.stringify(body)).digest("hex") !== digest
  )
    throw new Error("The shopping goal changed.");
}

export function productMatches(goal: Goal, title: string): boolean {
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized = normalize(title);
  return `${goal.product} ${goal.variant}`
    .split(/\s+/)
    .filter((v) => v.length > 1)
    .every((word) => normalized.includes(normalize(word)));
}
