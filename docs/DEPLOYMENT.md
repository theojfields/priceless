# Deploy Priceless on Tinfoil

The app runs in a CPU Tinfoil Container. It uses confidential inference and confidential search; it does not need a GPU or persistent volume. The initial release creates fresh research **processes** within that enclave.

## Required account resources

1. A Tinfoil organization with Containers enabled and an Inference API key.
2. A GitHub repository for the public deployment configuration and release workflow. This repository contains code and public keys only.
3. A chosen Tinfoil instance domain. Confirm the actual domain and instance name in the dashboard before preparing settings.

Creating accounts, connecting GitHub, generating API credentials, or starting billable resources are separate account actions. Do not put credentials in Git, configuration variables, issue text, chat, or screenshots.

## Prepare public settings and owner keys

From the project directory:

```sh
npm run prepare:tinfoil -- --repo YOUR_OWNER/priceless --enclave https://YOUR_INSTANCE.containers.tinfoil.dev
```

This writes:

- `deploy/settings.json`: public repository, enclave domain, and CVM version.
- `deploy/owner-public.pem`: public verification key, included in the measured config.
- `.runtime/owner-key.pem`: **private**, mode 0600, ignored by Git and Docker.

Keep the private owner key on your trusted machine. Its holder can provision or rotate the workload credentials. Do not lose it or copy it into the container. The setup script does not send anything over the network and does not overwrite an existing private key.

The CVM version is pinned to `0.14.17`, checked against Tinfoil's release metadata during implementation. Review a newer version before changing it.

## Build, measure, and publish

Commit the code and public `deploy/` files to the selected repository. Run the **Build Priceless and prepare Tinfoil release** workflow from the default branch with a version such as `v0.1.0`.

The workflow:

1. Builds an amd64 image using the digest-pinned Node base.
2. Runs TypeScript checks, privacy/lifecycle tests, and the production frontend build.
3. Pushes the application image to GHCR and pins its immutable digest.
4. Renders `tinfoil-config.yml`, commits it, and creates the release tag.
5. Dispatches Tinfoil's pinned `measure-image-action` workflow to attest the workload and publish the release.

The GitHub Actions token requires repository contents, packages, and workflow-dispatch permissions. Branch protection may require running the config update through a review instead. The GHCR package must be public or your Tinfoil organization must support the corresponding private-registry access.

No inference key or workspace access code is part of this build. The browser build pins the expected configuration repository. No analytics, externally hosted fonts, or third-party page assets are included.

## Start the container

In Tinfoil, create an instance from that repository and release. Use **non-debug mode**, no managed secrets, no SSH credentials, and no persistent volumes. The generated config uses:

- 2 CPUs and 4 GiB RAM;
- a read-only application filesystem with temporary `/tmp` storage;
- outbound allowlisting for Tinfoil providers and attestation dependencies;
- an owner public key pinned into the measured configuration;
- an application server on port 8080 behind Tinfoil's shim.

The application starts **locked**. Its health endpoint and public connection configuration work, but shopping tasks cannot start until owner provisioning succeeds. Confirm actual billing before starting the instance. If attestation needs an additional official dependency host, investigate the failed verification and add the exact host; do not switch to open egress as a workaround.

## Provision credentials over a verified connection

On the trusted machine that holds `.runtime/owner-key.pem`:

```sh
npm run provision
```

The script verifies the expected Tinfoil workload **before** requesting the API key. It then prompts for the inference key with input hidden. It fetches a short-lived challenge, signs the full credential payload with the owner key, and sends it inside an encrypted request body.

The enclave accepts only the pinned owner's signature and consumes the challenge once. The inference key and randomly generated workspace access code remain in application memory. The script saves only the workspace access code in `.runtime/workspace-access.txt`, mode 0600. It does not save or print the inference key.

Open the app's connection dialog and enter the workspace access code locally. The code stays in browser memory and travels only inside encrypted request bodies. Reloading the browser loses it. Restarting or replacing the enclave loses all runtime credentials and run records, so repeat provisioning after every enclave restart.

Provisioning again terminates existing runs and rotates the access code. Temporary provider-side prompt caches and infrastructure metadata have independent retention.

## Enable live flight prices (optional)

Use an approved [Skyscanner partner API key](https://developers.skyscanner.net/docs/getting-started/authentication) with Flights Live Prices and flight autosuggest access. After deploying a release that includes the fare adapter, provision both keys at the hidden terminal prompts:

```sh
npm run provision -- --flights
```

The signed request carries the fare key into enclave memory. It is not saved to disk or passed to workers. Provisioning without `--flights` disables the fare adapter. The measured egress configuration permits only the provider host; the app sends trip details there only when the shopper selects **Check live fares**. If the key is unavailable, the itinerary can still be opened on Google Flights. Confirm real airline coverage and booking links using your partner account before relying on it.

## Stronger client trust

A hosted web application still requires trust in the JavaScript delivered to the browser. Attestation does not make an untrusted frontend safe: a modified frontend could read input before encryption.

For a locally controlled client, set `PRICELESS_ENCLAVE_URL`, `PRICELESS_CONFIG_REPO`, and `VITE_PRICELESS_CONFIG_REPO` to the prepared public values when running the local app. The local client verifies the remote enclave, reads its verified readiness configuration, and sends shopping operations directly through the encrypted transport. No inference key is needed on that client. Audit and pin the local source/build independently.

## Verification remaining for a first account deployment

- Verify the measured release and encrypted browser connection on the actual instance.
- Run a live exact-product search and inspect provider response compatibility and grounded excerpts.
- Confirm the provider egress allowlist against actual SDK attestation traffic.
- Confirm cancellation and memory expiration under live provider delays.
- Observe source freshness and quote conditions; do not interpret observations as guaranteed checkout prices.

The local tests use an injected fake broker to exercise actual disposable child processes without spending inference credits or sending product data externally. They do not substitute for a live integration check.
