/* Independent read-back verification of a deployed MilestoneFund contract.
 * Reads only — no writes. Recomputes the money reconciliation from live
 * chain state and compares it against evidence.json, and re-checks the
 * deployed code hash against the source file.
 *
 * Usage: node scripts/verify.mjs [contract-address]
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(path.join(root, "deployment.json"), "utf-8"));
const evidence = JSON.parse(readFileSync(path.join(root, "evidence.json"), "utf-8"));
const address = process.argv[2] || deployment.contractAddress;
const GEN = 10n ** 18n;
const genStr = (wei) => {
  const w = BigInt(wei);
  const whole = w / GEN;
  const frac = w % GEN;
  if (frac === 0n) return `${whole} GEN`;
  return `${whole}.${frac.toString().padStart(18, "0").replace(/0+$/, "")} GEN`;
};

const client = createClient({ chain: studionet, account: createAccount(generatePrivateKey()) });
async function read(fn, args = []) {
  const raw = await client.readContract({ address, functionName: fn, args });
  if (typeof raw === "string" && (raw.startsWith("{") || raw.startsWith("["))) return JSON.parse(raw);
  return raw;
}

let failures = 0;
function check(name, cond, actual) {
  console.log(`${cond ? "ok  " : "FAIL"}: ${name}${cond ? "" : ` — got ${JSON.stringify(actual)}`}`);
  if (!cond) failures += 1;
}

// 0. deployed code matches the repo source file, byte for byte.
const code = readFileSync(path.join(root, "contracts", "milestone_fund.py"), "utf-8");
const srcSha = createHash("sha256").update(code).digest("hex");
check("source SHA == deployment.json contractSha256", srcSha === deployment.contractSha256, srcSha);
const cc = await client.request({ method: "gen_getContractCode", params: [address] });
const decoded = Buffer.from(cc, "base64").toString("utf-8");
const deployedSha = createHash("sha256").update(decoded).digest("hex");
check("deployed code SHA == source SHA", deployedSha === srcSha, deployedSha);
check("deployed code == source file bytes", decoded === code, decoded.length);

const count = Number(await read("get_count"));
check("get_count == 1", count === 1, count);
const camp = await read("get_campaign", [0n]);
const exp = evidence.finalCampaign;
check("campaign goal 100 GEN", camp.goal_wei === (100n * GEN).toString(), camp.goal_wei);
check("campaign total_backed 100 GEN", camp.total_backed_wei === (100n * GEN).toString(), camp.total_backed_wei);
check("campaign escrow 0", camp.escrow_wei === "0", camp.escrow_wei);
check("campaign MILESTONE_REVIEW", camp.status === "MILESTONE_REVIEW", camp.status);
camp.milestones.forEach((m, i) => {
  const e = exp.milestones[i];
  check(`m${i} status ${e.status}`, m.status === e.status, m.status);
  check(`m${i} verdict ${e.final_verdict}`, m.final_verdict === e.final_verdict, m.final_verdict);
  check(`m${i} released ${genStr(e.released_wei)}`, m.released_wei === e.released_wei, genStr(m.released_wei));
  check(`m${i} refunded ${genStr(e.refunded_wei)}`, m.refunded_wei === e.refunded_wei, genStr(m.refunded_wei));
  check(`m${i} evidence hash == evidence`, m.evidence_hash === e.evidence_hash, m.evidence_hash);
});

// Credits were withdrawn to zero; recompute what they were from the
// campaign record and compare with evidence.expectedCredits.
const expected = { [exp.creator]: 0n };
for (const m of camp.milestones) {
  expected[exp.creator] = (expected[exp.creator] || 0n) + BigInt(m.released_wei);
  for (const p of m.refund_payouts || []) expected[p.address] = (expected[p.address] || 0n) + BigInt(p.amount_wei);
}
if (evidence.challengeBranch === "WON_FROZEN") {
  expected[evidence.accounts.backerB] += GEN + GEN / 2n;
}
for (const [addr, v] of Object.entries(expected)) {
  check(`expected credit ${addr.slice(0, 8)}… == evidence ${genStr(v)}`,
    evidence.expectedCredits[addr] === v.toString(), evidence.expectedCredits[addr]);
}
const { creator, backerB, backerC } = evidence.accounts;
check("creator credit now 0 (withdrawn)", String(await read("get_credit", [creator])) === "0");
check("backer B credit now 0 (withdrawn)", String(await read("get_credit", [backerB])) === "0");
check("backer C credit now 0 (withdrawn)", String(await read("get_credit", [backerC])) === "0");

const totals = await read("get_totals", []);
check("totals invariant_ok", totals.invariant_ok === true, totals);
check("total_received == evidence", totals.total_received_wei === evidence.finalTotals.total_received_wei, totals.total_received_wei);
check("total_withdrawn == total_received", totals.total_withdrawn_wei === totals.total_received_wei, totals.total_withdrawn_wei);
check("credits outstanding 0", totals.credits_outstanding_wei === "0", totals.credits_outstanding_wei);
check("escrow locked 0", totals.escrow_locked_wei === "0", totals.escrow_locked_wei);
check("contract balance 0", totals.contract_balance_wei === "0", totals.contract_balance_wei);

// EOA balances: faucet 10000 GEN each, minus what each paid, plus what each withdrew.
const eoa = async (addr) => (await client.getBalance({ address: addr })).toString();
const w = evidence.withdrawals;
check("creator EOA == evidence", (await eoa(creator)) === w.creator.eoaAfterWei, await eoa(creator));
check("backer B EOA == evidence", (await eoa(backerB)) === w.backerB.eoaAfterWei, await eoa(backerB));
check("backer C EOA == evidence", (await eoa(backerC)) === w.backerC.eoaAfterWei, await eoa(backerC));
const eoaSum = BigInt(w.creator.eoaAfterWei) + BigInt(w.backerB.eoaAfterWei) + BigInt(w.backerC.eoaAfterWei);
check("EOA sum == 30000 GEN faucet total", eoaSum === 30000n * GEN, genStr(eoaSum));

// Supporter history reads back.
const supB = await read("get_supporter", [backerB]);
check("backer B backed 60 GEN in history", supB.backed_wei_total === (60n * GEN).toString(), supB.backed_wei_total);
check("backer B completed 3 milestones as backer", supB.milestones_completed_as_backer === 3, supB.milestones_completed_as_backer);
const supA = await read("get_supporter", [creator]);
check("creator created 1 campaign", supA.campaigns_created === 1, supA.campaigns_created);
const board = await read("get_supporter_board", [10n]);
check("supporter board has 3 rows", board.length === 3, board.length);
check("supporter board ordered B, C, A",
  board.map((r) => r.address).join(",") === [backerB, backerC, creator].join(","), board.map((r) => r.address));

// Every transaction hash in evidence.json is a 0x-prefixed 32-byte hash.
const bad = evidence.transactions.filter((t) => !/^0x[0-9a-fA-F]{64}$/.test(t.txHash));
check("all evidence tx hashes well-formed", bad.length === 0, bad.map((t) => t.label));
check("evidence lists the challenge branch", ["FAILED", "WON_FROZEN"].includes(evidence.challengeBranch), evidence.challengeBranch);

console.log(failures === 0 ? "\nVERIFY OK" : `\nVERIFY FAILED (${failures} checks)`);
process.exit(failures === 0 ? 0 : 1);
