export type PersonaKind = "neutral" | "comparison" | "deliberate";
export interface Persona {
  id: string;
  kind: PersonaKind;
  label: string;
  description: string;
  backstory: string;
  querySuffix: string;
  color: string;
}
export interface Goal {
  id: string;
  product: string;
  variant: string;
  country: "US" | "GB" | "CA" | "AU";
  currency: "USD" | "GBP" | "CAD" | "AUD";
  condition: "new";
  sourceUrls: string[];
  digest: string;
}
export interface SourcePage {
  url: string;
  title: string;
  content: string;
  fetchedAt: string;
}
export interface Offer {
  id: string;
  merchant: string;
  title: string;
  url: string;
  price: number;
  currency: string;
  shipping: number | null;
  stock: "in_stock" | "unknown";
  evidence: string;
  observedAt: string;
  personaId: string;
  match: "exact";
}
export interface RunEvent {
  id: number;
  stage: string;
  message: string;
  time: string;
}
export interface ShoppingRun {
  id: string;
  mode: "sample" | "live";
  status: "running" | "complete" | "cancelled" | "failed";
  goal: Goal;
  personas: Persona[];
  offers: Offer[];
  events: RunEvent[];
  sourceCount: number;
  workersDisposed: number;
  createdAt: string;
  expiresAt: string;
  warning?: string;
}
export interface AppConfig {
  liveConfigured: boolean;
  enclaveURL: string | null;
  configRepo: string | null;
  accessRequired: boolean;
  retentionMinutes: number;
  execution: "ephemeral-processes";
}

export interface ShoppingDraft {
  product: string;
  variant: string;
  country: Goal["country"];
  sourceUrls: string[];
}

export interface GuidePlan {
  kind: "flight" | "discovery" | "product";
  title: string;
  details: { label: string; value: string }[];
  question?: string;
  draft?: ShoppingDraft;
  flightSearchUrl?: string;
}

export interface GuideSource {
  title: string;
  url: string;
  domain: string;
  excerpt: string;
}

export interface GuidedSearch {
  id: string;
  revision: number;
  status: "planning" | "searching" | "ready" | "failed" | "cancelled";
  turns: string[];
  plan?: GuidePlan;
  sources: GuideSource[];
  expiresAt: string;
  warning?: string;
}
