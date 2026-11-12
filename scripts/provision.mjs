import { randomBytes, sign } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { SecureClient } from "tinfoil";

const settings = JSON.parse(await readFile("deploy/settings.json", "utf8"));
const ownerKey = await readFile(".runtime/owner-key.pem", "utf8");
const secure = new SecureClient({
  enclaveURL: settings.enclaveURL,
  configRepo: settings.configRepo,
  userCacheSecret: randomBytes(32).toString("hex"),
});
await secure.ready();
if (!secure.getVerificationDocument().securityVerified)
  throw new Error("Attestation did not pass. No credentials were sent.");
console.log("Application enclave verified.");

async function hiddenPrompt(label) {
  if (!process.stdin.isTTY)
    throw new Error(
      "Set TINFOIL_API_KEY in the environment or run this command in an interactive terminal.",
    );
  process.stdout.write(`${label} (hidden): `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", listener);
      process.stdout.write("\n");
    };
    const listener = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === "\r" || character === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (character === "\u007f" || character === "\b")
          value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", listener);
  });
}
const apiKey = process.env.TINFOIL_API_KEY || (await hiddenPrompt("Tinfoil inference API key"));
if (apiKey.length < 8) throw new Error("An inference API key is required.");
const flightApiKey = process.argv.includes("--flights")
  ? await hiddenPrompt("Skyscanner partner API key")
  : undefined;
if (flightApiKey !== undefined && flightApiKey.length < 8)
  throw new Error("A Skyscanner partner API key is required for --flights.");
const challenge = await secure.fetch(
  `${settings.enclaveURL}/api/provision/challenge`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  },
);
if (!challenge.ok)
  throw new Error("Could not obtain the provisioning challenge.");
const { nonce } = await challenge.json();
const accessToken = randomBytes(32).toString("hex");
const payload = { nonce, apiKey, accessToken, flightApiKey };
const message = Buffer.from(
  JSON.stringify({ purpose: "priceless-provision-v1", ...payload }),
);
const signature = sign(null, message, ownerKey).toString("base64");
const result = await secure.fetch(
  `${settings.enclaveURL}/api/provision/complete`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, signature }),
  },
);
if (!result.ok)
  throw new Error(
    "Provisioning was rejected. Credentials were not printed or saved.",
  );
await writeFile(".runtime/workspace-access.txt", accessToken + "\n", {
  mode: 0o600,
});
console.log(
  "Provisioned. The API key is held in enclave memory and was not saved locally.",
);
console.log(
  "Your private workspace access code is in .runtime/workspace-access.txt. Open it locally and enter it in the app connection dialog.",
);
console.log("A restarted enclave must be provisioned again.");
