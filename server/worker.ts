import type { Goal, Persona, SourcePage } from "../shared/types.js";
import { assertGoal } from "./privacy.js";
import { groundedOffers } from "./evidence.js";

let nextId = 0;
const pending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();
function rpc(method: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    process.send?.({ type: "rpc", id, method, payload });
  });
}

process.on("message", async (message: any) => {
  if (message.type === "response") {
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item?.reject(new Error(message.error));
    else item?.resolve(message.value);
    return;
  }
  if (message.type !== "start") return;
  const goal = message.goal as Goal;
  const persona = message.persona as Persona;
  try {
    assertGoal(goal);
    const query =
      `${goal.product} ${goal.variant} ${persona.querySuffix}`.slice(0, 390);
    const hits = (await rpc("search", {
      query,
      country: goal.country,
    })) as SourcePage[];
    assertGoal(goal);
    const urls = [
      ...new Set([...goal.sourceUrls, ...hits.map((hit) => hit.url)]),
    ].slice(0, 5);
    const pages = (await rpc("fetch", { urls })) as SourcePage[];
    // Search snippets are discovery only. A source must have been fetched to support a price.
    const sources = pages.filter((page) => page.content.length > 20);
    process.send?.({ type: "progress", sources: sources.length });
    assertGoal(goal);
    const extracted = sources.length
      ? await rpc("extract", { sources, persona })
      : { offers: [] };
    const offers = groundedOffers(extracted, sources, goal, persona.id);
    assertGoal(goal);
    process.send?.({
      type: "result",
      offers,
      sourceCount: sources.length,
      goalDigest: goal.digest,
    });
  } catch {
    process.send?.({
      type: "failure",
      error:
        "This worker could not finish its source checks. No unsupported prices were added.",
    });
  } finally {
    pending.clear();
    process.disconnect();
  }
});
