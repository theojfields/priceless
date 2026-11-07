import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { image: { type: "string" } } });
if (
  !values.image ||
  !/^ghcr\.io\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/.test(values.image)
)
  throw new Error("Provide an immutable GHCR image digest with --image.");
const settings = JSON.parse(await readFile("deploy/settings.json", "utf8"));
const publicKey = (await readFile("deploy/owner-public.pem", "utf8")).replace(
  /\n/g,
  "\\n",
);
const domains = [
  "inference.tinfoil.sh",
  "websearch.tinfoil.sh",
  "atc.tinfoil.sh",
  "github-proxy.tinfoil.sh",
  "kds-proxy.tinfoil.sh",
  "api.github.com",
  "github.com",
  "raw.githubusercontent.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "fulcio.sigstore.dev",
  "rekor.sigstore.dev",
  "tuf-repo-cdn.sigstore.dev",
];
const config = `# Generated from deploy/settings.json and a pinned container digest. Contains no private secrets.
cvm-version: ${JSON.stringify(settings.cvmVersion)}
cpus: 2
memory: 4096

networks:
  providers:
    egress: allowlist
    allow:
${domains.map((domain) => `      - ${domain}`).join("\n")}

containers:
  - name: priceless
    image: ${JSON.stringify(values.image)}
    user: "1000:1000"
    networks: [providers]
    read_only: true
    pids_limit: 128
    tmpfs:
      /tmp: "size=64m,mode=1777,noexec,nosuid,nodev"
    env:
      - NODE_ENV: production
      - HOST: "0.0.0.0"
      - PORT: "8080"
      - PRICELESS_ENCLAVE_URL: ${JSON.stringify(settings.enclaveURL)}
      - PRICELESS_CONFIG_REPO: ${JSON.stringify(settings.configRepo)}
      - PRICELESS_CLIENT_ORIGINS: "http://127.0.0.1:3210,http://localhost:3210"
      - PRICELESS_OWNER_PUBLIC_KEY: ${JSON.stringify(publicKey)}
      - TINFOIL_MODEL: gpt-oss-120b

shim:
  upstream-port: 8080
  origins:
    - ${JSON.stringify(settings.enclaveURL)}
    - http://127.0.0.1:3210
    - http://localhost:3210
  paths:
    - /*
`;
await writeFile("tinfoil-config.yml", config);
console.log(
  "Rendered tinfoil-config.yml with an immutable image, public owner key, and provider-only egress. No persistent volumes or private secrets.",
);
