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
check("get_count == 3", count === 3, count);

// Campaign 0: goal 20 GEN, milestones 8/8/4.
const camp0 = await read("get_campaign", [0n]);
const exp0 = evidence.finalCampaign0;
check("c0 goal 20 GEN", camp0.goal_wei === (20n * GEN).toString(), camp0.goal_wei);
check("c0 total_backed 20 GEN", camp0.total_backed_wei === (20n * GEN).toString(), camp0.total_backed_wei);
check("c0 escrow 0", camp0.escrow_wei === "0", camp0.escrow_wei);
check("c0 MILESTONE_REVIEW", camp0.status === "MILESTONE_REVIEW", camp0.status);
camp0.milestones.forEach((m, i) => {
  const e = exp0.milestones[i];
  check(`c0 m${i} status ${e.status}`, m.status === e.status, m.status);
  check(`c0 m${i} verdict ${e.final_verdict}`, m.final_verdict === e.final_verdict, m.final_verdict);
  check(`c0 m${i} released ${genStr(e.released_wei)}`, m.released_wei === e.released_wei, genStr(m.released_wei));
  check(`c0 m${i} refunded ${genStr(e.refunded_wei)}`, m.refunded_wei === e.refunded_wei, genStr(m.refunded_wei));
  check(`c0 m${i} evidence hash == evidence`, m.evidence_hash === e.evidence_hash, m.evidence_hash);
  check(`c0 m${i} snapshot hash == evidence`, m.snapshot_hash === e.snapshot_hash, m.snapshot_hash);
  check(`c0 m${i} reference URL == evidence`, m.reference_url === e.reference_url, m.reference_url);
  check(`c0 m${i} quote verbatim in evidence snapshot excerpt`, e.snapshot_excerpt.includes(m.quote), m.quote);
});
// Verdicts: m0 ACCEPT (9 GEN released: 8 + 1 forfeited stake, or the
// frozen-branch equivalent recorded in evidence), m1 REJECT (0/8),
// m2 PARTIAL (2/2).
check("c0 m0 ACCEPT", camp0.milestones[0].final_verdict === "ACCEPT", camp0.milestones[0].final_verdict);
check("c0 m1 REJECT", camp0.milestones[1].final_verdict === "REJECT", camp0.milestones[1].final_verdict);
check("c0 m1 released 0", camp0.milestones[1].released_wei === "0", camp0.milestones[1].released_wei);
check("c0 m2 PARTIAL", camp0.milestones[2].final_verdict === "PARTIAL", camp0.milestones[2].final_verdict);
check("c0 m1 snapshot is the example.org fetch (github_sha empty)",
  camp0.milestones[1].github_sha === "" || camp0.milestones[1].github_sha === null, camp0.milestones[1].github_sha);
check("c0 m0 github_sha is a 40-hex blob SHA",
  /^[0-9a-f]{40}$/.test(camp0.milestones[0].github_sha || ""), camp0.milestones[0].github_sha);

// Campaign 1: goal 8 GEN, milestones 4/4; m0 went FROZEN then resolved.
const camp1 = await read("get_campaign", [1n]);
const exp1 = evidence.finalCampaign1;
check("c1 goal 8 GEN", camp1.goal_wei === (8n * GEN).toString(), camp1.goal_wei);
check("c1 total_backed 8 GEN", camp1.total_backed_wei === (8n * GEN).toString(), camp1.total_backed_wei);
check("c1 escrow 0", camp1.escrow_wei === "0", camp1.escrow_wei);
check("c1 m0 was FROZEN then settled (3 evaluations kept)",
  camp1.milestones[0].evaluations.length === 3, camp1.milestones[0].evaluations.length);
check("c1 m0 witness verdicts start REJECT then ACCEPT",
  camp1.milestones[0].evaluations[0].verdict === "REJECT"
  && camp1.milestones[0].evaluations[1].verdict === "ACCEPT",
  camp1.milestones[0].evaluations.map((e) => e.verdict));
check("c1 m0 final verdict == evidence", camp1.milestones[0].final_verdict === exp1.milestones[0].final_verdict, camp1.milestones[0].final_verdict);
check("c1 m1 REJECT (unrelated page)", camp1.milestones[1].final_verdict === "REJECT", camp1.milestones[1].final_verdict);
check("c1 m1 released 0", camp1.milestones[1].released_wei === "0", camp1.milestones[1].released_wei);

