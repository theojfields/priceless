import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RunStore, safeEqual } from "./runs.js";
import type { AppConfig } from "../shared/types.js";
import { Provisioning } from "./provisioning.js";
import { findGuideSources, planGuidedGoal, prepareShoppingGoal } from "./tinfoil.js";
import { GuideStore } from "./guide-store.js";
import { guideText } from "./guide.js";
import { lookupFlightFares } from "./flights.js";

try {
  process.loadEnvFile(".env");
} catch {
  /* Environment configuration is optional in preview. */
}
const production = process.env.NODE_ENV === "production";
const host = process.env.HOST ?? (production ? "0.0.0.0" : "127.0.0.1");
const port = Number(process.env.PORT ?? 3210);
let appToken = process.env.PRICELESS_ACCESS_TOKEN;
if (production && !process.env.PRICELESS_OWNER_PUBLIC_KEY)
  throw new Error(
    "Production requires an owner public key for attested in-memory provisioning.",
  );
if (appToken && appToken.length < 32)
  throw new Error(
    "The workspace access code must have at least 32 characters.",
  );
if (
  production &&
  (!process.env.PRICELESS_ENCLAVE_URL || !process.env.PRICELESS_CONFIG_REPO)
)
  throw new Error(
    "Production requires the enclave URL and config repository for browser verification.",
  );
if (!production && !["127.0.0.1", "::1", "localhost"].includes(host))
  throw new Error(
    "Development must bind to loopback. Use production mode for a remote deployment.",
  );
