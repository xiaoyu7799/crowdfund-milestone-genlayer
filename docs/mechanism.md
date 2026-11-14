# Source and evidence versions

Current deployed source and live checks are identified by deployment.json and evidence/paired-validation.json. Earlier receipts remain under evidence/history. Original reference content is re-fetched for challenges; hashes identify each round, not a permanent archive of mutable web pages.

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

## The anchor: evidence is fetched, not trusted

The failure this design is built around: a reference URL that nobody
fetches is not evidence. A creator could previously write any URL
(a placeholder domain, an unrelated page) into the evidence text and
the contract would judge the text, not the link — and release the
money.

So the rule is: **the validators fetch the reference URL and judge
only what it serves.** The creator's own evidence text is a claim,
never a proof: it is stored for humans to read, it is hashed at
submit time, and it is never sent to the LLM. No key fact of a good
result may come from self-written text, and no self-reported number
(counts, amounts) is ever an input to the verdict.

Each review, the leader and every validator independently:

1. Fetch the current UTC date from the time API.
2. Fetch the reference URL and take a snapshot of what it actually
   serves (the full body; only the first 4000 characters are judged,
   and content beyond that window does not count towards the verdict).
3. If the URL points at a GitHub file — `raw.githubusercontent.com`
   or a `github.com` blob page — query the GitHub API contents
   endpoint for that path and branch, require the returned path to
   match and the object to be a file, and record the blob SHA. A
   GitHub URL whose file does not exist fails the review before any
   write.
4. Ask the LLM to judge ONLY the snapshot against the milestone
   title, and to return one quotation copied character for character
   from the snapshot. A quotation that is not a verbatim substring of
   the snapshot fails the review.

