import type { AppConfig, ShoppingRun } from "../shared/types";

let secureFetch: typeof fetch | undefined;
let enclaveOrigin: string | undefined;
export async function initialize(): Promise<{
  config: AppConfig;
  verified: boolean;
}> {
  const response = await fetch("/api/config", {
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok)
    throw new Error("The private workspace could not be reached.");
  const config = (await response.json()) as AppConfig;
  if (config.enclaveURL && config.configRepo) {
    const pinnedRepo = import.meta.env.VITE_PRICELESS_CONFIG_REPO;
    if (!pinnedRepo || pinnedRepo !== config.configRepo)
      throw new Error(
        "The app build must pin the expected Tinfoil configuration repository before live use.",
      );
    const { SecureClient } = await import("tinfoil");
    const secure = new SecureClient({
      enclaveURL: config.enclaveURL,
      configRepo: pinnedRepo,
      userCacheSecret: crypto.randomUUID(),
      transport: "ehbp",
    });
    await secure.ready();
    if (!secure.getVerificationDocument().securityVerified)
      throw new Error(
        "Enclave verification did not pass. Shopping details have not been sent.",
      );
    secureFetch = secure.fetch;
    enclaveOrigin = new URL(config.enclaveURL).origin;
    const remote = await secure.fetch(`${enclaveOrigin}/api/config`, {
      cache: "no-store",
      credentials: "omit",
    });
    if (!remote.ok)
      throw new Error("The verified workspace is not responding.");
    const remoteConfig = (await remote.json()) as AppConfig;
    if (
      remoteConfig.configRepo !== pinnedRepo ||
      remoteConfig.enclaveURL !== config.enclaveURL
    ) {
      secureFetch = undefined;
      throw new Error(
        "The verified workspace does not match the pinned client configuration.",
      );
    }
    return { config: remoteConfig, verified: true };
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
    throw new Error(
      "A remote workspace requires verified Tinfoil encryption. Shopping details have not been sent.",
    );
  }
  secureFetch = fetch;
  return { config, verified: false };
}

export async function operation<T>(
  action: string,
  body: object,
  accessToken: string,
): Promise<T> {
  if (!secureFetch) throw new Error("A verified connection is not ready.");
  const response = await secureFetch(
    `${enclaveOrigin ?? ""}/api/runs/${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      credentials: "omit",
      body: JSON.stringify({
        ...body,
        ...(accessToken ? { accessToken } : {}),
      }),
    },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error ?? "The private request could not be completed.",
    );
  return data as T;
}
export type CreateResponse = { run: ShoppingRun; runKey: string };