const runtime = {
  apiKey: process.env.TINFOIL_API_KEY,
  flightApiKey: production ? undefined : process.env.SKYSCANNER_API_KEY,
  model: process.env.TINFOIL_MODEL ?? "gpt-oss-120b",
};
const store = new RunStore(runtime);
const guides = new GuideStore({
  plan: (context, signal) => planGuidedGoal(context, runtime.apiKey!, runtime.model, signal),
  search: (query, country, signal) => findGuideSources(query, country, runtime.apiKey!, signal),
  fares: (flight, signal) => lookupFlightFares(flight, runtime.flightApiKey!, signal),
});
let pendingIntakes = 0;
const provisioning = new Provisioning(
  process.env.PRICELESS_OWNER_PUBLIC_KEY?.replace(/\\n/g, "\n"),
);
const config: AppConfig = {
  liveConfigured: !!runtime.apiKey,
  enclaveURL: process.env.PRICELESS_ENCLAVE_URL ?? null,
  configRepo: process.env.PRICELESS_CONFIG_REPO ?? null,
  accessRequired: production || !!appToken,
  retentionMinutes: 15,
  execution: "ephemeral-processes",
};
const runCredentials = z.object({
  runId: z.string().regex(/^[a-f0-9]{32}$/),
  runKey: z.string().regex(/^[a-f0-9]{64}$/),
});
const clientDirectory = resolve(
  fileURLToPath(new URL("../../client", import.meta.url)),
);
const vite = !production
  ? await (
      await import("vite")
    ).createServer({
      configFile: resolve("vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    })
  : null;

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}
async function body(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON required.");
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new Error("Request too large.");
    chunks.push(chunk);
  }
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  response.setHeader("X-Frame-Options", "DENY");
  if (production)
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
    if (
      !production &&
      !["127.0.0.1", "localhost", "[::1]"].includes(
        new URL(`http://${request.headers.host}`).hostname,
      )
    ) {
      return json(response, 403, {
        error: "Local development accepts only loopback hosts.",
      });
    }
    if (request.method === "GET" && path === "/health")
      return json(response, 200, { status: "ok" });
    if (request.method === "GET" && path === "/api/config")
      return json(response, 200, {
        ...config,
        liveConfigured: !!runtime.apiKey,
        flightFaresConfigured: !!runtime.flightApiKey,
      });
    if (path.startsWith("/api/")) {
      const origin = request.headers.origin;
      const expectedOrigin = process.env.PRICELESS_ENCLAVE_URL
        ? new URL(process.env.PRICELESS_ENCLAVE_URL).origin
        : `http://${request.headers.host}`;
      const allowedOrigins = new Set([
        expectedOrigin,
        ...(process.env.PRICELESS_CLIENT_ORIGINS?.split(",").filter(Boolean) ??
          []),
      ]);
      if (origin && !allowedOrigins.has(origin))
        return json(response, 403, { error: "Origin not allowed." });
      if (origin) {
        response.setHeader("Access-Control-Allow-Origin", origin);
        response.setHeader("Vary", "Origin");
      }
      if (request.method === "OPTIONS") {
        response.setHeader("Access-Control-Allow-Methods", "POST");
        response.setHeader("Access-Control-Allow-Headers", "Content-Type");
        response.writeHead(204);
        response.end();
        return;
      }
      if (request.method !== "POST")
        return json(response, 405, { error: "Use an encrypted POST request." });
      const input = await body(request);
      if (path === "/api/provision/challenge")
        return json(response, 200, { nonce: provisioning.challenge() });
      if (path === "/api/provision/complete") {
        const provision = z
          .object({
            nonce: z.string().regex(/^[a-f0-9]{64}$/),
            apiKey: z.string().min(8).max(1000),
            flightApiKey: z.string().min(8).max(1000).optional(),
            accessToken: z.string().min(32).max(128),
            signature: z.string().max(256),
          })
          .strict()
          .parse(input);
        if (!provisioning.accept(provision))
          return json(response, 403, { error: "Owner signature rejected." });
        store.close();
        guides.close();
        runtime.apiKey = provision.apiKey;
        runtime.flightApiKey = provision.flightApiKey;
        appToken = provision.accessToken;
        return json(response, 200, { ok: true });
      }
      if (production && !appToken)
        return json(response, 503, {
          error:
            "The private workspace is locked until its owner provisions it.",
        });
      if (
        appToken &&
        (typeof input.accessToken !== "string" ||
          !safeEqual(input.accessToken, appToken))
      )
        return json(response, 401, {
          error: "Enter your private workspace access code.",
        });
      delete input.accessToken;
      if (path === "/api/runs/guide-start") {
        if (!runtime.apiKey) return json(response, 503, { error: "Connect Tinfoil before starting a guided search." });
        return json(response, 201, guides.create(input));
      }
      if (path === "/api/runs/guide-reply") {
        const { runId, runKey, text } = runCredentials.extend({ text: guideText }).strict().parse(input);
        const guide = guides.reply(runId, runKey, text);
        return json(response, guide ? 200 : 404, guide ? { guide } : { error: "This search has expired or was cleared." });
      }
      if (path === "/api/runs/guide-fares") {
        if (!runtime.flightApiKey) return json(response, 503, { error: "Live flight fares are not enabled for this workspace." });
        const { runId, runKey, revision } = runCredentials.extend({ revision: z.number().int().positive() }).strict().parse(input);
        const guide = guides.checkFares(runId, runKey, revision);
        return json(response, guide ? 200 : 404, guide ? { guide } : { error: "This search has changed, expired or was cleared." });
      }
      if (path === "/api/runs/guide-read" || path === "/api/runs/guide-cancel" || path === "/api/runs/guide-clear") {
        const { runId, runKey } = runCredentials.strict().parse(input);
        const action = path.endsWith("-read") ? guides.read(runId, runKey) : path.endsWith("-cancel") ? guides.cancel(runId, runKey) : guides.clear(runId, runKey);
        return json(response, action ? 200 : 404, action ? (typeof action === "boolean" ? { ok: true } : { guide: action }) : { error: "This search has expired or was cleared." });
      }
      if (path === "/api/runs/prepare") {
        if (!runtime.apiKey)
          return json(response, 503, {
            error: "Connect Tinfoil before preparing a shopping goal.",
          });
        if (pendingIntakes >= 2)
          return json(response, 429, {
            error: "The private workspace is busy. Try again shortly.",
          });
        pendingIntakes++;
        try {
          return json(
            response,
            200,
            await prepareShoppingGoal(input, runtime.apiKey, runtime.model),
          );
        } finally {
          pendingIntakes--;
        }
      }
      if (path === "/api/runs/create") {
        if (!runtime.apiKey)
          return json(response, 503, {
            error:
              "Tinfoil is not connected. The example is available without sending a shopping request.",
          });
        return json(response, 201, store.create(input));
      }
      const credentials = runCredentials.strict().parse(input);
      if (path === "/api/runs/read") {
        const run = store.read(credentials.runId, credentials.runKey);
        return json(
          response,
          run ? 200 : 404,
          run ? { run } : { error: "This search has expired or was cleared." },
        );
      }
      if (path === "/api/runs/cancel")
        return json(
          response,
          (await store.cancel(credentials.runId, credentials.runKey))
            ? 200
            : 404,
          { ok: true },
        );
      if (path === "/api/runs/clear")
        return json(
          response,
          store.clear(credentials.runId, credentials.runKey) ? 200 : 404,
          { ok: true },
        );
      return json(response, 404, { error: "Unknown operation." });
    }
    if (vite)
      return vite.middlewares(request, response, () => {
        response.statusCode = 404;
        response.end();
      });
    if (request.method !== "GET" && request.method !== "HEAD")
      return json(response, 405, { error: "Method not allowed." });
    const asset = resolve(
      clientDirectory,
      "." + decodeURIComponent(path === "/" ? "/index.html" : path),
    );
    if (!asset.startsWith(clientDirectory + sep))
      return json(response, 404, { error: "Not found." });
    let file = asset;
    try {
      if (!(await stat(file)).isFile())
        file = resolve(clientDirectory, "index.html");
    } catch {
      file = resolve(clientDirectory, "index.html");
    }
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    response.setHeader(
      "Content-Type",
      types[extname(file)] ?? "application/octet-stream",
    );
    response.end(request.method === "HEAD" ? undefined : await readFile(file));
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues[0]?.message
        : error instanceof Error &&
            /Use a public|Connect Tinfoil|workspace is busy|follow-up limit|Request too large|JSON required/.test(
              error.message,
            )
          ? error.message
          : "This request could not be completed. No search data was logged.";
    json(response, 400, { error: message });
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(port, host, () =>
  console.log(`Priceless is ready at http://${host}:${port}`),
);
function shutdown() {
  store.close();
  guides.close();
  void vite?.close();
  server.close(() => process.exit(0));
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
