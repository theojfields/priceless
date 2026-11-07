import { z } from "zod";
import { containsIdentifier, createGoal, publicProductUrl } from "./privacy.js";

export const intakeInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("link"),
      text: z.string().trim().min(8).max(1500),
      country: z.enum(["US", "GB", "CA", "AU"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("goal"),
      text: z
        .string()
        .trim()
        .min(2)
        .max(500)
        .refine(
          (text) => !containsIdentifier(text),
          "Describe the product without personal details.",
        ),
      country: z.enum(["US", "GB", "CA", "AU"]),
    })
    .strict(),
]);
export type Intake = z.infer<typeof intakeInput>;
export interface GoalDraft {
  product: string;
  variant: string;
  country: Intake["country"];
  sourceUrls: string[];
}
export type IntakeResult = { draft: GoalDraft } | { clarification: string };

// Model output cannot silently replace the submitted product. The shopper reviews
// this draft before it becomes the immutable worker goal.
export function validateDraft(
  input: Intake,
  output: unknown,
  source: string,
): IntakeResult {
  const parsed = z
    .object({ product: z.string().max(160), variant: z.string().max(100) })
    .safeParse(output);
  if (!parsed.success || parsed.data.product.trim().length < 2)
    return {
      clarification:
        "Which product or model should we compare? Add its name so every agent searches for the same item.",
    };
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalized = normalize(source);
  const supported = `${parsed.data.product} ${parsed.data.variant}`
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => normalized.includes(normalize(token)));
  if (!supported)
    return {
      clarification:
        "We could not confirm the exact product. State its product name or model in the goal box.",
    };
  const goal = createGoal({
    ...parsed.data,
    country: input.country,
    sourceUrls: input.kind === "link" ? [publicProductUrl(input.text)] : [],
  });
  return {
    draft: {
      product: goal.product,
      variant: goal.variant,
      country: goal.country,
      sourceUrls: goal.sourceUrls,
    },
  };
}
