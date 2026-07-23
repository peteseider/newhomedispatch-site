# New Home Dispatch — website source

New Home Dispatch is an independent consumer-intelligence platform for
new-construction homebuyers in Austin / Central Texas. Static site, deployed
to Netlify.

The Concession Index and Buyer Advantage Score are designed to republish
twice daily via GitHub Actions (`.github/workflows/incentive-sweep.yml`).

## Structure
- `daily-hot-sheet.html` — the Buyer Decision Terminal (twice-daily read)
- `incentive-tracker.html` — searchable incentive database + Concession Index
- `methodology-buyer-advantage-score.html` — scoring methodology (v0.1)
- `scripts/sweep.mjs` — recomputes the Concession Index + Buyer Advantage Score
- `netlify/functions/` — MailerLite bridge + Twilio check-in functions
- `share/` — generated social graphics (IG + X)

## Deploy
Static drag-drop to Netlify, or (once this repo is linked) auto-deploy on push.
