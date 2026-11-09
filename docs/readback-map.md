# Frontend readback map (Gate 11)

Every value the site displays or exports comes from a `get_*` readback
after a FINALIZED transaction. There is no other source: no static
data, no seed data, no local simulation, no locally computed
allocation, no default that looks like a value.

## How the page boots (cold start)

1. The page loads with empty containers: no campaign title, no raised
   amount, no verdict, no money. The story line says "Reading the
   campaign from Studionet…".
2. `refreshAll()` reads `get_count`, then `list_campaigns(0, 20)`,
   then `get_totals`. Only when all three return is `lastReadback`
   set — and only then is the dossier button enabled.
3. If any read fails, the story line shows the error and the page
   keeps showing placeholders ("—" / "No campaigns on chain yet"
   is only shown after a successful read that returns zero campaigns).

## Displayed fields → readback source

| Displayed field | Readback source | Before readback |
|---|---|---|
| Campaign title / goal / raised / escrow / backers | `list_campaigns` → campaign record | empty container |
| Milestone amount | `list_campaigns` → `milestones[i].amount` | empty container |
| Milestone status + verdict | `list_campaigns` → `milestones[i].status` / `final_verdict` / `pending_verdict` | empty container |
| Pending verdict money | never shown as a number | "unconfirmed" |
| Settled released / refunded | `list_campaigns` → `milestones[i].released_wei` / `refunded_wei` (terminal states only) | "unconfirmed" |
| Reference URL / snapshot hash / snapshot length / GitHub SHA / quote / review date | `list_campaigns` → `milestones[i].reference_url` / `snapshot_hash` / `snapshot_len` / `github_sha` / `quote` / `review_date` | not rendered |
| Review rounds | `list_campaigns` → `milestones[i].evaluations[]` | not rendered |
| Backer leaderboard | `get_supporter_board(10)` | "No backers yet." (after a successful empty read) |
| Your credit / backed / completed | `get_supporter(address)` for the connected wallet or test account | "—" |
| Withdraw preview + button state | `get_supporter(address).credit_wei` | button disabled, "Nothing to withdraw yet" |
| Contract totals (dossier only) | `get_totals` | dossier button disabled |

## Verdict branches (exhaustive — the contract's states, one each)

- `PENDING` / `EVIDENCE_SUBMITTED`: status line only, no verdict, no money.
- `MILESTONE_REVIEW`: "pending verdict: X · unconfirmed"; released/refunded shown as "unconfirmed", never as numbers.
- `FROZEN`: "Frozen — contradiction · unconfirmed"; both witness verdicts shown; no money.
- `RELEASED` (`ACCEPT`): success style; released/refunded from the readback.
- `REFUNDED` (`REJECT`): refund style; released 0, refunded from the readback.
- `PARTIAL_RELEASED` (`PARTIAL`): amber `stage-partial` style, never the success style; released/refunded copied from the readback (the contract's defined 50/50 settlement of a terminal PARTIAL verdict).
- `CANCELLED` (campaign): no milestone money; backers' refund is their withdrawable credit from `get_supporter`.

## Export (dossier)

- The dossier button is disabled until `lastReadback` exists.
- `buildDossier({ campaign, totals, readAt })` copies values verbatim
  from those two readbacks and does no arithmetic on them.
- A pending or frozen milestone exports `released_wei: null`,
  `refunded_wei: null`, `confirmed: false`.
- A settled PARTIAL exports `outcome: "PARTIAL"`, `success: false`,
  with the readback's released/refunded amounts.
- Only a settled ACCEPT exports `success: true`.
- No readback → `buildDossier` throws and nothing is downloaded.
- Tests: `tests/dossier.test.mjs` (8 tests: no-readback, ACCEPT,
  REJECT, PARTIAL, pending, FROZEN, unknown verdict, 1:1 copy).
  Run: `node tests/dossier.test.mjs`.

## What is NOT a readback value

- The "confirmable from the next UTC day" note next to a review date
  is a restatement of the contract's challenge-window rule, computed
  from the readback's `review_date`; it is not a money or verdict
  value.
- The faucet link, wallet state, and transaction feed are session
  facts (what the user did in this browser session), not contract
  values; the feed only lists transactions this session submitted,
  each with its explorer link and FINALIZED status.
