# New Home Dispatch — Standing Operating Directives

_Last updated: 2026-07-23 afternoon. This file lives in the repo root so every
chat, agent, and future session can find the current operating truth. Update it
whenever cadence, architecture, or standing rules change._

## Publication model (DECIDED 2026-07-23, do not relitigate)
- **Daily Hot Sheet**: publishes every morning. The five-minute read.
- **Incentive Tracker**: data updates twice daily automatically; a **new issue
  publishes every Monday** (weekend is when builders move and buyers tour).
  Between issues, the automatic **Movement Log** on the tracker page shows every
  offer change from the sweep data.
- **Weekly Dispatch**: Friday. Carries the week's key tracker moves + the weekend plan.
- **One-Sheet**: the shareable weekly snapshot tied to Friday.
- Weekly arc: Monday issue opens the week, daily Hot Sheets run through it,
  Friday Dispatch + One-Sheet close it. Twice-daily data powers everything.

## Single-source schedule (IMPORTANT for future edits)
Cadence badges across ALL pages are injected at load by **nav.js** (bottom
section, `SCHEDULE` constant). To change the publication schedule sitewide,
**edit that one constant** — never hand-edit badges across pages again.
Prose mentions of cadence live in: incentive-tracker.html (hero chip + lead),
daily-hot-sheet.html (mast strip), free-tools.html (tracker blurb).

## Automation architecture (all layers verified live 2026-07-23)
1. `.github/workflows/incentive-sweep.yml` — cron ~6:30am/6:30pm CT: runs
   scripts/sweep.mjs → recomputes Concession Index + Buyer Advantage Score,
   stamps run time, commits → Netlify auto-deploys.
2. Pages hydrate every number/stamp/deadline from the committed JSONs at load
   (concession-index.json, score-history.json, incentives.json,
   reporting/sweep-latest.json). No HTML edits needed for data changes.
3. `.github/workflows/social-render.yml` — fires automatically after every sweep
   (workflow_run) + cron backstop: renders the 5 share cards from live data,
   commits to share/.
4. Google Apps Script "NHD Automations" (newhomedispatch@gmail.com, TZ Chicago):
   7am/7pm daily — saves the 5 cards to the Drive folder "Daily Hot Sheet —
   Social Cards", AND a watchdog checks sweep freshness; if stale it restarts
   both workflows via the GitHub API (Script Property GITHUB_TOKEN) and emails
   pete.seider@gmail.com if it cannot.
- The GitHub WEB flow (upload page / web editor) is the source of truth for
  shipping changes. Pete's local Desktop clone is stale at v115 — do not push
  from it (its push script is disabled).

## Brand rules — NON-NEGOTIABLE
- Logo is fixed. Never redesign the wordmark. assets/wordmark-light.png on dark,
  wordmark-dark.png on light. Tagline: "Look Closer." (tagline-light.png on dark).
- NEVER use em/en dashes in buyer-facing copy. Periods, commas, middots. "0 to 100".
- Every sheet orients the reader: what this is, how to read it, why come back.

## Standing directives — every run
1. Social ships with every publish; rotate the 5-card pool (Read, Move, Score
   Explained, One Point/rate, Illusion of a Deal); never overshare one layout.
2. Expand coverage every run: more builders, communities, offers, sources, so the
   index and Movement Log accumulate real moving data points.
3. Education themes: read the rate not the teaser (builder 1.99/2.99 are step
   buydowns or ARMs, verify the term in writing); the incentive is not the
   savings, the delivered price is; ~1% rate ≈ ~10% buying power.
4. Builder claims are not facts. Verify on primary sources before publishing.

## Highest-value next work (in order)
1. **Coverage expansion** — the tracked set (9 records + 22 promos) is the
   thinnest part of the product. More tracked offers = better index, livelier
   Movement Log, stronger Monday issues, better cards. This compounds everything.
2. ANTHROPIC_API_KEY repo secret to enable the sweep's change-detection layer.
3. First Monday issue (Jul 27): treat the tracker page as the issue; lead with
   what changed over the weekend from the Movement Log.