// Campaign 2: cancelled, 4 GEN refunded to B.
const camp2 = await read("get_campaign", [2n]);
check("c2 CANCELLED", camp2.status === "CANCELLED", camp2.status);
check("c2 escrow 0", camp2.escrow_wei === "0", camp2.escrow_wei);
check("c2 total_backed 4 GEN", camp2.total_backed_wei === (4n * GEN).toString(), camp2.total_backed_wei);

// Credits were withdrawn to zero; recompute what they were from the
// campaign records and compare with evidence.expectedCredits.
const expected = {};
for (const camp of [camp0, camp1]) {
  expected[camp.creator] = (expected[camp.creator] || 0n) + camp.milestones.reduce((s, m) => s + BigInt(m.released_wei), 0n);
  for (const m of camp.milestones) {
    for (const p of m.refund_payouts || []) expected[p.address] = (expected[p.address] || 0n) + BigInt(p.amount_wei);
    if (m.challenge && m.challenge.outcome === "WON_FROZEN") {
      expected[m.challenge.challenger] = (expected[m.challenge.challenger] || 0n) + GEN + GEN / 2n;
    }
  }
}
expected[evidence.accounts.backerB] = (expected[evidence.accounts.backerB] || 0n) + 4n * GEN; // campaign 2 cancel refund
for (const [addr, v] of Object.entries(evidence.refundCredits || {})) {
  expected[addr] = (expected[addr] || 0n) + BigInt(v); // rejected payables refunded as credit
}
for (const [addr, v] of Object.entries(expected)) {
  check(`expected credit ${addr.slice(0, 8)}… == evidence ${genStr(v)}`,
    evidence.expectedCredits[addr] === v.toString(), evidence.expectedCredits[addr]);
}
const { creator, backerB, backerC, strangerD } = evidence.accounts;
check("creator credit now 0 (withdrawn)", String(await read("get_credit", [creator])) === "0");
check("backer B credit now 0 (withdrawn)", String(await read("get_credit", [backerB])) === "0");
check("backer C credit now 0 (withdrawn)", String(await read("get_credit", [backerC])) === "0");
check("stranger D credit 0 (never participated)", String(await read("get_credit", [strangerD])) === "0");

const totals = await read("get_totals", []);
check("totals invariant_ok", totals.invariant_ok === true, totals);
check("total_received == evidence", totals.total_received_wei === evidence.finalTotals.total_received_wei, totals.total_received_wei);
check("total_received == 45 GEN (32 backed + 2 stakes + 11 refunded invalid payments)", totals.total_received_wei === (45n * GEN).toString(), totals.total_received_wei);
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
check("stranger D EOA == 10000 GEN (never paid)", (await eoa(strangerD)) === (10000n * GEN).toString(), await eoa(strangerD));
const eoaSum = BigInt(w.creator.eoaAfterWei) + BigInt(w.backerB.eoaAfterWei) + BigInt(w.backerC.eoaAfterWei) + BigInt(w.strangerD.eoaAfterWei);
check("EOA sum == 40000 GEN faucet total", eoaSum === 40000n * GEN, genStr(eoaSum));

// Supporter history reads back.
const supB = await read("get_supporter", [backerB]);
check("backer B backed 21 GEN in history (12 + 5 + 4)", supB.backed_wei_total === (21n * GEN).toString(), supB.backed_wei_total);
const supA = await read("get_supporter", [creator]);
check("creator created 3 campaigns", supA.campaigns_created === 3, supA.campaigns_created);
const supC = await read("get_supporter", [backerC]);
check("backer C won 1 challenge, lost 1", supC.challenges_won === 1 && supC.challenges_lost === 1, supC);

// Every transaction hash in evidence.json is a 0x-prefixed 32-byte hash.
const bad = evidence.transactions.filter((t) => !/^0x[0-9a-fA-F]{64}$/.test(t.txHash));
check("all evidence tx hashes well-formed", bad.length === 0, bad.map((t) => t.label));
check("evidence lists the failed calls (negative probes)",
  Array.isArray(evidence.failedCalls) && evidence.failedCalls.length >= 8, evidence.failedCalls?.length);
check("evidence lists both challenge branches", ["FAILED", "WON_FROZEN"].includes(evidence.c0m0ChallengeBranch), evidence.c0m0ChallengeBranch);
check("campaign 1 challenge branch is WON_FROZEN", evidence.c1m0Branch === "WON_FROZEN", evidence.c1m0Branch);

console.log(failures === 0 ? "\nVERIFY OK" : `\nVERIFY FAILED (${failures} checks)`);
process.exit(failures === 0 ? 0 : 1);
