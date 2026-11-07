import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ShoppingRun, RunEvent } from "../shared/types.js";
import { createGoal, createPersona } from "./privacy.js";
import { runDisposableWorker } from "./runner.js";
import { TinfoilBroker, type Broker } from "./tinfoil.js";
import type { Goal, Persona } from "../shared/types.js";

interface Record {
  run: ShoppingRun;
  key: string;
  abort: AbortController;
  timer: ReturnType<typeof setTimeout>;
  done?: Promise<void>;
}
const retentionMs = 15 * 60 * 1000;

export class RunStore {
  private records = new Map<string, Record>();
  constructor(
    private config: {
      apiKey?: string;
      model?: string;
      brokerFactory?: (
        goal: Goal,
        persona: Persona,
        signal: AbortSignal,
      ) => Broker;
    },
  ) {}
  get activeCount() {
    return [...this.records.values()].filter(
      (record) => record.run.status === "running",
    ).length;
  }
  create(input: unknown): { run: ShoppingRun; runKey: string } {
    if (!this.config.apiKey)
      throw new Error("Connect Tinfoil before starting a live search.");
    if (this.activeCount >= 2 || this.records.size >= 20)
      throw new Error(
        "The private workspace is busy. Clear a finished search or try again shortly.",
      );
    const goal = createGoal(input);
    const id = randomBytes(16).toString("hex");
    const key = randomBytes(32).toString("hex");
    const run: ShoppingRun = {
      id,
      mode: "live",
      status: "running",
      goal,
      personas: [
        createPersona("neutral"),
        createPersona("comparison"),
        createPersona("deliberate"),
      ],
      offers: [],
      events: [],
      sourceCount: 0,
      workersDisposed: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + retentionMs).toISOString(),
    };
    const record: Record = {
      run,
      key,
      abort: new AbortController(),
      timer: setTimeout(() => this.clear(id, key), retentionMs),
    };
    record.timer.unref();
    this.records.set(id, record);
    this.event(
      run,
      "goal",
      "Exact product, variant, market, and condition locked.",
    );
    this.event(
      run,
      "context",
      "Three independent shopping styles created. No personal profile attached.",
    );
    record.done = this.execute(record);
    return { run, runKey: key };
  }
  read(id: string, key: string): ShoppingRun | undefined {
    const record = this.records.get(id);
    if (!record || !safeEqual(record.key, key)) return undefined;
    return record.run;
  }
  async cancel(id: string, key: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record || !safeEqual(record.key, key)) return false;
    record.abort.abort();
    record.run.status = "cancelled";
    this.event(
      record.run,
      "cancelled",
      "Search stopped. Disposing active workers.",
    );
    await record.done;
    return true;
  }
  clear(id: string, key: string): boolean {
    const record = this.records.get(id);
    if (!record || !safeEqual(record.key, key)) return false;
    record.abort.abort();
    clearTimeout(record.timer);
    this.records.delete(id);
    record.run.offers = [];
    record.run.events = [];
    return true;
  }
  close() {
    for (const [id, record] of this.records) this.clear(id, record.key);
  }
  private event(run: ShoppingRun, stage: string, message: string) {
    run.events.push({
      id: run.events.length,
      stage,
      message,
      time: new Date().toISOString(),
    } satisfies RunEvent);
  }
  private async execute(record: Record) {
    const { run, abort } = record;
    let failures = 0;
    for (const persona of run.personas) {
      if (abort.signal.aborted) break;
      this.event(
        run,
        "search",
        `${persona.label} is finding public offers and checking source pages.`,
      );
      try {
        const broker =
          this.config.brokerFactory?.(run.goal, persona, abort.signal) ??
          new TinfoilBroker(
            run.goal,
            persona,
            abort.signal,
            this.config.apiKey!,
            this.config.model,
          );
        const result = await runDisposableWorker(
          run.goal,
          persona,
          broker,
          abort.signal,
          (count) => {
            this.event(
              run,
              "verify",
              `${persona.label} retrieved ${count} source pages for price checks.`,
            );
          },
        );
        if (!abort.signal.aborted) {
          run.offers.push(...result.offers);
          run.sourceCount += result.sourceCount;
        }
      } catch {
        failures++;
      }
      run.workersDisposed++;
      this.event(
        run,
        "disposal",
        `${persona.label} process ended; its local execution state was released.`,
      );
    }
    if (abort.signal.aborted) return;
    run.status = failures === run.personas.length ? "failed" : "complete";
    run.offers.sort((a, b) => a.price - b.price);
    if (failures)
      run.warning = `${failures} of ${run.personas.length} workers could not complete. Results may be incomplete.`;
    if (!run.offers.length && !run.warning)
      run.warning =
        "No exact-match prices met the source evidence requirements. Try a more specific model or add a store link.";
    this.event(
      run,
      "complete",
      run.offers.length
        ? "Source-backed offers ready. All launched workers have ended."
        : "Source checks finished without a supported exact-match offer.",
    );
  }
}

export function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
