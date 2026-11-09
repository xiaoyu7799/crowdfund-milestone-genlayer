// MilestoneFund dossier builder (Gate 11).
//
// The dossier is a read-back-only export: every value in it is copied
// verbatim from a FINALIZED get_* readback (get_campaign + get_totals).
// Nothing is recomputed locally, nothing comes from static data, a
// seed, a preview, or a default.
//
// Rules enforced here (and covered by tests/dossier.test.mjs):
// - No readback, no dossier: buildDossier throws unless it is handed
//   a campaign record and a totals record that came from a readback.
// - Verdicts are exhaustive. The contract has three verdicts plus two
//   non-terminal states, and the dossier has a branch for each:
//   ACCEPT / REJECT / PARTIAL / pending (no final verdict yet) /
//   FROZEN (contradiction, awaiting the tie-break).
// - A pending or frozen milestone never carries money in the dossier:
//   released_wei / refunded_wei are null and confirmed is false.
//   "Unconfirmed" is the only thing a pending verdict may display.
// - PARTIAL is its own outcome, never a success: success is false,
//   the released/refunded amounts are copied verbatim from the
//   readback (the contract's defined 50/50 settlement of a terminal
//   PARTIAL verdict), and the dossier never marks it successful.
// - ACCEPT is a success only when the readback says status RELEASED
//   with final_verdict ACCEPT. REJECT is never a success.
// - Amounts are copied as the exact wei strings from the readback;
//   the builder does no arithmetic on them at all.
export const DOSSIER_VERSION = 1;

const TERMINAL = ["RELEASED", "REFUNDED", "PARTIAL_RELEASED"];

function milestoneEntry(campaign, m, index) {
  const base = {
    index,
    title: m.title,
    amount_wei: m.amount,
    status: m.status,
    reference_url: m.reference_url ?? null,
    snapshot_hash: m.snapshot_hash ?? null,
    snapshot_len: m.snapshot_len ?? null,
    github_sha: m.github_sha ?? null,
    quote: m.quote ?? null,
    review_date: m.review_date ?? null,
    evaluations: (m.evaluations || []).map((e) => ({
      round: e.round,
      source: e.source ?? null,
      reference_url: e.reference_url ?? null,
      snapshot_hash: e.snapshot_hash ?? null,
      github_sha: e.github_sha ?? null,
      flags: e.flags,
      quote: e.quote ?? null,
      verdict: e.verdict,
    })),
  };
  if (!TERMINAL.includes(m.status)) {
    // Pending / frozen / awaiting evidence: no money is confirmed.
    return {
      ...base,
      outcome: m.status === "FROZEN" ? "FROZEN" : "PENDING",
      final_verdict: m.final_verdict ?? null,
      pending_verdict: m.pending_verdict ?? null,
      released_wei: null,
      refunded_wei: null,
      refund_payouts: null,
      confirmed: false,
      success: false,
    };
  }
  const verdict = m.final_verdict;
  if (verdict !== "ACCEPT" && verdict !== "REJECT" && verdict !== "PARTIAL") {
    throw new Error(`dossier: settled milestone ${index} has unknown verdict ${verdict}`);
  }
  return {
    ...base,
    outcome: verdict,
    final_verdict: verdict,
    pending_verdict: null,
    released_wei: m.released_wei,
    refunded_wei: m.refunded_wei,
    refund_payouts: m.refund_payouts || [],
    confirmed: true,
    // Only a terminal ACCEPT is a success. PARTIAL is a terminal
    // split, not a success; REJECT is a refund, not a success.
    success: verdict === "ACCEPT" && m.status === "RELEASED",
  };
}

export function buildDossier(readback) {
  if (!readback || typeof readback !== "object") {
    throw new Error("dossier: no readback — nothing to export");
  }
  const { campaign, totals, readAt } = readback;
  if (!campaign || typeof campaign !== "object" || !totals || typeof totals !== "object") {
    throw new Error("dossier: no readback — nothing to export");
  }
  if (!readAt) {
    throw new Error("dossier: readback has no timestamp — nothing to export");
  }
  const milestones = (campaign.milestones || []).map((m, i) => milestoneEntry(campaign, m, i));
  return {
    dossier_version: DOSSIER_VERSION,
    generated_from: "FINALIZED get_campaign + get_totals readback",
    read_at: readAt,
    network: "Stable Studionet",
    chain_id: 61999,
    campaign: {
      id: campaign.id,
      title: campaign.title,
      creator: campaign.creator,
      goal_wei: campaign.goal_wei,
      total_backed_wei: campaign.total_backed_wei,
      escrow_wei: campaign.escrow_wei,
      status: campaign.status,
      backers: campaign.backers || [],
    },
    milestones,
    all_settled: milestones.every((m) => m.confirmed),
    totals: {
      total_received_wei: totals.total_received_wei,
      total_withdrawn_wei: totals.total_withdrawn_wei,
      credits_outstanding_wei: totals.credits_outstanding_wei,
      escrow_locked_wei: totals.escrow_locked_wei,
      contract_balance_wei: totals.contract_balance_wei,
      invariant_ok: totals.invariant_ok,
    },
  };
}
