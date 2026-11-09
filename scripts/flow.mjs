/* End-to-end on-chain flow against the deployed MilestoneFund contract.
 *
 * Usage: node scripts/flow.mjs   (uses deployment.json for the address)
 *
 * Three ephemeral accounts (keys never written to disk):
 *   A = creator, B = backer + challenger, C = backer.
 * Flow: claim x3 -> create campaign (goal 10000, milestones 4000/4000/2000)
 *   -> back B 6000, back C 4000 (FUNDED) -> submit evidence x3 (A)
 *   -> evaluate m0 (ACCEPT) -> finalize m0 (release 4000)
 *   -> evaluate m1 (REJECT) -> finalize m1 (refund 4000 pro-rata 2400/1600)
 *   -> evaluate m2 (PARTIAL) -> challenge m2 (B)
 *        - if round 2 agrees: challenge FAILED, m2 finalizes PARTIAL
 *          (release 1000, refund 1000; challenger -5 rep, 50 slashed)
 *        - if round 2 disagrees: m2 FROZEN -> resolve_frozen (round 3 decides)
 *   -> read back campaign, balances, leaderboard; write evidence files.
 *
 * Expected end balances (if verdicts land as designed): A 15000, B 6980,
 * C 8020, escrow 0, total conserved 30000. The script prints the ACTUAL
 * values and fails loudly if money does not conserve or the campaign does
 * not end fully FINALIZED — it never rewrites expectations to match.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(path.join(root, "deployment.json"), "utf-8"));
const address = process.env.CONTRACT_ADDRESS || deployment.contractAddress;
if (!address) throw new Error("No contract address: set CONTRACT_ADDRESS or run deploy first");

const accountA = createAccount(generatePrivateKey());
const accountB = createAccount(generatePrivateKey());
const accountC = createAccount(generatePrivateKey());
console.log("Creator A:", accountA.address);
console.log("Backer  B:", accountB.address);
console.log("Backer  C:", accountC.address);
console.log("Contract:", address);

const clientFor = (account) => createClient({ chain: studionet, account });
const reader = clientFor(accountA); // reads need no specific account

const txs = [];
const FINALIZED = "FINALIZED";

async function write(client, functionName, args, label, retries = 120) {
  const hash = await client.writeContract({ address, functionName, args, value: 0n, leaderOnly: false });
  console.log(`${label} tx:`, hash);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries,
    interval: 5000,
  });
  const statusName = receipt.statusName ?? receipt.status;
  console.log(`${label} receipt:`, statusName);
  txs.push({ label, functionName, args: JSON.stringify(args, (k, v) => (typeof v === "bigint" ? v.toString() : v)), txHash: hash, receiptStatus: String(statusName) });
  return { hash, receipt };
}

async function read(functionName, args = []) {
  const raw = await reader.readContract({ address, functionName, args });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function writeChecked(client, functionName, args, label, checkFn, retries = 120) {
  const { hash } = await write(client, functionName, args, label, retries);
  const state = await read("get_campaign", [0n]);
  if (!checkFn(state)) {
    console.log(`${label} state after tx:`, JSON.stringify(state, null, 2).slice(0, 3000));
    throw new Error(`${label} did not produce the expected on-chain state (tx ${hash})`);
  }
  return state;
}

const ms = (n) => n.status;
const EVIDENCE_DATE = new Date().toISOString().slice(0, 10); // today UTC
console.log("Evidence date (today UTC):", EVIDENCE_DATE);

// --- 1. claim demo funds -------------------------------------------------
await write(clientFor(accountA), "claim_demo_funds", [], "claim-A");
await write(clientFor(accountB), "claim_demo_funds", [], "claim-B");
await write(clientFor(accountC), "claim_demo_funds", [], "claim-C");

// --- 2. create campaign ---------------------------------------------------
const milestones = JSON.stringify([
  { title: "Sensor kits assembled", amount: 4000 },
  { title: "Dashboard live", amount: 4000 },
  { title: "Field report published", amount: 2000 },
]);
await writeChecked(
  clientFor(accountA), "create_campaign",
  ["Riverside Community Garden sensor network", 10000, milestones],
  "create-campaign",
  (c) => c.status === "FUNDING" && c.goal === 10000 && c.milestones.length === 3,
);

// --- 3. back to full funding ----------------------------------------------
await writeChecked(clientFor(accountB), "back", [0n, 6000], "back-B-6000",
  (c) => c.total_backed === 6000 && c.status === "FUNDING");
await writeChecked(clientFor(accountC), "back", [0n, 4000], "back-C-4000",
  (c) => c.total_backed === 10000 && c.status === "FUNDED");

// --- 4. submit evidence x3 -------------------------------------------------
const E0 = "Sensor kits assembled: 12 Riverside garden sensor kits built and installed, each reporting live. Build log: https://example.org/garden/build-log-v1";
const E1 = "We plan to build the dashboard soon and will share updates once work starts.";
const E2 = "Field report published: the garden field report is written and covers all 12 sensors with weekly readings. It is ready to share with backers.";
await writeChecked(clientFor(accountA), "submit_milestone_evidence", [0n, 0, E0, EVIDENCE_DATE], "evidence-m0",
  (c) => ms(c.milestones[0]) === "EVIDENCE_SUBMITTED");
await writeChecked(clientFor(accountA), "submit_milestone_evidence", [0n, 1, E1, EVIDENCE_DATE], "evidence-m1",
  (c) => ms(c.milestones[1]) === "EVIDENCE_SUBMITTED");
await writeChecked(clientFor(accountA), "submit_milestone_evidence", [0n, 2, E2, EVIDENCE_DATE], "evidence-m2",
  (c) => ms(c.milestones[2]) === "EVIDENCE_SUBMITTED");

// --- 5. evaluate helper (retryable by design: a failed consensus leaves
//        the milestone EVIDENCE_SUBMITTED; retry at most twice, then stop) --
async function evaluate(client, index, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { hash } = await write(client, "evaluate_milestone", [0n, index], `${label}-attempt${attempt}`, 240);
    const state = await read("get_campaign", [0n]);
    const m = state.milestones[index];
    if (m.status === "EVALUATING" && m.pending_verdict) {
      console.log(`${label}: EVALUATING, pending verdict ${m.pending_verdict} (attempt ${attempt})`);
      return { state, hash };
    }
    console.log(`${label}: attempt ${attempt} did not reach EVALUATING (status ${m.status}); tx ${hash}`);
    if (attempt === 3) throw new Error(`${label} failed consensus 3 times; stopping — see tx ${hash}`);
  }
}

// --- 6. m0: evaluate -> finalize -------------------------------------------
{
  const { state } = await evaluate(clientFor(accountB), 0, "evaluate-m0");
  console.log("m0 pending verdict:", state.milestones[0].pending_verdict);
  const after = await writeChecked(clientFor(accountC), "finalize_milestone", [0n, 0], "finalize-m0",
    (c) => c.milestones[0].status === "FINALIZED");
  console.log("m0 final:", after.milestones[0].final_verdict,
    "released", after.milestones[0].released, "refunded", after.milestones[0].refunded);
}

// --- 7. m1: evaluate -> finalize -------------------------------------------
{
  const { state } = await evaluate(clientFor(accountB), 1, "evaluate-m1");
  console.log("m1 pending verdict:", state.milestones[1].pending_verdict);
  const after = await writeChecked(clientFor(accountC), "finalize_milestone", [0n, 1], "finalize-m1",
    (c) => c.milestones[1].status === "FINALIZED");
  console.log("m1 final:", after.milestones[1].final_verdict,
    "released", after.milestones[1].released, "refunded", after.milestones[1].refunded);
}

// --- 8. m2: evaluate -> challenge (B) -> finalize or frozen+resolve -------
{
  const { state } = await evaluate(clientFor(accountB), 2, "evaluate-m2");
  console.log("m2 pending verdict:", state.milestones[2].pending_verdict);
  const { hash } = await write(clientFor(accountB), "challenge_milestone", [0n, 2], "challenge-m2", 240);
  let after = await read("get_campaign", [0n]);
  const m2 = after.milestones[2];
  console.log("m2 after challenge:", m2.status, "challenge:", JSON.stringify(m2.challenge));
  if (m2.status === "FROZEN") {
    console.log("m2 froze on contradiction; resolving with round 3...");
    const { hash: rhash } = await write(clientFor(accountC), "resolve_frozen", [0n, 2], "resolve-m2", 240);
    after = await read("get_campaign", [0n]);
    console.log("m2 after resolve:", after.milestones[2].status, after.milestones[2].final_verdict, "tx", rhash);
    if (after.milestones[2].status !== "FINALIZED") throw new Error("resolve did not finalize m2");
  } else if (m2.status !== "FINALIZED") {
    throw new Error(`challenge-m2 left unexpected status ${m2.status} (tx ${hash})`);
  } else {
    console.log("m2 final:", m2.final_verdict, "released", m2.released, "refunded", m2.refunded);
  }
}

// --- 9. final read-back ------------------------------------------------------
const campaign = await read("get_campaign", [0n]);
const balA = await read("get_balance", [accountA.address]);
const balB = await read("get_balance", [accountB.address]);
const balC = await read("get_balance", [accountC.address]);
const leaderboard = await read("get_leaderboard", [10n]);
const count = await read("get_count", []);
console.log("Campaign:", JSON.stringify(campaign, null, 2));
console.log("Balances:", JSON.stringify({ A: balA, B: balB, C: balC }, null, 2));
console.log("Leaderboard:", JSON.stringify(leaderboard, null, 2));
console.log("Campaign count:", String(count));

const total = balA.balance + balB.balance + balC.balance + campaign.escrow;
console.log("Money conservation check: balances + escrow =", total, "(minted 30000)");
if (total !== 30000) throw new Error(`Money does not conserve: ${total} != 30000`);
if (!campaign.milestones.every((m) => m.status === "FINALIZED")) {
  throw new Error("Not all milestones FINALIZED");
}
if (campaign.escrow !== 0) throw new Error(`Escrow not drained: ${campaign.escrow}`);

const evidence = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress: address,
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  campaignId: 0,
  accounts: { creator: accountA.address, backerB: accountB.address, backerC: accountC.address },
  evidenceDate: EVIDENCE_DATE,
  transactions: txs,
  finalCampaign: campaign,
  finalBalances: { creator: balA, backerB: balB, backerC: balC },
  finalLeaderboard: leaderboard,
  campaignCount: Number(count),
  moneyConservation: { total, minted: 30000, escrow: campaign.escrow },
  checkedAt: new Date().toISOString(),
};
mkdirSync(path.join(root, "evidence"), { recursive: true });
writeFileSync(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
writeFileSync(path.join(root, "evidence", "live-verification.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Wrote evidence.json and evidence/live-verification.json");
