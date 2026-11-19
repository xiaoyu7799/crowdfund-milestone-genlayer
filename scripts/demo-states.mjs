import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { assertSuccessfulReceipt, readReturnedObject } from "./receipt.mjs";

const specs = [
  { key: "funding", title: "Community tool library", goal: 6n, backing: 2n, milestones: ["Inventory tool kits", "Open weekend checkout"], campaignStatus: "FUNDING", status: "PENDING" },
  { key: "pending", title: "Neighborhood seed exchange", goal: 4n, backing: 4n, milestones: ["Prepare seed packets", "Run the exchange"], campaignStatus: "MILESTONE_REVIEW", status: "PENDING" },
  { key: "evidence", title: "Trailhead sensor kits", goal: 4n, backing: 4n, milestones: ["Sensor kits assembled", "Publish maintenance notes"], proof: true, campaignStatus: "MILESTONE_REVIEW", status: "EVIDENCE_SUBMITTED" },
  { key: "review", title: "School garden sensor delivery", goal: 4n, backing: 4n, milestones: ["Sensor kits assembled", "Publish field notes"], proof: true, review: true, campaignStatus: "MILESTONE_REVIEW", status: "MILESTONE_REVIEW" },
  { key: "cancelled", title: "Community workshop pilot", goal: 4n, backing: 1n, milestones: ["Book the workshop venue"], cancel: true, campaignStatus: "CANCELLED", status: "PENDING" },
  { key: "frozen", title: "Wetland monitoring equipment", goal: 4n, backing: 4n, milestones: ["Sensor kits assembled", "Publish installation notes"], proof: true, review: true, freeze: true, campaignStatus: "MILESTONE_REVIEW", status: "FROZEN" },
];

if (!process.argv.includes("--submit")) {
  console.log(specs.map(({key, campaignStatus, status}) => ({key, campaignStatus, status})));
  process.exit(0);
}

