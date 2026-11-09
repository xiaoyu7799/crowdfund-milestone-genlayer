/* Independent read-back verification of a deployed MilestoneFund contract.
 * Reads only — no writes. Recomputes the money-conservation check and the
 * milestone settlements from live chain state and compares them against
 * evidence.json.
 *
 * Usage: node scripts/verify.mjs [contract-address]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(readFileSync(path.join(root, "deployment.json"), "utf-8"));
const evidence = JSON.parse(readFileSync(path.join(root, "evidence.json"), "utf-8"));
const address = process.argv[2] || deployment.contractAddress;

const client = createClient({ chain: studionet, account: createAccount(generatePrivateKey()) });
async function read(fn, args = []) {
  const raw = await client.readContract({ address, functionName: fn, args });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

let failures = 0;
function check(name, cond, actual) {
  console.log(`${cond ? "ok  " : "FAIL"}: ${name}${cond ? "" : ` — got ${JSON.stringify(actual)}`}`);
  if (!cond) failures += 1;
}

const count = Number(await read("get_count"));
check("get_count == 1", count === 1, count);
const camp = await read("get_campaign", [0n]);
check("campaign goal 10000", camp.goal === 10000, camp.goal);
check("campaign total_backed 10000", camp.total_backed === 10000, camp.total_backed);
check("campaign escrow 0", camp.escrow === 0, camp.escrow);
check("campaign FUNDED", camp.status === "FUNDED", camp.status);
const expected = evidence.finalCampaign.milestones.map((m) => ({
  verdict: m.final_verdict, released: m.released, refunded: m.refunded,
}));
camp.milestones.forEach((m, i) => {
  check(`m${i} FINALIZED`, m.status === "FINALIZED", m.status);
  check(`m${i} verdict ${expected[i].verdict}`, m.final_verdict === expected[i].verdict, m.final_verdict);
  check(`m${i} released ${expected[i].released}`, m.released === expected[i].released, m.released);
  check(`m${i} refunded ${expected[i].refunded}`, m.refunded === expected[i].refunded, m.refunded);
});
const { creator, backerB, backerC } = evidence.accounts;
const balA = await read("get_balance", [creator]);
const balB = await read("get_balance", [backerB]);
const balC = await read("get_balance", [backerC]);
check("creator balance == evidence", balA.balance === evidence.finalBalances.creator.balance, balA.balance);
check("backer B balance == evidence", balB.balance === evidence.finalBalances.backerB.balance, balB.balance);
check("backer C balance == evidence", balC.balance === evidence.finalBalances.backerC.balance, balC.balance);
check("creator reputation == evidence", balA.reputation === evidence.finalBalances.creator.reputation, balA.reputation);
check("challenger reputation == evidence", balB.reputation === evidence.finalBalances.backerB.reputation, balB.reputation);
const total = balA.balance + balB.balance + balC.balance + camp.escrow;
check("money conserved: balances + escrow == 30000", total === 30000, total);
const lb = await read("get_leaderboard", [10n]);
check("leaderboard has 3 participants", lb.length === 3, lb.length);

console.log(failures === 0 ? "\nVERIFY OK" : `\nVERIFY FAILED (${failures} checks)`);
process.exit(failures === 0 ? 0 : 1);
