/* Dossier tests (Gate 11): the export is built only from FINALIZED
 * readback JSON, verdicts are exhaustive, a pending verdict carries no
 * money, and PARTIAL is never a success.
 *
 * Run: node tests/dossier.test.mjs
 * These tests use synthetic readback fixtures shaped exactly like the
 * contract's get_campaign / get_totals output; they do not touch the
 * chain. The on-chain values are verified separately by
 * scripts/verify.mjs against evidence.json.
 */
import assert from "node:assert/strict";
import { buildDossier } from "../site/src/dossier.js";

const GEN = 10n ** 18n;
const wei = (n) => (BigInt(n) * GEN).toString();

function campaignFixture(milestones, status = "MILESTONE_REVIEW") {
  return {
    id: 0,
    title: "Riverside Community Garden sensor network",
    creator: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    goal_wei: wei(20),
    status,
    total_backed_wei: wei(20),
    escrow_wei: "0",
    backers: [
      { address: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", amount: wei(12) },
      { address: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", amount: wei(8) },
    ],
    milestones,
  };
}

const totalsFixture = {
  total_received_wei: wei(21),
  total_withdrawn_wei: "0",
  credits_outstanding_wei: wei(21),
  escrow_locked_wei: "0",
  contract_balance_wei: wei(21),
  invariant_ok: true,
};

const READ_AT = "2026-11-10T00:05:00.000Z";

function settledMilestone(overrides) {
  return {
    title: "Sensor kits assembled",
    amount: wei(8),
    status: "RELEASED",
    evidence_text: "Sensor kits assembled.",
    evidence_date: "2026-11-09",
    evidence_hash: "aabbcc",
    reference_url: "https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/main/docs/evidence/delivery-sensor-kits.md",
    snapshot_hash: "00112233",
    snapshot_len: 401,
    snapshot_excerpt: "12 Riverside garden sensor kits assembled and installed",
    github_sha: "6f51fc5107b59b249780f26c958c5671c48d98c7",
    quote: "12 Riverside garden sensor kits assembled and installed, each reporting live.",
    review_date: "2026-11-09",
    challenge_evidence: null,
    evaluations: [{
      round: 1, source: "evidence",
      reference_url: "https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/main/docs/evidence/delivery-sensor-kits.md",
      snapshot_hash: "00112233", github_sha: "6f51fc5107b59b249780f26c958c5671c48d98c7",
      flags: ["true", "true", "true"],
      quote: "12 Riverside garden sensor kits assembled and installed, each reporting live.",
      verdict: "ACCEPT",
    }],
    pending_verdict: null,
    final_verdict: "ACCEPT",
    released_wei: wei(9),
    refunded_wei: "0",
    refund_payouts: [],
    settlement_wei: null,
    challenge: { challenger: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", stake_wei: wei(1), second_verdict: "ACCEPT", outcome: "FAILED" },
    ...overrides,
  };
}

let passed = 0;
function ok(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok: ${name}`);
}

// 1. No readback, no dossier.
ok("no readback throws", () => {
  assert.throws(() => buildDossier(null), /no readback/);
  assert.throws(() => buildDossier({}), /no readback/);
  assert.throws(() => buildDossier({ campaign: campaignFixture([]), totals: null, readAt: READ_AT }), /no readback/);
  assert.throws(() => buildDossier({ campaign: campaignFixture([]), totals: totalsFixture }), /no timestamp/);
});

// 2. ACCEPT readback -> success, amounts copied verbatim.
ok("ACCEPT dossier is a success with readback amounts", () => {
  const d = buildDossier({ campaign: campaignFixture([settledMilestone()]), totals: totalsFixture, readAt: READ_AT });
  assert.equal(d.milestones[0].outcome, "ACCEPT");
  assert.equal(d.milestones[0].success, true);
  assert.equal(d.milestones[0].confirmed, true);
  assert.equal(d.milestones[0].released_wei, wei(9));
  assert.equal(d.milestones[0].refunded_wei, "0");
  assert.equal(d.milestones[0].github_sha, "6f51fc5107b59b249780f26c958c5671c48d98c7");
  assert.equal(d.milestones[0].quote, "12 Riverside garden sensor kits assembled and installed, each reporting live.");
  assert.equal(d.all_settled, true);
  assert.equal(d.totals.total_received_wei, wei(21));
  assert.equal(d.generated_from, "FINALIZED get_campaign + get_totals readback");
});

// 3. REJECT readback -> not a success, refund copied verbatim.
ok("REJECT dossier is not a success", () => {
  const m = settledMilestone({
    title: "Dashboard live",
    status: "REFUNDED",
    final_verdict: "REJECT",
    released_wei: "0",
    refunded_wei: wei(8),
    refund_payouts: [
      { address: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", amount_wei: "4800000000000000000" },
    ],
    evaluations: [{
      round: 1, source: "evidence", reference_url: "https://example.org",
      snapshot_hash: "deadbeef", github_sha: "",
      flags: ["false", "false", "false"], quote: "Example Domain", verdict: "REJECT",
    }],
    reference_url: "https://example.org",
    github_sha: "",
    quote: "Example Domain",
  });
  const d = buildDossier({ campaign: campaignFixture([m]), totals: totalsFixture, readAt: READ_AT });
  assert.equal(d.milestones[0].outcome, "REJECT");
  assert.equal(d.milestones[0].success, false);
  assert.equal(d.milestones[0].released_wei, "0");
  assert.equal(d.milestones[0].refunded_wei, wei(8));
});

// 4. PARTIAL settled -> own outcome, not a success, split copied verbatim.
ok("PARTIAL dossier is not a success, split copied verbatim", () => {
  const m = settledMilestone({
    title: "Field report published",
    amount: wei(4),
    status: "PARTIAL_RELEASED",
    final_verdict: "PARTIAL",
    released_wei: wei(2),
    refunded_wei: wei(2),
    refund_payouts: [
      { address: "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", amount_wei: "1200000000000000000" },
      { address: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", amount_wei: "800000000000000000" },
    ],
    evaluations: [{
      round: 1, source: "evidence",
      reference_url: "https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/main/docs/evidence/delivery-field-report.md",
      snapshot_hash: "99887766", github_sha: "6f51fc5107b59b249780f26c958c5671c48d98c7",
      flags: ["true", "true", "false"],
      quote: "The garden field report is published and covers every sensor with weekly readings.",
      verdict: "PARTIAL",
    }],
  });
  const d = buildDossier({ campaign: campaignFixture([m]), totals: totalsFixture, readAt: READ_AT });
  assert.equal(d.milestones[0].outcome, "PARTIAL");
  assert.equal(d.milestones[0].success, false);
  assert.equal(d.milestones[0].confirmed, true);
  assert.equal(d.milestones[0].released_wei, wei(2));
  assert.equal(d.milestones[0].refunded_wei, wei(2));
  assert.equal(d.milestones[0].refund_payouts.length, 2);
});

// 5. Pending verdict -> no money at all, confirmed false.
ok("pending verdict carries no money", () => {
  const m = settledMilestone({
    status: "MILESTONE_REVIEW",
    final_verdict: null,
    pending_verdict: "ACCEPT",
    released_wei: "0",
    refunded_wei: "0",
  });
  const d = buildDossier({ campaign: campaignFixture([m]), totals: totalsFixture, readAt: READ_AT });
  assert.equal(d.milestones[0].outcome, "PENDING");
  assert.equal(d.milestones[0].pending_verdict, "ACCEPT");
  assert.equal(d.milestones[0].released_wei, null);
  assert.equal(d.milestones[0].refunded_wei, null);
  assert.equal(d.milestones[0].refund_payouts, null);
  assert.equal(d.milestones[0].confirmed, false);
  assert.equal(d.milestones[0].success, false);
  assert.equal(d.all_settled, false);
});

// 6. FROZEN -> own outcome, no money, witness kept.
ok("FROZEN dossier keeps the witness and no money", () => {
  const m = settledMilestone({
    status: "FROZEN",
    final_verdict: null,
    pending_verdict: "REJECT",
    released_wei: "0",
    refunded_wei: "0",
    evaluations: [
      { round: 1, source: "evidence", reference_url: "https://example.org", snapshot_hash: "aa", github_sha: "", flags: ["false", "false", "false"], quote: "Example Domain", verdict: "REJECT" },
      { round: 2, source: "challenge", reference_url: "https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/main/docs/evidence/delivery-sensor-kits.md", snapshot_hash: "bb", github_sha: "6f51fc5107b59b249780f26c958c5671c48d98c7", flags: ["true", "true", "true"], quote: "12 Riverside garden sensor kits assembled and installed, each reporting live.", verdict: "ACCEPT" },
    ],
    challenge: { challenger: "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC", stake_wei: wei(1), reward_wei: "500000000000000000", second_verdict: "ACCEPT", outcome: "WON_FROZEN" },
  });
  const d = buildDossier({ campaign: campaignFixture([m]), totals: totalsFixture, readAt: READ_AT });
  assert.equal(d.milestones[0].outcome, "FROZEN");
  assert.equal(d.milestones[0].released_wei, null);
  assert.equal(d.milestones[0].confirmed, false);
  assert.equal(d.milestones[0].evaluations.length, 2);
  assert.equal(d.milestones[0].evaluations[1].verdict, "ACCEPT");
});

// 7. A settled milestone with an unknown verdict throws (exhaustive).
ok("unknown settled verdict throws", () => {
  const m = settledMilestone({ final_verdict: "MAYBE" });
  assert.throws(
    () => buildDossier({ campaign: campaignFixture([m]), totals: totalsFixture, readAt: READ_AT }),
    /unknown verdict/,
  );
});

// 8. Dossier never recomputes: changing a readback value changes the dossier 1:1.
ok("dossier copies readback values 1:1", () => {
  const totals2 = { ...totalsFixture, total_received_wei: wei(34) };
  const d = buildDossier({ campaign: campaignFixture([settledMilestone()]), totals: totals2, readAt: READ_AT });
  assert.equal(d.totals.total_received_wei, wei(34));
  assert.equal(d.campaign.goal_wei, wei(20));
});

console.log(`\n${passed} dossier tests passed`);
