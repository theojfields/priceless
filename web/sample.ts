import type { ShoppingRun } from "../shared/types";

export function exampleRun(): ShoppingRun {
  const time = new Date().toISOString();
  const personas = [
    {
      id: "sample-neutral",
      kind: "neutral" as const,
      label: "Fresh start",
      description: "A fresh shopper checking the public price.",
      backstory:
        "An illustrative neutral shopping style. No personal information.",
      querySuffix: "",
      color: "green",
    },
    {
      id: "sample-comparison",
      kind: "comparison" as const,
      label: "Comparison shopper",
      description: "A patient shopper comparing public offers.",
      backstory:
        "An illustrative patient comparison shopper. No personal information.",
      querySuffix: "",
      color: "purple",
    },
    {
      id: "sample-careful",
      kind: "deliberate" as const,
      label: "Careful researcher",
      description: "A careful shopper checking model and condition.",
      backstory:
        "An illustrative methodical researcher. No personal information.",
      querySuffix: "",
      color: "orange",
    },
  ];
  return {
    id: "sample",
    mode: "sample",
    status: "complete",
    goal: {
      id: "sample-goal",
      product: "Sony WH-1000XM5",
      variant: "Black",
      country: "US",
      currency: "USD",
      condition: "new",
      sourceUrls: [],
      digest: "illustrative-example",
    },
    personas,
    createdAt: time,
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    workersDisposed: 3,
    sourceCount: 3,
    offers: [
      {
        id: "sample-1",
        merchant: "Northline Audio",
        price: 269.99,
        personaId: "sample-comparison",
      },
      {
        id: "sample-2",
        merchant: "The Sound Room",
        price: 289.99,
        personaId: "sample-careful",
      },
      {
        id: "sample-3",
        merchant: "Everyday Electronics",
        price: 299.99,
        personaId: "sample-neutral",
      },
    ].map((offer) => ({
      ...offer,
      title: "Sony WH-1000XM5 Black",
      url: "https://example.com/" + offer.id,
      currency: "USD",
      shipping: null,
      stock: "unknown" as const,
      evidence: `ILLUSTRATIVE SAMPLE ONLY — Sony WH-1000XM5 Black, new. Public item price: $${offer.price}.`,
      observedAt: time,
      match: "exact" as const,
    })),
    events: [
      {
        id: 0,
        stage: "goal",
        message: "Example goal: Sony WH-1000XM5, black, new, US market.",
        time,
      },
      {
        id: 1,
        stage: "context",
        message:
          "Example styles: fresh start, comparison shopper, careful researcher.",
        time,
      },
      {
        id: 2,
        stage: "search",
        message:
          "In a live run, workers search through Tinfoil’s confidential search service.",
        time,
      },
      {
        id: 3,
        stage: "verify",
        message:
          "In a live run, price excerpts are matched against retrieved source text.",
        time,
      },
      {
        id: 4,
        stage: "complete",
        message: "This example used no workers and made no merchant requests.",
        time,
      },
    ],
  };
}
