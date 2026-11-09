# Known limitations

- Simulated mGEN only. Balances, escrow, release, and refund are ledger
  entries inside this contract on Stable Studionet. No real
  cryptocurrency is transferred, held, or custodied.
- The verdict is only as good as the validators' independent agreement
  on three binary evidence criteria. Exact flag agreement pins the
  verdict to a single value (see `docs/mechanism.md`), but it cannot
  force the underlying LLM judgement to be right: if a majority of
  validators independently misjudge the same evidence the same way,
  the wrong verdict finalizes. The challenge round is the counterweight.
- Borderline evidence may need retries. When validators disagree on
  even one flag, evaluation fails consensus and the milestone stays
  open; this is the mechanism working, not a bug.
- Evidence links are checked for presence, not resolved. A URL in the
  evidence is a checkable reference for humans; the contract does not
  fetch it.
- "Current date" comes from a public time API
  (`https://timeapi.io/api/Time/current/zone?timeZone=UTC`) fetched
  independently by leader and validators. If that source is down,
  evaluation waits rather than guessing. A midnight rollover during
  evaluation makes validation fail and the evaluation retryable.
- The rationale sentence stored with each evaluation is
  leader-provided witness text for humans to read. It is not used for
  the verdict and is not part of the consensus check.
- The challenge window is "until someone finalizes": there is no clock
  on Studionet, so the window is closed by an explicit finalize call,
  not by time passing.
- The site was verified with the scripted end-to-end flow and HTTP
  checks; the injected-wallet write path in a real desktop browser and
  the 375px layout on a real phone were not tested in this session.
