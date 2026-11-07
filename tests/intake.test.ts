import test from "node:test";
import assert from "node:assert/strict";
import { intakeInput, validateDraft } from "../server/intake.js";

test("a natural shopping request becomes a supported product draft without its budget", () => {
  const input = intakeInput.parse({
    kind: "goal",
    text: "Find Sony WH-1000XM5 in Black for less than $300",
    country: "US",
  });
  const result = validateDraft(
    input,
    { product: "Sony WH-1000XM5", variant: "Black" },
    input.text,
  );
  assert.deepEqual(result, {
    draft: {
      product: "Sony WH-1000XM5",
      variant: "Black",
      country: "US",
      sourceUrls: [],
    },
  });
  assert.equal(JSON.stringify(result).includes("300"), false);
});
test("link drafts retain only the cleaned public source, and unsupported model guesses need clarification", () => {
  const input = intakeInput.parse({
    kind: "link",
    text: "https://shop.com/headphones?utm_source=private&variant=black#account",
    country: "GB",
  });
  const source = "Sony WH-1000XM5 Black. New headphones.";
  const result = validateDraft(
    input,
    { product: "Sony WH-1000XM5", variant: "Black" },
    source,
  );
  assert.ok("draft" in result);
  assert.deepEqual(result.draft.sourceUrls, [
    "https://shop.com/headphones?variant=black",
  ]);
  assert.ok(
    "clarification" in
      validateDraft(
        input,
        { product: "Sony WH-1000XM6", variant: "Black" },
        source,
      ),
  );
  assert.ok(
    "clarification" in
      validateDraft(input, { product: "", variant: "" }, source),
  );
});
test("intake rejects profiles and recognizable personal details before provider calls", () => {
  const input = { kind: "goal", text: "Sony WH-1000XM5", country: "US" };
  assert.equal(
    intakeInput.safeParse({ ...input, profile: "private" }).success,
    false,
  );
  assert.equal(
    intakeInput.safeParse({
      ...input,
      text: "deliver Sony WH-1000XM5 to person@example.org",
    }).success,
    false,
  );
});
