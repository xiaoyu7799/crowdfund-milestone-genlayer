# MilestoneFund mechanism

## Goal

Crowdfunding that only pays for proven work, in real GEN. Backers fund a
campaign up front with testnet GEN; the GEN sits in escrow and moves only
when GenLayer validators judge the milestone evidence. Delivered work
releases the milestone amount to the creator as a withdrawable credit.
Failed work refunds it pro-rata to backers as withdrawable credits.
Half-proven work splits it down the middle. Every beneficiary pulls
their own GEN out with `withdraw_payout` — the contract never pushes
money on settlement.

## State

All state lives in four JSON documents plus three counters:

- `campaigns_json` — one record per campaign, keyed by id.
- `credits_json` — withdrawable credits per address, in wei.
- `standing_json` — history per address (see below).
- `participants_json` — addresses in first-participation order.
- `total_received_wei`, `total_withdrawn_wei` — wei ever received
  (backings plus challenge stakes) and wei ever paid out.
- `next_id` — next campaign id.

A campaign:

```json
{
  "id": 0,
  "title": "Riverside Community Garden sensor network",
  "creator": "0x…",
  "goal_wei": "100000000000000000000",
  "status": "MILESTONE_REVIEW",
  "total_backed_wei": "100000000000000000000",
  "escrow_wei": "0",
  "backers": [{"address": "0x…", "amount": "60000000000000000000"}],
  "milestones": [
    {
      "title": "Sensor kits assembled",
      "amount": "40000000000000000000",
      "status": "RELEASED",
      "evidence_text": "…",
      "evidence_date": "2026-11-09",
      "evidence_hash": "…",
      "evaluations": [{"round": 1, "flags": ["true", "true", "true"], "rationale": "…", "current_date": "2026-11-09", "verdict": "ACCEPT"}],
      "pending_verdict": null,
      "final_verdict": "ACCEPT",
      "released_wei": "40000000000000000000",
      "refunded_wei": "0",
      "refund_payouts": [],
      "settlement_wei": null,
      "challenge": null
    }
  ]
}
```

All wei amounts are stored as decimal strings, never JSON numbers, so
no precision is lost. 1 GEN = 10^18 wei.

Campaign statuses: `FUNDING` → `MILESTONE_REVIEW` (fully funded).
Milestone statuses: `PENDING` → `EVIDENCE_SUBMITTED` →
`MILESTONE_REVIEW` (pending verdict) → `RELEASED` / `REFUNDED` /
`PARTIAL_RELEASED`, with `FROZEN` reachable from `MILESTONE_REVIEW`
on a contradicting challenge, resolved by a third review.

## Money rules (deterministic, integer-only, real GEN)

- `create_campaign(title, goal_wei, milestones_json)`: 1–6 milestones,
  each amount a positive even wei value, amounts summing to the goal
  exactly. Goal and milestone amounts are passed as decimal wei
  strings.
- `back_campaign(campaign_id)` is payable: the GEN sent with the call
  (`gl.message.value`, wei) is the backing. Any positive amount; backing
  is capped at the goal. At `total_backed_wei == goal_wei` the campaign
  becomes `MILESTONE_REVIEW` and milestones open.
- Settlement on confirmation, computed once in the contract after
  consensus, recorded as credits (wei):
  - `ACCEPT`: the full settlement amount credited to the creator.
  - `REJECT`: the full amount credited pro-rata to backers.
  - `PARTIAL`: half credited to the creator, half pro-rata to backers.
    The settlement amount is even wei, so the split is exact — no
    rounding anywhere.
- Pro-rata refunds use integer division. The remainder (at most one wei
  per backer) goes to the largest backer, first in insertion order on
  ties. The rule is deterministic and fixed in the contract; it is
  never a subject of validator disagreement.
