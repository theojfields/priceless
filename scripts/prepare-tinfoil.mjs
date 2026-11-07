import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { repo: { type: "string" }, enclave: { type: "string" } },
});
if (!values.repo || !/^[\w.-]+\/[\w.-]+$/.test(values.repo))
  throw new Error("Use --repo owner/public-config-repository.");
const enclave = new URL(values.enclave ?? "");
if (
  enclave.protocol !== "https:" ||
  enclave.username ||
  enclave.password ||
  enclave.pathname !== "/" ||
  enclave.search ||
  enclave.hash
)
  throw new Error(
    "Use --enclave https://your-instance.containers.tinfoil.dev.",
  );
await mkdir(".runtime", { recursive: true, mode: 0o700 });
await mkdir("deploy", { recursive: true });
let publicKey;
try {
  await access(".runtime/owner-key.pem");
  publicKey = await readFile("deploy/owner-public.pem", "utf8");
} catch {
  const pair = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await writeFile(".runtime/owner-key.pem", pair.privateKey, {
    mode: 0o600,
    flag: "wx",
  });
  publicKey = pair.publicKey;
  await writeFile("deploy/owner-public.pem", publicKey, { flag: "wx" });
}
await writeFile(
  "deploy/settings.json",
  JSON.stringify(
    {
      configRepo: values.repo,
      enclaveURL: enclave.origin,
      cvmVersion: "0.14.17",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Prepared public deployment settings and the owner public key. The private owner key remains in ignored .runtime/owner-key.pem.",
);
console.log("No API key or shopping data was sent to any service.");
