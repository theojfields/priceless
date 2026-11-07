import { fork } from "node:child_process";
import type { Goal, Offer, Persona } from "../shared/types.js";
import type { Broker } from "./tinfoil.js";

export interface WorkerResult {
  offers: Offer[];
  sourceCount: number;
}
export function runDisposableWorker(
  goal: Goal,
  persona: Persona,
  broker: Broker,
  signal: AbortSignal,
  onProgress: (count: number) => void,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = fork(
      new URL(
        import.meta.url.endsWith(".ts") ? "./worker.ts" : "./worker.js",
        import.meta.url,
      ),
      [],
      {
        env: { NODE_ENV: process.env.NODE_ENV ?? "development", TZ: "UTC" },
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        serialization: "json",
      },
    );
    let result: WorkerResult | undefined;
    let failure: Error | undefined;
    let terminating = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      if (terminating) return;
      terminating = true;
      worker.kill("SIGTERM");
      killTimer = setTimeout(() => worker.kill("SIGKILL"), 2000);
      killTimer.unref();
    };
    const abort = () => {
      failure = new Error("Run cancelled.");
      terminate();
    };
    const timer = setTimeout(() => {
      failure = new Error("Worker time limit reached.");
      terminate();
    }, 180000);
    timer.unref();
    signal.addEventListener("abort", abort, { once: true });
    worker.on("message", async (message: any) => {
      if (message.type === "rpc") {
        try {
          const value = await broker.call(message.method);
          if (worker.connected)
            worker.send({ type: "response", id: message.id, value });
        } catch {
          if (worker.connected)
            worker.send({
              type: "response",
              id: message.id,
              error: "The private source check could not be completed.",
            });
        }
      } else if (message.type === "progress") {
        onProgress(Number(message.sources) || 0);
      } else if (message.type === "result") {
        if (message.goalDigest !== goal.digest) {
          failure = new Error("Goal integrity check failed.");
          terminate();
        } else
          result = { offers: message.offers, sourceCount: message.sourceCount };
      } else if (message.type === "failure") {
        failure = new Error("A research worker could not finish.");
      }
    });
    worker.once("error", (error) => {
      failure = error;
    });
    worker.once("exit", async () => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener("abort", abort);
      await broker.close();
      if (failure || !result)
        reject(failure ?? new Error("Worker ended without results."));
      else resolve(result);
    });
    if (signal.aborted) abort();
    else worker.send({ type: "start", goal, persona });
  });
}
