# Challenge and signer security checks

The updated source requires a fresh Stable Studionet deployment. Historical
receipts remain unchanged and do not validate these changes.

| Path | Contract / frontend behavior | Local coverage |
| --- | --- | --- |
| Challenge comparison | Fetch both references in rounds 2 and 3; independently verify both hashes, GitHub SHAs, quotations, rebuttal eligibility and corrected verdict | Paired witness hash; missing original fetch; forged leader fields; dispute resolution |
| Irrelevant or non-rebuttal page | Refund full stake without changing campaign state; identical snapshot is also rejected deterministically | Placeholder, unrelated deliverable, corroboration and replay |
| Small milestone | Reward is bounded by 0.5 GEN, milestone amount and campaign escrow, rounded down to even wei | 2 wei, 0.01 GEN, 0.5 GEN and 20 GEN; zero-pool and PARTIAL settlement; accounting reconciliation |
| Creator self-backing | Payment credited back, no backer entry or funding state change | Exact full-payment refund and accounting invariant |
| Creator review | Explicitly refused even with a legacy/hostile creator backer record | Injected sole-creator backer record |
| Independent sole backer | May resolve its own challenge, subject to independent consensus | Challenge, freeze, resolve, repeated resolution rejected |
| Recoverable browser signer | PBKDF2-SHA256 / AES-256-GCM encrypted local storage with export and import; full writer address displayed | Serialization round trip, wrong password, tampering, malformed input, short password |

The semantic test fixtures explicitly supply model verdicts and rebuttal flags.
They exercise decision gates, paired fetches and validator checks, not real LLM
accuracy. Relevant versus irrelevant classification still needs live validator
consensus tests after deployment.

## Reproduce

```sh
npm ci --ignore-scripts
npm test
npm run build-site
npm run i18n
node scripts/deploy.mjs --check
```

The deploy check reads `eth_chainId` and hashes the source without generating
an account or submitting a transaction. `scripts/deploy.mjs --submit` performs
a real deployment and requires separate transaction authorization.
The historical `scripts/flow.mjs` rejects the current source/deployment mismatch
before account creation or any write; it must not be used as updated-source
acceptance evidence.

For browser interaction tests, serve `docs` on localhost port 8765, install
Playwright with Chromium, then run `python3 tests/browser_signer.py`. RPC calls
are blocked by the test so it cannot submit chain transactions. This environment's
Chromium attempt failed at process startup (`socket(): Operation not permitted`);
no browser interaction pass is claimed. See `evidence/local-validation.json`.

## Live validation required

A new contract must match the current source hash on readback. Record FINALIZED
receipts with successful execution and verify state for: a substantive rebuttal
correcting an original verdict, unrelated/non-rebuttal stake refunds, a tiny
milestone reward cap with a separate milestone left untouched, self-backing
refund, creator review refusal, single independent backer resolution and payout
withdrawal. Preserve any failed consensus attempts. Export/import must also be
checked in a browser that can start Chromium. Publish the matching frontend and
enable writes only after the deployment source is verified.