A placeholder domain serves a snapshot that names nothing and
describes nothing finished, so it scores 0 of 3 and is REJECTed with
0 released. An unrelated real page fails the same way. A prompt
injection hidden in the creator's text cannot reach the judge at
all, because the text is never in the prompt; an injection hidden in
the snapshot itself is treated as untrusted data and ignored.

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
  "goal_wei": "20000000000000000000",
  "status": "MILESTONE_REVIEW",
  "total_backed_wei": "20000000000000000000",
  "escrow_wei": "0",
  "backers": [{"address": "0x…", "amount": "12000000000000000000"}],
  "milestones": [
    {
      "title": "Sensor kits assembled",
      "amount": "8000000000000000000",
      "status": "RELEASED",
      "evidence_text": "…",
      "evidence_date": "2026-11-09",
      "evidence_hash": "…",
      "reference_url": "https://raw.githubusercontent.com/…/delivery-sensor-kits.md",
      "snapshot_hash": "…",
      "snapshot_len": 401,
      "snapshot_excerpt": "…",
      "github_sha": "…",
      "quote": "…",
      "review_date": "2026-11-09",
      "challenge_evidence": null,
      "evaluations": [{"round": 1, "source": "evidence", "reference_url": "…", "snapshot_hash": "…", "snapshot_len": 401, "github_sha": "…", "flags": ["true", "true", "true"], "quote": "…", "rationale": "…", "current_date": "2026-11-09", "verdict": "ACCEPT"}],
      "pending_verdict": null,
      "final_verdict": "ACCEPT",
      "released_wei": "9000000000000000000",
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

Campaign statuses: `FUNDING` → `MILESTONE_REVIEW` (fully funded), or
`CANCELLED` (see below).
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
  becomes `MILESTONE_REVIEW` and milestones open. An invalid backing
  (zero value, unknown campaign, campaign not funding, backing over
  the goal) is rejected with the full value credited back to the
  sender as a withdrawable credit — see "Failed payments" below.
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
  `challenge_milestone`. A challenge that cannot be accepted (wrong
  stake, wrong sender, milestone not challengeable, invalid
  counter-evidence) is rejected with the full stake credited back to
  the sender; a challenge whose adjudication fails (fetch down, stale
  evidence, judge failure) is rejected the same way and the milestone
  stays challengeable. Failed challenge (second verdict equals the
  first): the 1 GEN is forfeited into the current milestone's
  allocation, so the settlement pool is the milestone amount plus
  1 GEN, split by the same verdict rules. Successful challenge
  (verdicts differ): the milestone freezes, the stake returns plus a
  reward capped at min(0.5 GEN, milestone amount, available escrow), rounded down to even wei taken from the milestone
  escrow, and the remaining settlement pool is the milestone amount
  minus the actual reward. Stake and reward are even wei, so a
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

## Failed payments never swallow GEN

Platform fact, verified on chain during the rescue: on Stable
Studionet a payable call that raises keeps the value in the contract
while the state reverts. A 1 GEN backing sent to a fully funded
campaign was observed to leave the sender's balance and sit in the
contract with no owner, while the contract's own accounting still
balanced. So this contract never raises while it holds value:

- The two payable entry points (`back_campaign`,
  `challenge_milestone`) validate first and, on any invalid input,
  return `{"accepted": false, "reason": ...}` with the full value
  credited back to the sender as a withdrawable credit. The
  transaction FINALIZES as a rejection, not as an error.
- If a challenge's adjudication itself fails (reference fetch down,
  stale counter-evidence, judge failure), the failure is caught and
  the 1 GEN stake is credited back the same way; the milestone is
  unchanged and stays challengeable, and the unjudged
  counter-evidence is not stored.
- Non-payable writes credit back any GEN sent to them before doing
  anything else and refuse the call; `withdraw_payout` credits the
  GEN back and then proceeds with the withdrawal.
- The accounting invariant still holds with refunds: every wei ever
  received (backings, stakes, and refunded invalid payments) equals
  withdrawn + credits outstanding + escrow locked, and the contract
  balance equals credits outstanding plus escrow locked — no wei is
  ever held without an owner.

## Standing (history, not a score)

There is no starting reputation and no points. What the contract
records per address is history: total GEN ever backed, milestones
completed as a backer, campaigns created, milestones released as a
creator, challenges won and lost. History is what it is; it is never
spent, never a gate, and no penalty can lock an address out of
participating. No action requires a minimum balance or a minimum
standing. The only balance-gated action is challenging, which requires
exactly 1 GEN sent with the call.

## Who can call what (enforced in the contract)

| Operation | Who may call it | What a stranger gets |
|---|---|---|
| `create_campaign` | anyone (becomes the creator) | — |
| `back_campaign` | anyone except the creator | self-backing payment credited back |
| `submit_milestone_proof` | only the campaign creator | `only_creator_submits_evidence` |
| `review_milestone` | only a backer other than the creator | `only_backer_reviews` |
| `confirm_milestone` | only a backer, not the creator, and only from the next UTC day after `review_date` | `only_backer_confirms` / `creator_cannot_confirm_own_release` / `challenge_window_open` |
| `challenge_milestone` | only a backer, not the creator, with exactly 1 GEN and new counter-evidence | `only_backer_challenges` / `creator_cannot_challenge_own_milestone` / `challenge_stake_must_be_1_gen` |
| `resolve_disputed_milestone` | only a backer, not the creator | `only_backer_resolves` / `creator_cannot_resolve_own_dispute` |
| `cancel_campaign` | creator (FUNDING, or MILESTONE_REVIEW with all milestones PENDING); any backer while FUNDING | `only_creator_or_backer_cancels` / `only_creator_cancels` |
| `withdraw_payout` | anyone, but only their own credit | `no_credit_to_withdraw` |

The creator can never review, confirm, challenge or resolve their own
milestone's release: the money moves only on a backer's call, after a
validator verdict, and a confirm can never settle the same UTC day
the verdict was made.

## Review (nondet + consensus)

`review_milestone` (round 1) judges the milestone's own evidence.
`challenge_milestone` (round 2) fetches original and new counter-evidence
and evaluates them together. A separate `rebuts_original` flag must be
true under independent validator agreement: unrelated pages, placeholders
and corroboration without corrective facts are rejected with the stake
credited back. Both snapshot hashes, GitHub SHAs and verbatim quotes are
checked. The original quote and rebuttal flag are included in the witness. A challenge that
disagrees freezes the milestone; `resolve_disputed_milestone`
(round 3) re-fetches and compares both evidence references and its
verdict is the tie-break. All three rounds stay in the record as
witness.

Each round runs the same adjudication:

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
3. Resolve the reference URL. For a GitHub file URL, query the
   GitHub API contents endpoint and require the path to match and
   the object to be a file; record the blob SHA. Any other https URL
   is used as-is with an empty SHA. A fetch failure or a non-200
   raises before any write.
4. Fetch the reference URL and take the snapshot (the first 4000
   characters are judged; the full length is recorded). Hash it with
   the pure-Python SHA-256.
5. Judge ONLY the snapshot with an LLM against three strict binary
   criteria (definitions are in the prompt, applied strictly):
   - `deliverable_named`: the snapshot itself names one concrete
     deliverable matching the milestone title. Vague words do not
     count.
   - `completion_described`: the snapshot itself describes work
     already finished. A plan or promise does not count.
   - `corroborating_detail`: the snapshot itself contains
     independently checkable detail beyond the claim: a commit SHA,
     a version or tag, a dated log line, a measurement with units,
     or a second checkable link. A bare count of items named in the
     milestone title does not count. The detail must be about this
     milestone's deliverable; detail about an unrelated topic does
     not count.
   The LLM also returns one quotation copied character for character
   from the snapshot, plus one rationale sentence. The creator's
   evidence text is not in the prompt at all.
6. The contract — never the LLM — computes the verdict from the
   agreed flags: 3 of 3 → `ACCEPT`, 2 of 3 → `PARTIAL`, 0–1 of 3 →
   `REJECT`.

A validator accepts a leader result only if ALL of these hold:

1. the leader's `evidence_hash` equals the hash of the evidence
   text being judged (pure-Python SHA-256, computed in the
   contract);
2. the leader's `current_date` equals the validator's own
   independently fetched date, exactly;
3. the leader's `reference_url` equals the submitted URL, exactly;
4. the leader's `snapshot_hash` and `snapshot_len` equal the
   validator's own independently fetched values, exactly;
5. the leader's `github_sha` equals the validator's own
   independently queried GitHub API value, exactly;
6. the leader's `quote` is a verbatim substring of the validator's
   own snapshot;
7. the verdict derived from the leader's three flags equals the
   verdict derived from the validator's own three flags, exactly.
   The raw flags need not be identical: the money follows the
   verdict, and two validators may legitimately disagree on one
   diagnostic flag while agreeing on the verdict. Observed on chain
   2026-11-10: an unrelated real page split validators between
   [false, false, false] and [false, false, true] — both REJECT —
   and the earlier flag-exact check deadlocked that milestone for
   three rounds with no verdict and no way forward. A split that
   changes the verdict (e.g. REJECT vs ACCEPT) still fails
   consensus, by design, rather than paying out on a coin flip.

The rationale is leader-provided witness text for humans to read. It
is not used for the verdict and is not part of the consensus check.
If the leader raised a UserError (time source down, stale evidence,
fetch failure, judge failure), a validator agrees only if its own run
also raises a UserError — agreement that nothing can be judged yet.

## Worst-case spread calculation (required)

The consensus object is the milestone verdict, and the GEN that moves
because of it. The question is: how far apart can two different
leader outputs be, if both pass validation?

- The verdict is a deterministic function of the three flags:
  `ACCEPT` iff flags = [true, true, true]; `PARTIAL` iff exactly two
  are true; `REJECT` otherwise. There are 8 possible flag vectors
  and 3 possible verdicts.
- Validation requires the verdict derived from the leader's flag
  vector to equal the verdict derived from the validator's own
  independently produced vector, exactly. The raw vectors may
  differ: a leader proposing [false, false, false] (REJECT) and a
  leader proposing [false, false, true] (REJECT) both pass a
  validator whose own run produced either vector. The recorded flags
  are the settling leader's; the verdict — the only thing the money
  follows — is the same either way.
- A leader proposing [true, true, false] (PARTIAL) and a leader
  proposing [true, true, true] (ACCEPT) cannot both pass the same
  validator, because the validator's own verdict is one specific
  verdict. Whichever verdict the validators independently converge
  on is the only one that can settle.
- The same exactness holds for the fetched facts: the snapshot hash,
  snapshot length and GitHub SHA must equal the validator's own
  fetch, so two compatible outputs cannot rest on different page
  contents or different repository states. A page that changes
  between fetches makes validation fail and the review retryable; it
  cannot settle on either version silently.
- The quotation is the one deliberate exception: validation requires
  it to be verbatim in the validator's own snapshot, not identical
  to the validator's own quotation. Two compatible outputs may quote
  different sentences of the same snapshot. That is not a spread in
  anything the contract acts on: the quote never affects the flags,
  the verdict, or the money. The spread in verdict and in GEN
  between two validator-compatible leader outputs is therefore still
  exactly zero.
- Edge case, worked: true evidence quality sits exactly on the
  ACCEPT/PARTIAL boundary. Leader X reports [T, T, T] → ACCEPT,
  release 8 GEN. Leader Y reports [T, T, F] → PARTIAL, release
  4 GEN + refund 4 GEN. Both are plausible LLM outputs for
  borderline evidence. Can both pass? No: each validator accepts at
  most the verdict it produced itself. Whichever verdict the validators
  independently converge on is the only one that can settle. The
  other is rejected by validation and the milestone stays open —
  retryable, never silently settled with the losing verdict. The
  residual risk is the mirror image: if validators split across a
  verdict boundary and never converge, the milestone stays open
  indefinitely (no confirm, no challenge, funds escrowed) — a
  liveness limitation, not a safety hole: nothing can be paid out
  without a converged verdict. That is the documented outcome of
  the 2026-11-10 c1-m1 case under the old flag-exact check; the
  verdict-level check removes the deadlock whenever the split is
  inside one verdict.
- Therefore the maximum spread between two validator-compatible leader
  outputs is: **flags may differ within one verdict, 0 in verdict,
  0 GEN in released amount, 0 GEN in refunded amount.** There is no
  tolerance band to straddle, because there is no band at all —
  agreement on the verdict is exact, and the verdict is computed
  from the flags rather than taken from the LLM.
- The money side has no second spread source either. The release and
  refund amounts are deterministic functions of the (unique) verdict
  and the (stored) milestone amount: ACCEPT → amount, PARTIAL →
  amount/2 + amount/2 (exact, amount is even wei), REJECT → 0 +
  amount. The challenge stake is 1 GEN; its reward is deterministically
  capped at min(0.5 GEN, milestone amount, available escrow), rounded down
  to even wei. Neither amount is voted on. Pro-rata refunds are computed once,
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

## Challenge, freeze and the challenge window

- The first review leaves a pending verdict (`MILESTONE_REVIEW`)
  and records `review_date`. Confirming it is only possible from the
  next UTC day: a same-day `confirm_milestone` is rejected on chain
  with `challenge_window_open`. The window runs to the end of the
  review's UTC day. A challenge that agrees with the first verdict
  settles immediately — the challenger themself triggered that
  settlement, so no further window is owed.
- A backer other than the creator may challenge first with
  `challenge_milestone`, sending exactly 1 GEN and submitting NEW
  counter-evidence (text, date and reference URL). Round 2 judges
  both fetched references, requiring a substantive rebuttal.
- Challenge runs a second independent review (round 2). If the
  second verdict equals the first, the challenge fails: the verdict
  settles immediately and the 1 GEN stake is forfeited into the
  milestone's allocation. If it differs, the milestone freezes with
  both verdicts kept as witness, the challenger is credited the
  1 GEN stake plus a reward bounded by 0.5 GEN and the milestone's available escrow, and no settlement
  happens yet.
- A frozen milestone is resolved by `resolve_disputed_milestone`
  (round 3), called by a backer other than the creator. The third
  review re-fetches and compares both evidence references; its
  verdict is the tie-break and settles the milestone over the shrunk
  pool (milestone amount minus actual reward); all three review rounds stay
  in the record as witness. A settled verdict is never overwritten.

## Cancellation before evidence submission

- `FUNDING`: the creator, or any backer, may cancel. Every backer is
  credited their full backing, escrow drains to zero, the campaign
  closes as `CANCELLED`.
- `MILESTONE_REVIEW` with every milestone still `PENDING`: only the
  creator may cancel, with the same full refund.
- Once any milestone has evidence submitted or a settlement, the
  campaign cannot be cancelled: its money moves only by verdict.
  A failed payment never swallows GEN: invalid backings and
  challenges are rejected with the full value credited back to the
  sender (see "Failed payments never swallow GEN" above).
- GEN sent to a non-payable write is credited back before anything
  else and the call is refused.

## What this contract does not do

- It does not custody funds beyond escrow: backers' GEN sits in the
  contract only until the milestone settles, and settled money is a
  credit the beneficiary pulls out themselves.
- It does not prove delivery from the creator's own words: the LLM
  judges the fetched snapshot, and the verdict is only as good as
  the validators' independent agreement on those flags.
- It does not judge snapshot content beyond the first 4000
  characters. Delivery records kept for this contract are short, so
  the whole record is judged; a longer page's tail is not counted
  towards the verdict.
- It does not use a clock. "Current date" comes from a public time
  API fetched independently by leader and validators; if that source
  is down, review waits rather than guessing. The challenge window
  is one UTC day measured by that same fetched date, so a review
  made one minute before midnight UTC has a window of about a
  minute; the window is a floor, not a guarantee of a full day.

## Rebuttal eligibility before delivery scoring

For rounds 2 and 3, both fetched snapshots, dates, hashes, GitHub identities,
quotes and rebuttal eligibility must agree independently. If the counter page
is not a rebuttal, the contract always credits back the entire stake and does
not change campaign state. Diagnostic delivery flags are validated for shape
but their derived verdict need not agree in this no-settlement branch: neither
that verdict nor those flags are persisted or used for a payout. For eligible
rebuttals, exact verdict agreement remains mandatory. This avoids a consensus
split over delivery scores that cannot affect the rejected challenge's result.