- Challenge stake: exactly 1 GEN (`1000000000000000000` wei), sent with
  `challenge_milestone`. Failed challenge (second verdict equals the
  first): the 1 GEN is forfeited into the current milestone's
  allocation, so the settlement pool is the milestone amount plus
  1 GEN, split by the same verdict rules. Successful challenge
  (verdicts differ): the milestone freezes, the stake returns plus a
  0.5 GEN reward (`500000000000000000` wei) taken from the milestone
  escrow, and the remaining settlement pool is the milestone amount
  minus 0.5 GEN. Both 1 GEN and 0.5 GEN are even wei, so a
  challenge-adjusted settlement stays even and its PARTIAL split
  stays exact.
- `withdraw_payout()`: pull payment. The caller's whole credit is
  zeroed first, then the GEN is transferred to the caller's address.
  A second call finds a zero credit and fails; a failed transfer can
  never pay twice.
- Accounting invariant, readable at any time with `get_totals`:
  `total_received_wei == total_withdrawn_wei + credits_outstanding_wei
  + escrow_locked_wei`. The contract balance (`self.balance`) equals
  credits outstanding plus escrow locked: every wei the contract holds
  is either owed to someone as a credit or locked for an unsettled
  milestone.

## Standing (history, not a score)

There is no starting reputation and no points. What the contract
records per address is history: total GEN ever backed, milestones
completed as a backer, campaigns created, milestones released as a
creator, challenges won and lost. History is what it is; it is never
spent, never a gate, and no penalty can lock an address out of
participating. No action requires a minimum balance or a minimum
standing. The only balance-gated action is challenging, which requires
exactly 1 GEN sent with the call.

## Review (nondet + consensus)

`review_milestone` (round 1) / `challenge_milestone` (round 2) /
`resolve_disputed_milestone` (round 3) all run the same adjudication:

1. Fetch the current UTC date from
   `https://timeapi.io/api/Time/current/zone?timeZone=UTC` and take the
   `dateTime` field's date part. If the fetch fails, returns non-200,
   or is unparseable, raise before any write — the milestone stays
   open and review can be retried.
2. Staleness gate: the evidence date must lie within the 30 days up
   to and including the current date. Future-dated or older evidence
   raises before any write. The creator must then submit fresh
   evidence (resubmission is allowed while the milestone is
   `EVIDENCE_SUBMITTED`).
3. Judge the evidence with an LLM against three strict binary
   criteria (definitions are in the prompt, applied strictly):
   - `deliverable_named`: the evidence names one concrete deliverable
     matching the milestone title. Vague words do not count.
   - `verifiable_reference`: the evidence contains a URL, repository
     path, commit hash, tag, transaction hash, or named file a reader
     could check. A bare number or "tested locally" does not count.
   - `completion_described`: the evidence describes work already
     finished. A plan or promise does not count.
   The LLM returns the three flags plus one rationale sentence.
   Evidence text is treated as untrusted data in the prompt;
   instructions inside it are to be ignored.
4. The contract — never the LLM — computes the verdict from the
   agreed flags: 3 of 3 → `ACCEPT`, 2 of 3 → `PARTIAL`, 0–1 of 3 →
   `REJECT`.

A validator accepts a leader result only if ALL of these hold:

1. the leader's `evidence_hash` equals the hash stored at submit time
   (pure-Python SHA-256 of the evidence text, computed in the
   contract);
2. the leader's `current_date` equals the validator's own
   independently fetched date, exactly;
3. the leader's three flags equal the validator's own three flags,
   exactly — flag for flag.

The rationale is leader-provided witness text for humans to read. It
is not used for the verdict and is not part of the consensus check.
If the leader raised a UserError (time source down, stale evidence,
judge failure), a validator agrees only if its own run also raises a
UserError — agreement that nothing can be judged yet.

## Worst-case spread calculation (required)

The consensus object is the milestone verdict, and the GEN that moves
because of it. The question is: how far apart can two different
leader outputs be, if both pass validation?

- The verdict is a deterministic function of the three flags:
  `ACCEPT` iff flags = [true, true, true]; `PARTIAL` iff exactly two
  are true; `REJECT` otherwise. There are 8 possible flag vectors
  and 3 possible verdicts.
