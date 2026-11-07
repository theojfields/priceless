import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  createGoal,
  createPersona,
  assertGoal,
  publicProductUrl,
  taskInput,
} from "../server/privacy.js";
import { evidenceContainsPrice, groundedOffers } from "../server/evidence.js";
import { Provisioning, provisioningMessage } from "../server/provisioning.js";

const input = {
  product: "Sony WH-1000XM5",
  variant: "Black",
  country: "US",
  sourceUrls: [],
};
test("the task boundary rejects profiles, budgets, and unknown fields", () => {
  assert.equal(taskInput.safeParse(input).success, true);
  for (const privateField of [
    { budget: 300 },
    { userProfile: { income: 100000 } },
    { email: "person@example.org" },
  ]) {
    assert.equal(
      taskInput.safeParse({ ...input, ...privateField }).success,
      false,
    );
  }
  assert.equal(
    taskInput.safeParse({ ...input, product: "Send to person@example.org" })
      .success,
    false,
  );
  assert.equal(
    taskInput.safeParse({ ...input, variant: "123 Main Street" }).success,
    false,
  );
});
test("synthetic context is reproducible from its independent seed", () => {
  for (const kind of ["neutral", "comparison", "deliberate"] as const) {
    const persona = createPersona(kind, "independent-seed");
    assert.deepEqual(persona, createPersona(kind, "independent-seed"));
    assert.notEqual(persona.id, createPersona(kind, "another-seed").id);
    assert.equal(JSON.stringify(persona).includes("person@example.org"), false);
  }
});
test("the goal is immutable, hash checked, and excludes private fields", () => {
  const goal = createGoal(input);
  assert.doesNotThrow(() => assertGoal(goal));
  assert.throws(() => assertGoal({ ...goal, product: "Another product" }));
  assert.throws(() => {
    goal.product = "Another product";
  });
  assert.equal("budget" in goal, false);
});
test("public URLs reject private destinations and strip identifying tracking parameters", () => {
  for (const url of [
    "http://shop.com/item",
    "https://127.0.0.1/item",
    "https://[::1]/",
    "https://localhost/item",
    "https://thing.internal/item",
    "https://user:pass@shop.com/item",
    "https://shop.com:8443/item",
    "https://shop.com/person@example.org",
  ]) {
    assert.throws(() => publicProductUrl(url), url);
  }
  assert.equal(
    publicProductUrl(
      "https://shop.com/item?utm_source=email&email=private&variant=black#personal",
    ),
    "https://shop.com/item?variant=black",
  );
});
test("currency evidence must contain the actual numeric price", () => {
  assert.equal(
    evidenceContainsPrice("Current price: $269.99", 269.99, "USD"),
    true,
  );
  assert.equal(evidenceContainsPrice("GBP 1,299.00", 1299, "GBP"), true);
  assert.equal(evidenceContainsPrice("£269.99", 269.99, "USD"), false);
  assert.equal(evidenceContainsPrice("$269.99", 26.99, "USD"), false);
});
test("prices require an exact source excerpt, exact product, matching currency, and new condition", () => {
  const goal = createGoal(input);
  const sources = [
    {
      url: "https://shop.com/headphones",
      title: "Sony WH-1000XM5 Black",
      content: "Sony WH-1000XM5 Black. New. Current public price $269.99.",
      fetchedAt: new Date().toISOString(),
    },
  ];
  const offer = {
    sourceIndex: 0,
    title: sources[0].title,
    price: 269.99,
    currency: "USD",
    evidence: "Current public price $269.99.",
    exactMatch: true,
    currentPublicPrice: true,
    condition: "new",
  };
  assert.equal(
    groundedOffers({ offers: [offer] }, sources, goal, "worker").length,
    1,
  );
  for (const mutation of [
    { evidence: "Fabricated price $269.99." },
    { price: 169.99 },
    { currency: "CAD" },
    { title: "Sony WH-1000XM4 Black" },
    { title: "Sony WH-1000XM5 Silver" },
    { condition: "used" },
    { sourceIndex: 7 },
    { currentPublicPrice: false },
  ]) {
    assert.equal(
      groundedOffers(
        { offers: [{ ...offer, ...mutation }] },
        sources,
        goal,
        "worker",
      ).length,
      0,
    );
  }
  const installment = {
    ...sources[0],
    content: "Pay $269.99 monthly for the Sony WH-1000XM5 Black.",
  };
  assert.equal(
    groundedOffers(
      { offers: [{ ...offer, evidence: installment.content }] },
      [installment],
      goal,
      "worker",
    ).length,
    0,
  );
});
test("only the pinned owner can provision, signatures bind secrets, and challenges cannot replay", () => {
  const owner = generateKeyPairSync("ed25519");
  const attacker = generateKeyPairSync("ed25519");
  const provisioning = new Provisioning(
    owner.publicKey.export({ type: "spki", format: "pem" }).toString(),
  );
  const payload = {
    nonce: provisioning.challenge(),
    apiKey: "private-test-key",
    accessToken: "a".repeat(64),
  };
  const signature = sign(
    null,
    provisioningMessage(payload),
    owner.privateKey,
  ).toString("base64");
  assert.equal(provisioning.accept({ ...payload, signature }), true);
  assert.equal(provisioning.accept({ ...payload, signature }), false);
  const other = { ...payload, nonce: provisioning.challenge() };
  assert.equal(
    provisioning.accept({
      ...other,
      signature: sign(
        null,
        provisioningMessage(other),
        attacker.privateKey,
      ).toString("base64"),
    }),
    false,
  );
  const tampered = { ...payload, nonce: provisioning.challenge() };
  const signed = sign(
    null,
    provisioningMessage(tampered),
    owner.privateKey,
  ).toString("base64");
  assert.equal(
    provisioning.accept({
      ...tampered,
      apiKey: "attacker-substitution",
      signature: signed,
    }),
    false,
  );
});
