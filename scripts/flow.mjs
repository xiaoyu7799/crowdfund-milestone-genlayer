/* End-to-end on-chain flow against the deployed MilestoneFund contract.
 *
 * Usage: node scripts/flow.mjs   (uses deployment.json for the address)
 *
 * Three ephemeral accounts (keys never written to disk):
 *   A = creator, B = backer + challenger, C = backer.
 * Flow: fund each with 10000 GEN from the faucet simulation
 * (sim_fundAccount; testnet GEN, zero cash cost)
 *   -> create campaign (goal 100 GEN, milestones 40/40/20 GEN)
 *   -> back_campaign B 60 GEN, C 40 GEN (real GEN, payable)
 *   -> submit milestone proof x3 (A)
 *   -> review m0 (ACCEPT) -> confirm m0 (RELEASED, creator credit 40 GEN)
 *   -> review m1 (REJECT) -> confirm m1 (REFUNDED, backers 24/16 GEN)
 *   -> review m2 (PARTIAL) -> challenge m2 (B, 1 GEN stake)
 *        - if round 2 agrees: challenge FAILED, m2 settles PARTIAL_RELEASED
 *          (21 GEN pool: creator 10.5, backers 10.5 = 6.3/4.2)
 *        - if round 2 disagrees: m2 FROZEN, challenger credited 1.5 GEN
 *          (stake + 0.5 GEN reward from escrow) -> resolve_disputed_milestone
 *          (round 3 decides; 19.5 GEN pool splits 9.75/9.75)
 *   -> withdraw_payout for A, B, C (pull payment, real GEN to each EOA)
 *   -> read back campaign, credits, totals, EOA balances; write evidence.
 *
 * The script prints the ACTUAL values and fails loudly if money does not
 * reconcile or the campaign does not end fully settled — it never rewrites
 * expectations to match. Expected credits are recomputed from the live
 * campaign record, not hardcoded, so either challenge branch verifies.
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

const GEN = 10n ** 18n;
const FUND_GEN = 10000;
const genStr = (wei) => {
  const w = BigInt(wei);
  const whole = w / GEN;
  const frac = w % GEN;
  if (frac === 0n) return `${whole} GEN`;
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")} GEN`;
};
const weiStr = (v) => BigInt(v).toString();

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
const eoaBalance = async (client, addr) => (await client.getBalance({ address: addr })).toString();

const STATUS = { 0: "UNINITIALIZED", 1: "PENDING", 2: "PROPOSING", 3: "COMMITTING", 4: "REVEALING", 5: "ACCEPTED", 6: "UNDETERMINED", 7: "FINALIZED", 8: "CANCELED" };
const statusNameOf = (receipt) => receipt.statusName ?? STATUS[receipt.status] ?? String(receipt.status ?? "");

async function write(client, functionName, args, label, value = 0n, retries = 120) {
  const hash = await client.writeContract({ address, functionName, args, value, leaderOnly: false });
  console.log(`${label} tx:`, hash, value > 0n ? `(value ${genStr(value)} = ${weiStr(value)} wei)` : "");
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.FINALIZED,
    retries,
    interval: 5000,
  });
  const statusName = statusNameOf(receipt);
  console.log(`${label} receipt:`, statusName);
  txs.push({
    label,
    functionName,
    args: JSON.stringify(args, (k, v) => (typeof v === "bigint" ? v.toString() : v)),
    value_wei: weiStr(value),
    txHash: hash,
    receiptStatus: String(statusName),
  });
  return { hash, receipt };
}

async function read(functionName, args = []) {
  const raw = await reader.readContract({ address, functionName, args });
  if (typeof raw === "string" && (raw.startsWith("{") || raw.startsWith("["))) return JSON.parse(raw);
  return raw;
}

async function writeChecked(client, functionName, args, label, checkFn, value = 0n, retries = 120) {
  const { hash } = await write(client, functionName, args, label, value, retries);
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

// --- 1. fund A, B, C with 10000 GEN each ------------------------------------
const funding = {};
for (const [name, account] of [["creator", accountA], ["backerB", accountB], ["backerC", accountC]]) {
  const client = clientFor(account);
  const fundTx = await client.request({
    method: "sim_fundAccount",
    params: [account.address, FUND_GEN * 10 ** 18],
  });
  const bal = await eoaBalance(client, account.address);
  console.log(`fund ${name}: tx ${String(fundTx).slice(0, 40)}... balance ${genStr(bal)}`);
  if (bal !== (BigInt(FUND_GEN) * GEN).toString()) throw new Error(`fund ${name} amount mismatch: ${bal}`);
  funding[name] = { address: account.address, funded_gen: FUND_GEN, fundTx: String(fundTx), eoaAfterFundWei: bal };
  txs.push({ label: `fund-${name}`, functionName: "sim_fundAccount", args: JSON.stringify([account.address, FUND_GEN * 10 ** 18]), value_wei: "0", txHash: String(fundTx), receiptStatus: "FUNDED" });
}

// --- 2. create campaign -------------------------------------------------------
const milestones = JSON.stringify([
  { title: "Sensor kits assembled", amount: (40n * GEN).toString() },
  { title: "Dashboard live", amount: (40n * GEN).toString() },
  { title: "Field report published", amount: (20n * GEN).toString() },
]);
await writeChecked(
  clientFor(accountA), "create_campaign",
  ["Riverside Community Garden sensor network", (100n * GEN).toString(), milestones],
  "create-campaign",
  (c) => c.status === "FUNDING" && c.goal_wei === (100n * GEN).toString() && c.milestones.length === 3,
);

// --- 3. back with real GEN -----------------------------------------------------
await writeChecked(clientFor(accountB), "back_campaign", [0n], "back-B-60GEN",
  (c) => c.total_backed_wei === (60n * GEN).toString() && c.status === "FUNDING", 60n * GEN);
await writeChecked(clientFor(accountC), "back_campaign", [0n], "back-C-40GEN",
  (c) => c.total_backed_wei === (100n * GEN).toString() && c.status === "MILESTONE_REVIEW", 40n * GEN);
{
  const totals = await read("get_totals", []);
  console.log("Totals after funding:", JSON.stringify(totals));
  if (totals.total_received_wei !== (100n * GEN).toString()) throw new Error("total_received mismatch after funding");
  if (totals.invariant_ok !== true) throw new Error("invariant broken after funding");
}

// --- 4. submit proof x3 ---------------------------------------------------------
const E0 = "Sensor kits assembled: 12 Riverside garden sensor kits built and installed, each reporting live. Build log: https://example.org/garden/build-log-v1";
const E1 = "We plan to build the dashboard soon and will share updates once work starts.";
const E2 = "Field report published: the garden field report is written and covers all 12 sensors with weekly readings. It is ready to share with backers.";
await writeChecked(clientFor(accountA), "submit_milestone_proof", [0n, 0, E0, EVIDENCE_DATE], "proof-m0",
  (c) => ms(c.milestones[0]) === "EVIDENCE_SUBMITTED");
await writeChecked(clientFor(accountA), "submit_milestone_proof", [0n, 1, E1, EVIDENCE_DATE], "proof-m1",
  (c) => ms(c.milestones[1]) === "EVIDENCE_SUBMITTED");
await writeChecked(clientFor(accountA), "submit_milestone_proof", [0n, 2, E2, EVIDENCE_DATE], "proof-m2",
  (c) => ms(c.milestones[2]) === "EVIDENCE_SUBMITTED");

// --- 5. review helper (retryable by design: a failed consensus leaves
//        the milestone EVIDENCE_SUBMITTED; retry at most twice, then stop) --
async function review(client, index, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { hash } = await write(client, "review_milestone", [0n, index], `${label}-attempt${attempt}`, 0n, 240);
    const state = await read("get_campaign", [0n]);
    const m = state.milestones[index];
    if (m.status === "MILESTONE_REVIEW" && m.pending_verdict) {
      console.log(`${label}: MILESTONE_REVIEW, pending verdict ${m.pending_verdict} (attempt ${attempt})`);
      return { state, hash };
    }
    console.log(`${label}: attempt ${attempt} did not reach MILESTONE_REVIEW (status ${m.status}); tx ${hash}`);
    if (attempt === 3) throw new Error(`${label} failed consensus 3 times; stopping — see tx ${hash}`);
  }
}

// --- 6. m0: review -> confirm ----------------------------------------------------
{
  const { state } = await review(clientFor(accountB), 0, "review-m0");
  console.log("m0 pending verdict:", state.milestones[0].pending_verdict);
  const after = await writeChecked(clientFor(accountC), "confirm_milestone", [0n, 0], "confirm-m0",
    (c) => ["RELEASED", "REFUNDED", "PARTIAL_RELEASED"].includes(c.milestones[0].status));
  console.log("m0 final:", after.milestones[0].final_verdict,
    "released", genStr(after.milestones[0].released_wei), "refunded", genStr(after.milestones[0].refunded_wei));
}

// --- 7. m1: review -> confirm ----------------------------------------------------
{
  const { state } = await review(clientFor(accountB), 1, "review-m1");
  console.log("m1 pending verdict:", state.milestones[1].pending_verdict);
  const after = await writeChecked(clientFor(accountC), "confirm_milestone", [0n, 1], "confirm-m1",
    (c) => ["RELEASED", "REFUNDED", "PARTIAL_RELEASED"].includes(c.milestones[1].status));
  console.log("m1 final:", after.milestones[1].final_verdict,
    "released", genStr(after.milestones[1].released_wei), "refunded", genStr(after.milestones[1].refunded_wei));
}

// --- 8. m2: review -> challenge (B, 1 GEN stake) -> settle or frozen+resolve -----
let challengeBranch = null;
{
  const { state } = await review(clientFor(accountB), 2, "review-m2");
  console.log("m2 pending verdict:", state.milestones[2].pending_verdict);
  const { hash } = await write(clientFor(accountB), "challenge_milestone", [0n, 2], "challenge-m2", 1n * GEN, 240);
  let after = await read("get_campaign", [0n]);
  const m2 = after.milestones[2];
  console.log("m2 after challenge:", m2.status, "challenge:", JSON.stringify(m2.challenge));
  if (m2.status === "FROZEN") {
    challengeBranch = "WON_FROZEN";
    console.log("m2 froze on contradiction; resolving with round 3...");
    const { hash: rhash } = await write(clientFor(accountC), "resolve_disputed_milestone", [0n, 2], "resolve-m2", 0n, 240);
    after = await read("get_campaign", [0n]);
    console.log("m2 after resolve:", after.milestones[2].status, after.milestones[2].final_verdict, "tx", rhash);
    if (!["RELEASED", "REFUNDED", "PARTIAL_RELEASED"].includes(after.milestones[2].status)) {
      throw new Error("resolve did not settle m2");
    }
  } else if (["RELEASED", "REFUNDED", "PARTIAL_RELEASED"].includes(m2.status)) {
    challengeBranch = "FAILED";
    console.log("m2 final:", m2.final_verdict, "released", genStr(m2.released_wei), "refunded", genStr(m2.refunded_wei));
  } else {
    throw new Error(`challenge-m2 left unexpected status ${m2.status} (tx ${hash})`);
  }
}

// --- 9. expected credits recomputed from the live campaign record --------------
const campaign = await read("get_campaign", [0n]);
const expectedCredits = { [accountA.address]: 0n, [accountB.address]: 0n, [accountC.address]: 0n };
for (const m of campaign.milestones) {
  expectedCredits[campaign.creator] += BigInt(m.released_wei);
  for (const p of m.refund_payouts || []) expectedCredits[p.address] += BigInt(p.amount_wei);
}
if (challengeBranch === "WON_FROZEN") {
  expectedCredits[accountB.address] += (1n * GEN) + (GEN / 2n); // stake + 0.5 GEN reward
}
console.log("Expected credits from live record:", Object.fromEntries(
  Object.entries(expectedCredits).map(([a, v]) => [a, genStr(v)])));
const creditA = BigInt(await read("get_credit", [accountA.address]));
const creditB = BigInt(await read("get_credit", [accountB.address]));
const creditC = BigInt(await read("get_credit", [accountC.address]));
console.log("Live credits: A", genStr(creditA), "B", genStr(creditB), "C", genStr(creditC));
if (creditA !== expectedCredits[accountA.address]) throw new Error(`creator credit mismatch: live ${creditA} vs expected ${expectedCredits[accountA.address]}`);
if (creditB !== expectedCredits[accountB.address]) throw new Error(`backer B credit mismatch: live ${creditB} vs expected ${expectedCredits[accountB.address]}`);
if (creditC !== expectedCredits[accountC.address]) throw new Error(`backer C credit mismatch: live ${creditC} vs expected ${expectedCredits[accountC.address]}`);

const totalsBeforeWithdraw = await read("get_totals", []);
console.log("Totals before withdraw:", JSON.stringify(totalsBeforeWithdraw));
if (totalsBeforeWithdraw.invariant_ok !== true) throw new Error("invariant broken before withdraw");
if (totalsBeforeWithdraw.escrow_locked_wei !== "0") throw new Error(`escrow not drained: ${totalsBeforeWithdraw.escrow_locked_wei}`);
if (!campaign.milestones.every((m) => ["RELEASED", "REFUNDED", "PARTIAL_RELEASED"].includes(m.status))) {
  throw new Error("Not all milestones settled");
}

// --- 10. withdraw_payout for A, B, C (pull payment, real GEN) -------------------
const withdrawals = {};
for (const [name, account] of [["creator", accountA], ["backerB", accountB], ["backerC", accountC]]) {
  const client = clientFor(account);
  const eoaBefore = await eoaBalance(client, account.address);
  const creditBefore = BigInt(await read("get_credit", [account.address]));
  await write(client, "withdraw_payout", [], `withdraw-${name}`, 0n);
  await new Promise((r) => setTimeout(r, 8000)); // ghost transfer settles on finalization; re-read after a beat
  const eoaAfter = await eoaBalance(client, account.address);
  const creditAfter = BigInt(await read("get_credit", [account.address]));
  console.log(`withdraw ${name}: credit was ${genStr(creditBefore)}, EOA ${genStr(eoaBefore)} -> ${genStr(eoaAfter)}, credit now ${genStr(creditAfter)}`);
  if (creditAfter !== 0n) throw new Error(`withdraw ${name} did not zero the credit`);
  if (BigInt(eoaAfter) - BigInt(eoaBefore) !== creditBefore) {
    throw new Error(`withdraw ${name}: EOA delta ${BigInt(eoaAfter) - BigInt(eoaBefore)} != withdrawn ${creditBefore}`);
  }
  withdrawals[name] = { address: account.address, withdrawn_wei: weiStr(creditBefore), eoaBeforeWei: eoaBefore, eoaAfterWei: eoaAfter };
}

// --- 11. final read-back + reconciliation ---------------------------------------
const finalCampaign = await read("get_campaign", [0n]);
const finalTotals = await read("get_totals", []);
const finalSupporterA = await read("get_supporter", [accountA.address]);
const finalSupporterB = await read("get_supporter", [accountB.address]);
const finalSupporterC = await read("get_supporter", [accountC.address]);
const finalBoard = await read("get_supporter_board", [10n]);
const count = await read("get_count", []);
console.log("Final campaign:", JSON.stringify(finalCampaign, null, 2));
console.log("Final totals:", JSON.stringify(finalTotals));
console.log("Final EOA balances:", JSON.stringify({
  A: withdrawals.creator.eoaAfterWei, B: withdrawals.backerB.eoaAfterWei, C: withdrawals.backerC.eoaAfterWei,
}));

const totalReceived = BigInt(finalTotals.total_received_wei);
const totalWithdrawn = BigInt(finalTotals.total_withdrawn_wei);
const creditsOutstanding = BigInt(finalTotals.credits_outstanding_wei);
const escrowLocked = BigInt(finalTotals.escrow_locked_wei);
if (finalTotals.invariant_ok !== true) throw new Error("FINAL invariant broken");
if (totalReceived !== totalWithdrawn + creditsOutstanding + escrowLocked) {
  throw new Error(`FINAL invariant mismatch: ${totalReceived} != ${totalWithdrawn} + ${creditsOutstanding} + ${escrowLocked}`);
}
if (creditsOutstanding !== 0n || escrowLocked !== 0n) throw new Error("credits/escrow not fully drained");
if (BigInt(finalTotals.contract_balance_wei) !== 0n) throw new Error(`contract balance not 0: ${finalTotals.contract_balance_wei}`);
// EOA reconciliation: each account started at 10000 GEN from the faucet.
const eoaExpected = {
  creator: BigInt(FUND_GEN) * GEN + BigInt(withdrawals.creator.withdrawn_wei),
  backerB: BigInt(FUND_GEN) * GEN - 60n * GEN - 1n * GEN + BigInt(withdrawals.backerB.withdrawn_wei),
  backerC: BigInt(FUND_GEN) * GEN - 40n * GEN + BigInt(withdrawals.backerC.withdrawn_wei),
};
if (BigInt(withdrawals.creator.eoaAfterWei) !== eoaExpected.creator) throw new Error("creator EOA reconciliation failed");
if (BigInt(withdrawals.backerB.eoaAfterWei) !== eoaExpected.backerB) throw new Error("backer B EOA reconciliation failed");
if (BigInt(withdrawals.backerC.eoaAfterWei) !== eoaExpected.backerC) throw new Error("backer C EOA reconciliation failed");
const eoaSum = eoaExpected.creator + eoaExpected.backerB + eoaExpected.backerC;
if (eoaSum !== BigInt(3 * FUND_GEN) * GEN) throw new Error(`EOA sum ${eoaSum} != 30000 GEN faucet total`);
console.log("Money reconciliation OK: total_received", genStr(totalReceived), "== total_withdrawn", genStr(totalWithdrawn),
  "+ credits 0 + escrow 0; EOA sum", genStr(eoaSum), "== 30000 GEN funded");

const evidence = {
  network: "Stable Studionet",
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
  contractAddress: address,
  explorer: `https://explorer-studio.genlayer.com/address/${address}`,
  campaignId: 0,
  accounts: { creator: accountA.address, backerB: accountB.address, backerC: accountC.address },
  funding,
  evidenceDate: EVIDENCE_DATE,
  challengeBranch,
  transactions: txs,
  finalCampaign,
  finalCredits: { creator: weiStr(creditA), backerB: weiStr(creditB), backerC: weiStr(creditC) },
  expectedCredits: Object.fromEntries(Object.entries(expectedCredits).map(([a, v]) => [a, v.toString()])),
  withdrawals,
  finalTotals,
  finalSupporters: { creator: finalSupporterA, backerB: finalSupporterB, backerC: finalSupporterC },
  finalSupporterBoard: finalBoard,
  campaignCount: Number(count),
  moneyReconciliation: {
    totalReceivedWei: totalReceived.toString(),
    totalWithdrawnWei: totalWithdrawn.toString(),
    creditsOutstandingWei: creditsOutstanding.toString(),
    escrowLockedWei: escrowLocked.toString(),
    contractBalanceWei: finalTotals.contract_balance_wei,
    eoaSumWei: eoaSum.toString(),
    faucetFundedWei: (BigInt(3 * FUND_GEN) * GEN).toString(),
    invariant: "total_received == total_withdrawn + credits_outstanding + escrow_locked",
    invariantOk: true,
  },
  supersededContract: {
    address: "0x23667D800Be2A8cf97445134Fea1691387F10f3E",
    status: "superseded",
    reason: "Replaced: it used a ledger of units inside the contract instead of real GEN.",
  },
  checkedAt: new Date().toISOString(),
};
mkdirSync(path.join(root, "evidence"), { recursive: true });
writeFileSync(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
writeFileSync(path.join(root, "evidence", "live-verification.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log("Wrote evidence.json and evidence/live-verification.json");
