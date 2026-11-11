# Privacy boundary and threat model

Priceless minimizes user information rather than promising absolute anonymity. It separates the shopping goal, synthetic context, private budget, service credentials, and external observations.

## Data flow

```text
Browser: public product link OR shopping goal and follow-ups + selected market
          | verified encrypted body in remote use
          v
Confidential intake: interpret the goal or read the linked page
          | guided goals: search public sources using selected terms
          |               and ask for details in the same session
          |
          | shopper reviews and edits draft before any comparison workers launch
          v
Controller inside Tinfoil: immutable goal + independent persona seeds
          | broker-only requests; API keys stay in the controller
          v
Fresh worker processes --> attested Tinfoil search / page fetch / inference
                                      |
                                      v
                         External search provider receives product queries
                         and public source URLs; source content returns

Browser budget --------------------------------> local result filter only
```

The persona generator receives only its kind and an independent random seed. It cannot read the goal, browser profile, account, user records, or conversation. Its output is a synthetic shopping style without a fabricated identity.

The controller accepts a strict task schema. Unknown fields—including budgets and user profiles—are rejected. Basic email, phone, and street-address checks reduce accidental identifiers in product fields; these checks are **not comprehensive PII detection**. Enter only product requirements. The goal itself reveals purchase intent.

## What leaves the device

| Data | Recipient |
| --- | --- |
| Entered link, goal text and follow-ups, reviewed product, variant, selected market | Verified application enclave |
| Goal text, follow-ups, or retrieved linked page during interpretation | Tinfoil inference enclave |
| Selected product or trip search terms and source URLs | Tinfoil search enclave and its external provider |
| Goal, synthetic style, source text | Tinfoil inference enclave |
| Dedicated private price ceiling field | No external recipient; browser memory only |
| Workspace access code and per-run capability | Application enclave, inside encrypted bodies |
| Inference API key | Application enclave via signed provisioning, then attested Tinfoil provider requests |
| IP, timing, byte counts, account/billing metadata | Infrastructure operators according to their policies |

The application's production egress is restricted to providers and verification dependencies. It has no arbitrary browsing, shell, account, purchase, or filesystem tools available to the model. A worker's predefined workflow can request discovery, page retrieval, and extraction, once each. The parent constructs those requests from its own authoritative goal and retrieved data, not worker-supplied arbitrary arguments.

Goal text and follow-ups go to confidential inference to identify the request and retain details across replies. The application builds public searches from selected terms, such as the route and travel date, rather than sending the full conversation to the search provider. Keep personal details out of the goal and replies; use the separate price ceiling field for a budget that must stay on the device. Public URLs have tracking parameters removed before page retrieval. Exact product intake uses details supported by the supplied text or fetched page, and comparison workers only start after the shopper confirms the draft. Opening a fare link shares the search terms in that link with the fare provider in the user's ordinary browser.

## Retention and disposal

- Forms, budget, access code, and results exist in browser memory; the app uses no cookies, localStorage, IndexedDB, analytics, or service worker.
- Search records, including guided search messages and result capabilities, exist in server memory for a maximum of 15 minutes. Clearing removes the record and aborts active work. Reloading the browser loses its capability; server expiration still applies.
- Each worker is a new process with a minimal environment and ignored standard streams. Its broker closes after the process exits.
- The app has no database, volumes, prompt logging, raw exception logging, or search-history endpoint.
- Runtime provisioning secrets are lost when the enclave restarts. The owner key and workspace code remain on the trusted local machine in ignored private files.
- Tinfoil retains operational metadata. Temporary encrypted inference caches may outlive the task; each worker gets an independent cache-scoping secret. Search-provider retention is governed by Tinfoil's agreements, not by this application's memory cleanup.
- Releasing memory is not a claim of forensic zeroization. A worker process is not an independently attested Bunker VM.

## Threats this design reduces

Personal profile inheritance, accidental budget disclosure to a seller, cross-run result access, persistent shopping history, provider access to unencrypted inference content during normal confidential operation, exposed worker API keys, arbitrary model-driven actions, and unsupported price invention.

## Trust and limitations

1. **Client integrity:** Trust the installed/source-pinned client. A hosted frontend can be modified before it encrypts inputs; remote attestation alone cannot prevent that.
2. **Hardware and verification:** Confidential execution relies on the Tinfoil SDK, published code/releases, attestation roots, hardware/firmware, and their security assumptions. It is not protection against every side channel or compromise.
3. **External recipients:** Search providers see query text and URLs. A query can identify a user even without an account identifier. Tinfoil's PII filter is enabled, and missing confirmation fails the run, but detection is imperfect.
4. **Observed pricing:** This version compares retrieved public listings, which may be cached. It neither proves personalization nor establishes a universal fair price. Synthetic search styles do not spoof a browser fingerprint or create merchant history.
5. **Source reliability:** Exact excerpts support what a source says, not the source's honesty or live inventory. Numeric grounding is not an independent checkout verification.
6. **Merchant links:** Opening a source link uses the user's ordinary browser. The store can observe IP, login, cookies, fingerprint, location, and later payment/shipping information. No checkout or purchase action is automated.
7. **Privileged local actors:** A compromised client, owner private key, or application source/build can defeat the intended privacy. Protect the local private key and control release permissions.

## Relevant Tinfoil documentation

- [Security and privacy FAQ](https://tinfoil.sh/security-and-privacy-faq)
- [Confidential search MCP](https://docs.tinfoil.sh/guides/mcp-websearch)
- [JavaScript SDK](https://docs.tinfoil.sh/sdk/javascript-sdk)
- [Bunker lifecycle](https://docs.tinfoil.sh/bunkers/quickstart)
- [Container networking](https://docs.tinfoil.sh/containers/config-networking)
