import { randomBytes } from "node:crypto";
import type { GuidedSearch } from "../shared/types.js";
import { type FlightRequest, type GuideContext, type GuideResearchPlan, guideSources, guideStart, guideText } from "./guide.js";
import type { FlightLookup } from "./flights.js";
import { safeEqual } from "./runs.js";

interface GuideRecord {
  state: GuidedSearch;
  key: string;
  context: GuideContext;
  flight?: FlightRequest;
  abort?: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

export interface GuideProvider {
  plan(context: GuideContext, signal: AbortSignal): Promise<GuideResearchPlan>;
  search(query: string, country: GuideContext["country"], signal: AbortSignal): Promise<unknown>;
  fares?(request: FlightRequest, signal: AbortSignal): Promise<FlightLookup>;
}

export class GuideStore {
  private records = new Map<string, GuideRecord>();

  constructor(private provider: GuideProvider, private retentionMs = 15 * 60_000) {}

  create(input: unknown): { guide: GuidedSearch; runKey: string } {
    const { text, country, today } = guideStart.parse(input);
    this.checkCapacity();
    if (this.records.size >= 20) throw new Error("The private workspace is busy. Clear a finished search and try again.");
    const id = randomBytes(16).toString("hex"), key = randomBytes(32).toString("hex");
    const state: GuidedSearch = {
      id, revision: 0, status: "planning", turns: [], sources: [],
      expiresAt: new Date(Date.now() + this.retentionMs).toISOString(),
    };
    const timer = setTimeout(() => this.clear(id, key), this.retentionMs);
    timer.unref();
    const record: GuideRecord = { state, key, context: { country, today, turns: [] }, timer };
    this.records.set(id, record);
    this.revise(record, text);
    return { guide: record.state, runKey: key };
  }

  read(id: string, key: string) { return this.get(id, key)?.state; }

  reply(id: string, key: string, text: unknown) {
    const record = this.get(id, key);
    if (!record) return;
    if (record.context.turns.length >= 6) throw new Error("This search has reached its follow-up limit. Start a new search to continue.");
    const reply = guideText.parse(text);
    this.checkCapacity(record);
    this.revise(record, reply);
    return record.state;
  }

  checkFares(id: string, key: string, revision: number) {
    const record = this.get(id, key);
    if (!record || record.state.revision !== revision) return;
    if (!record.flight || !this.provider.fares || record.state.status === "searching") return record.state;
    this.checkCapacity(record);
    record.abort?.abort();
    const abort = new AbortController();
    record.abort = abort;
    record.state = { ...record.state, status: "searching", warning: undefined, fares: [] };
    void this.fetchFares(record, record.flight, abort.signal);
    return record.state;
  }

  cancel(id: string, key: string): boolean {
    const record = this.get(id, key);
    if (!record) return false;
    record.abort?.abort();
    record.state = { ...record.state, status: "cancelled" };
    return true;
  }

  clear(id: string, key: string): boolean {
    const record = this.get(id, key);
    if (!record) return false;
    record.abort?.abort();
    clearTimeout(record.timer);
    this.records.delete(id);
    return true;
  }

  close() { for (const [id, record] of this.records) this.clear(id, record.key); }

  private get(id: string, key: string) {
    const record = this.records.get(id);
    return record && safeEqual(record.key, key) ? record : undefined;
  }

  private checkCapacity(except?: GuideRecord) {
    const active = [...this.records.values()].filter((r) => r !== except && (r.state.status === "planning" || r.state.status === "searching")).length;
    if (active >= 2) throw new Error("The private workspace is busy. Try again when a search finishes.");
  }

  private revise(record: GuideRecord, text: string) {
    record.abort?.abort();
    const abort = new AbortController();
    record.abort = abort;
    const context = { ...record.context, turns: [...record.context.turns, text] };
    record.context = context;
    record.flight = undefined;
    record.state = {
      id: record.state.id, revision: record.state.revision + 1, expiresAt: record.state.expiresAt,
      status: "planning", turns: [...context.turns], sources: [],
    };
    void this.execute(record, context, abort.signal);
  }

  private async execute(record: GuideRecord, context: GuideContext, signal: AbortSignal) {
    try {
      const { plan, query, matches, flight } = await this.provider.plan(context, signal);
      if (signal.aborted) return;
      record.flight = flight;
      // Publish the question before awaiting source discovery so the shopper can
      // answer immediately. A reply invalidates every response from this revision.
      record.state = { ...record.state, plan, status: query ? "searching" : "ready" };
      if (!query) return;
      const raw = await this.provider.search(query, context.country, signal);
      if (signal.aborted) return;
      const sources = guideSources(raw, matches);
      record.state = {
        ...record.state, sources, status: "ready",
        warning: sources.length ? undefined : "No matching public sources were returned. You can refine the search below.",
      };
    } catch {
      if (signal.aborted) return;
      record.state = {
        ...record.state, status: "failed",
        warning: record.state.plan ? "The public source search couldn’t finish. Add a detail to try again." : "The goal couldn’t be interpreted right now. Try adding a detail below.",
      };
    }
  }

  private async fetchFares(record: GuideRecord, request: FlightRequest, signal: AbortSignal) {
    try {
      const { fares, question } = await this.provider.fares!(request, signal);
      if (signal.aborted) return;
      const plan = record.state.plan!;
      record.state = {
        ...record.state, status: "ready", fares,
        plan: question ? { ...plan, question, canCheckFares: false } : plan,
        warning: fares.length || question ? undefined : "No airline-direct fare matched all these details in the provider results. Check on Google Flights or change a detail.",
      };
      if (question) record.flight = undefined;
    } catch {
      if (signal.aborted) return;
      record.state = {
        ...record.state, status: "failed",
        warning: "Live fares couldn’t be checked. Try again or open Google Flights.",
      };
    }
  }
}
