# Priceless

A private shopping research app. Preserve an exact shopping goal, give independent research workers synthetic shopping styles, and compare prices supported by retrieved source text.

## Run locally

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3210**. The labeled example works without credentials and makes no merchant or inference requests. It contains fictional stores and illustrative prices.

For local live research, copy `.env.example` to `.env` and set `TINFOIL_API_KEY` **locally**. Do not paste a key into chat or commit it. The server verifies Tinfoil inference and search enclaves before using them. Local development binds to loopback.

```sh
npm run verify
```

The project includes a local Node 24 runtime to satisfy the pinned Tinfoil SDK's engine requirement. npm scripts use it automatically.

## What is implemented

- Two starting boxes: **Paste a link** or **State a goal**. For flights and open-ended shopping requests, guided search starts with the details available and asks for missing details in the same conversation. Exact products still go through review before price comparison.
- Flight searches surface public schedule and route references. Use the fare provider to verify availability and current prices.
- Responsive comparison results, source excerpts, activity, cancellation, and clearing. Market and private price ceiling are under Shopping options.
- A private budget filter that stays in browser memory and never enters a task or model prompt.
- An immutable, hashed goal and independently seeded synthetic contexts, including a neutral control.
- Fresh child processes for each worker. No inherited API keys, personal browser state, user history, arbitrary code execution, or write-capable shopping tools.
- Tinfoil's official attested JavaScript SDK for inference and its confidential search/page-fetch MCP service. Both search safety filters are explicitly enabled; missing PII-check confirmation fails closed.
- Excerpt and numeric-price checks, exact product/variant checks, matching currencies, and exclusion of used items and installments. Shipping and tax remain unknown.
- Run-specific capability tokens, workspace access restriction, no application database or analytics, and 15-minute in-memory result expiration.
- Browser-to-enclave encrypted requests in deployment; verification failure never falls back to plaintext remote requests.
- Owner-signed, attested in-memory credential provisioning. API keys need not enter Tinfoil-managed secret storage.
- Docker packaging and measured Tinfoil release workflows.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). No remote deployment has been made by merely running or building this repository.

## Privacy and interpretation

See [docs/PRIVACY.md](docs/PRIVACY.md) for data flows, trust assumptions, retention, and limits.

This version uses **disposable research processes inside an application enclave**, not a separate Bunker VM per worker. It retrieves public listings through Tinfoil's search provider. Synthetic styles vary search phrasing; they do not create fake merchant accounts, invent historical browsing profiles, or spoof device fingerprints.

The comparison is a set of source-backed **observations**, not proof of a universally fair price or evidence that a merchant personalized its price. Retrieved content may be cached. A merchant may show a different price at checkout, where shipping, tax, stock, membership, and identity can matter. The app does not make purchases.

## Layout

| Path | Purpose |
| --- | --- |
| `web/` | React interface, local-only budget, verified transport, labeled sample |
| `server/privacy.ts` | Strict task boundary, goal integrity, independent personas, URL policy |
| `server/intake.ts` | Strict link/goal intake and source-supported draft validation |
| `server/guide.ts`, `server/guide-store.ts` | Guided flight and shopping research, follow-ups, and temporary sessions |
| `server/worker.ts` | Disposable worker's fixed research workflow |
| `server/runner.ts` | Worker process lifecycle and broker-only tools |
| `server/tinfoil.ts` | Attested inference and MCP search/fetch integration |
| `server/evidence.ts` | Source-grounding and product-match checks |
| `server/provisioning.ts` | Owner signatures and replay-resistant bootstrap |
| `scripts/` | Deployment setup, measured config rendering, private provisioning |
| `tests/` | Privacy boundaries, forged evidence, goal integrity, worker lifecycle |

## Next capability

Full browser shopping can be implemented with Bunkers and a Perimeter without changing the goal/persona boundary. That adds live-page and cart checks, but needs separate controls for browser fingerprints, merchant cookies, account linkage, and session-bound prices. A reboot is insufficient disposal: a Bunker's workspace must also be deleted.