- Validation requires the leader's flag vector to equal the
  validator's own independently produced vector, exactly. So a leader
  proposing [true, true, false] (PARTIAL) passes a given validator
  only if that validator's own run also produced [true, true, false].
  A leader proposing [true, true, true] (ACCEPT) passes the same
  validator only if its own run produced [true, true, true]. Both
  cannot pass the same validator, because the validator's own vector
  is one specific vector.
- Edge case, worked: true evidence quality sits exactly on the
  ACCEPT/PARTIAL boundary. Leader X reports [T, T, T] → ACCEPT,
  release 40 GEN. Leader Y reports [T, T, F] → PARTIAL, release
  20 GEN + refund 20 GEN. Both are plausible LLM outputs for
  borderline evidence. Can both pass? No: each validator accepts at
  most the vector it produced itself. Whichever vector the validators
  independently converge on is the only one that can settle. The
  other is rejected by validation and the milestone stays
  `EVIDENCE_SUBMITTED` (or `MILESTONE_REVIEW` / `FROZEN`) — retryable,
  never silently settled with the losing verdict.
- Therefore the maximum spread between two validator-compatible leader
  outputs is: **0 in flags, 0 in verdict, 0 GEN in released amount,
  0 GEN in refunded amount.** There is no tolerance band to straddle,
  because there is no band at all — agreement is exact, and the
  verdict is computed from the agreed flags rather than taken from
  the LLM.
- The money side has no second spread source either. The release and
  refund amounts are deterministic functions of the (unique) verdict
  and the (stored) milestone amount: ACCEPT → amount, PARTIAL →
  amount/2 + amount/2 (exact, amount is even wei), REJECT → 0 +
  amount. The challenge adjustments are fixed constants (1 GEN stake,
  0.5 GEN reward), not voted on. Pro-rata refunds are computed once,
  in the contract, after consensus, under a fixed remainder rule —
  validators never vote on the split.
- Date spread: the current date must match exactly across leader and
  validators. A midnight rollover during review makes validation
  fail and the review retryable; it cannot produce two different
  accepted dates, because only one date can equal the validator's own
  fetch. The evidence-date window is [current − 30 days, current]:
  an evidence date on either edge is judged by the same exact date
  the validators fetched, so the window cannot admit two different
  verdicts about the same evidence.
- What this does NOT claim: exact flag agreement cannot force the LLM
  to be right. If a majority of validators independently misjudge the
  same evidence the same way, the wrong verdict settles. That is an
  LLM-quality limit, not a tolerance hole — no band exists for a wrong
  leader to hide inside, and the challenge round exists precisely so
  a second independent review can surface disagreement before money
  moves. Borderline evidence may need retries when validators
  disagree; that is the mechanism working, not failing.

## Challenge and freeze

- The first review leaves a pending verdict (`MILESTONE_REVIEW`).
  Anyone may confirm it with `confirm_milestone`; anyone except the
  creator may challenge it first with `challenge_milestone`, sending
  exactly 1 GEN.
- Challenge runs a second independent review (round 2). If the
  second verdict equals the first, the challenge fails: the verdict
  settles immediately and the 1 GEN stake is forfeited into the
  milestone's allocation. If it differs, the milestone freezes with
  both verdicts kept as witness, the challenger is credited the
  1 GEN stake plus a 0.5 GEN reward from escrow, and no settlement
  happens yet.
- A frozen milestone is resolved by `resolve_disputed_milestone`
  (round 3). The third verdict is the tie-break and settles the
  milestone over the shrunk pool (milestone amount minus 0.5 GEN);
  all three review rounds stay in the record as witness. A settled
  verdict is never overwritten.

## What this contract does not do

- It does not custody funds beyond escrow: backers' GEN sits in the
  contract only until the milestone settles, and settled money is a
  credit the beneficiary pulls out themselves.
- It does not prove delivery from the evidence alone: the LLM judges
  the text against strict criteria, and the verdict is only as good
  as the validators' independent agreement on those flags.
- It does not authenticate evidence links by fetching them. A URL in
  the evidence is a checkable reference for humans; the contract
  checks that a reference is present, not that it resolves.
- It does not use a clock. "Current date" comes from a public time
  API fetched independently by leader and validators; if that source
  is down, review waits rather than guessing.
