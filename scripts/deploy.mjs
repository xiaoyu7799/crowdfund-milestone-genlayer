/* Deploy MilestoneFund to Stable Studionet (chain 61999) only.
 *
 * Usage:
 *   node scripts/deploy.mjs --check     # read-only source/network preflight
 *   MF_RECOVERY_FILE=/private/signers.json node scripts/deploy.mjs --submit
 *
 * The private key is never included in deployment.json or receipt evidence.
 * Recovery keys are loaded from the external MF_RECOVERY_FILE when supplied.
 * After deploy, the deployed code is read back with gen_getContractCode
 * (base64), decoded, and SHA-256 compared against the source file byte
 * for byte. A mismatch stops the script: FINALIZED alone is not proof
 * the deployed code is the repo code.
 */
import { assertSuccessfulReceipt } from "./receipt.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const codePath = path.join(root, "contracts", "milestone_fund.py");
const code = readFileSync(codePath, "utf-8");
const codeSha = createHash("sha256").update(code).digest("hex");
console.log("Source SHA-256:", codeSha);

if (!process.argv.includes("--submit")) {
  const client = createClient({ chain: studionet });
  const chainId = Number(await client.request({method: "eth_chainId"}));
  if (chainId !== 61999) throw new Error(`Wrong chain: ${chainId}`);
  console.log(JSON.stringify({sourceSha256: codeSha, chainId, rpc: "https://studio.genlayer.com/api", submission: false}));
  process.exit(0);
}

const suppliedKey = process.env.GENLAYER_PRIVATE_KEY;
const recoveryPath = process.env.MF_RECOVERY_FILE;
const recovery = recoveryPath ? JSON.parse(readFileSync(recoveryPath, "utf8")) : null;
const privateKey = suppliedKey || recovery?.keys?.deployer || generatePrivateKey();
if (!suppliedKey && !recovery) {
  console.log("No GENLAYER_PRIVATE_KEY supplied: using an ephemeral deployer key for this run only.");
}
const account = createAccount(privateKey);
console.log("Deployer:", account.address);
console.log("Network: Stable Studionet, chain 61999, https://studio.genlayer.com/api");

const client = createClient({ chain: studionet, account });
const chainId = Number(await client.request({method: "eth_chainId"}));
if (chainId !== 61999) throw new Error("Wrong chain");
const journalPath = path.join(root, "evidence", "deployment-pending.json");
let journal = null;
try { journal = JSON.parse(readFileSync(journalPath, "utf8")); } catch {}
if (journal && journal.sourceSha256 !== codeSha) throw new Error("Pending deployment source mismatch; inspect its receipt before proceeding");
const txHash = journal?.txHash || await client.deployContract({ code, args: [], leaderOnly: false });
writeFileSync(journalPath, JSON.stringify({txHash, sourceSha256:codeSha, deployer:account.address}, null, 2) + "\n");
console.log("Deploy tx:", txHash);

const STATUS = { 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED" };
const receipt = await client.waitForTransactionReceipt({
  hash: txHash,
  status: TransactionStatus.FINALIZED,
  retries: 180,
  interval: 5000,
});
const statusName = receipt.statusName ?? STATUS[receipt.status] ?? String(receipt.status ?? "");
writeFileSync(path.join(root, "evidence", "deployment-receipt.json"), JSON.stringify(receipt, (k,v)=>typeof v==="bigint"?v.toString():v, 2) + "\n");
const proof = assertSuccessfulReceipt(receipt);
console.log("Receipt status:", statusName, proof.execution, proof.consensus);
if (statusName !== "FINALIZED") throw new Error(`Deploy did not finalize: ${statusName}`);

const address =
  receipt?.data?.contract_address ??
  receipt?.txDataDecoded?.contractAddress ??
  receipt?.contractAddress ??
  null;
if (!address) {
  console.log("Full receipt (no private key):", JSON.stringify(receipt, null, 2).slice(0, 4000));
  throw new Error("Could not find contract address in deploy receipt");
}
console.log("Contract address:", address);

// Read back the deployed code and compare byte for byte with the source.
const cc = await client.request({ method: "gen_getContractCode", params: [address] });
if (typeof cc !== "string" || cc.length === 0) throw new Error("gen_getContractCode returned nothing usable");
let decoded = null;
try {
  decoded = Buffer.from(cc, "base64").toString("utf-8");
} catch { /* fall through to the direct comparison below */ }
if (decoded !== code) {
  // Some nodes return the source text directly instead of base64.
  if (cc === code) decoded = cc;
}
if (decoded !== code) {
  console.log("gen_getContractCode length:", cc.length, "decoded length:", decoded ? decoded.length : -1, "source length:", code.length);
  throw new Error("DEPLOYED CODE DOES NOT MATCH SOURCE FILE — refusing to record this deployment");
}
const deployedCodeSha = createHash("sha256").update(decoded).digest("hex");
console.log("Deployed code SHA-256:", deployedCodeSha, "| match:", deployedCodeSha === codeSha);

const deployment = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  studio: `https://studio.genlayer.com/?import-contract=${address}`,
  contractAddress: address,
  deployTxHash: txHash,
  deployer: account.address,
  contractFile: "contracts/milestone_fund.py",
  contractSha256: codeSha,
  deployedCodeSha256: deployedCodeSha,
  deployedCodeMatchesSource: deployedCodeSha === codeSha,
  deployedAt: new Date().toISOString(),
  receiptStatus: statusName,
  executionResult: proof.execution,
  consensusResult: proof.consensus,
};
writeFileSync(path.join(root, "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
console.log("Wrote deployment.json");