const keyFile = process.env.MF_DEMO_SIGNERS;
if (!keyFile) throw Error("Set MF_DEMO_SIGNERS to a private file outside the repository");
let keys;
try {
  keys = JSON.parse(readFileSync(keyFile, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  keys = Object.fromEntries(specs.map(({key}) => [key, {
    creator: generatePrivateKey(), backer: generatePrivateKey(),
  }]));
  writeFileSync(keyFile, JSON.stringify(keys), {flag: "wx", mode: 0o600});
}

const folder = "evidence/two-stage/demo";
mkdirSync(folder, {recursive: true});
const deployment = JSON.parse(readFileSync("evidence/two-stage/deployment.json", "utf8"));
const address = deployment.contractAddress;
const source = readFileSync("contracts/milestone_fund.py", "utf8");
const hash = createHash("sha256").update(source).digest("hex");
if (hash !== deployment.contractSha256) throw Error("Deployment manifest source mismatch");
const reader = createClient({chain: studionet});
if (Number(await reader.request({method: "eth_chainId"})) !== 61999) throw Error("Wrong chain");
const deployed = await reader.request({method: "gen_getContractCode", params: [address]});
if (deployed !== source && Buffer.from(deployed, "base64").toString("utf8") !== source) {
  throw Error("Deployed code differs from the demo script's contract source");
}
const GEN = 10n ** 18n;
const fixture = "https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/463b0ac268e44952c3b9a5f41fe007f4f632d4f0/docs/evidence/paired/";
const json = value => JSON.stringify(value, (_, item) => typeof item === "bigint" ? item.toString() : item, 2);
const read = async (functionName, args = []) => JSON.parse(await reader.readContract({
  address, functionName, args, transactionHashVariant: "latest-final",
}));

async function run(spec) {
  const journalPath = `${folder}/${spec.key}.json`;
  const creator = createAccount(keys[spec.key].creator);
  const backer = createAccount(keys[spec.key].backer);
  const writer = Object.fromEntries(Object.entries({creator, backer}).map(([role, account]) =>
    [role, createClient({chain: studionet, account})]));
  let journal = {contractAddress: address, isDemoFixture: true, scenario: spec.key, transactions: {}};
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const save = () => writeFileSync(journalPath, json(journal) + "\n");

  async function send(step, role, functionName, args, value = 0n) {
    const entry = journal.transactions[step] ??= {functionName, args, valueWei: String(value)};
    if (entry.result) return entry.result;
    if (!entry.hash) {
      entry.hash = await writer[role].writeContract({address, functionName, args, value, leaderOnly: false});
      save();
      console.log(spec.key, step, entry.hash);
    }
    const receipt = await reader.waitForTransactionReceipt({
      hash: entry.hash, status: TransactionStatus.FINALIZED, retries: 120, interval: 4000,
    });
    entry.proof = assertSuccessfulReceipt(receipt);
    const result = readReturnedObject(receipt);
    if (!result || result.accepted === false) throw Error(`${step}: ${json(result)}`);
    entry.result = result;
    save();
    return result;
  }

  const title = `[Demo] ${spec.title}`;
  const amount = spec.goal * GEN / BigInt(spec.milestones.length);
  const milestones = spec.milestones.map(title => ({title, amount: String(amount)}));
  const created = await send("create", "creator", "create_campaign", [title, String(spec.goal * GEN), json(milestones)]);
  const id = BigInt(created.id);
  const stake = spec.backing * GEN;
  if (!journal.transactions.back?.hash && BigInt(await reader.getBalance({address: backer.address})) < stake + GEN) {
    await writer.backer.request({method: "sim_fundAccount", params: [backer.address, 10 * 10 ** 18]});
  }
  await send("back", "backer", "back_campaign", [id], stake);
  const date = journal.transactions.proof?.args?.[3] ?? new Date().toISOString().slice(0, 10);
  if (spec.proof) {
    await send("proof", "creator", "submit_milestone_proof",
      [id, 0, "Controlled demo fixture describing sensor kit delivery.", date, fixture + "original.md"]);
  }
  if (spec.review) await send("review", "backer", "review_milestone", [id, 0]);
  if (spec.cancel) {
    await send("cancel", "creator", "cancel_campaign", [id]);
    await send("withdraw", "backer", "withdraw_payout", []);
  }
  if (spec.freeze) {
    const filed = await send("file", "backer", "file_challenge",
      [id, 0, "Controlled demo fixture documenting contradictory delivery evidence.", date, fixture + "counter.md"], GEN);
    await send("challenge-review", "backer", "review_challenge", [id, 0, BigInt(filed.challenge_id)]);
  }
  journal.campaign = await read("get_campaign", [id]);
  if (journal.campaign.status !== spec.campaignStatus || journal.campaign.milestones[0].status !== spec.status) {
    save();
    throw Error(`Unexpected campaign/milestone status for ${spec.key}: ${journal.campaign.status}/${journal.campaign.milestones[0].status}`);
  }
  journal.complete = true;
  save();
  console.log("VERIFIED", spec.key, id.toString());
}

const selected = specs.filter(spec => !process.env.MF_DEMO_CASE || spec.key === process.env.MF_DEMO_CASE);
if (!selected.length) throw Error("Unknown demo case");
const results = await Promise.allSettled(selected.map(run));
for (const [i, result] of results.entries()) {
  if (result.status === "rejected") {
    console.error(selected[i].key, result.reason);
    process.exitCode = 1;
  }
}
const totals = await read("get_totals");
const actualBalanceWei = String(await reader.getBalance({address}));
const sum = BigInt(totals.escrow_locked_wei) + BigInt(totals.credits_outstanding_wei) + BigInt(totals.challenge_stakes_locked_wei);
if (!totals.invariant_ok || sum !== BigInt(actualBalanceWei)) throw Error("Final balance does not reconcile");
writeFileSync(`${folder}/ledger.json`, json({address, actualBalanceWei, totals, readAt: new Date().toISOString()}) + "\n");
