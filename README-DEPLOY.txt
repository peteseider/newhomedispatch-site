NEW HOME DISPATCH, Oct 12 conversion update
============================================

One drag, one click:

1. Open https://github.com/peteseider/newhomedispatch-site/upload/main
   (you are already signed in as peteseider).
2. Drag EVERYTHING inside this folder (the files AND the "netlify" folder)
   onto the upload area. Keep the folder structure: netlify/functions/... must
   stay nested. 19 files total.
3. Commit message: "Conversion pass: Talk to Pete sitewide, daily email, cleanup"
4. Click "Commit changes". Netlify deploys in about a minute.

What this ships:
- buyer-strategy-call.html   Rewritten. Pete first, Calendly first, form second.
- nav.js                     "Talk to Pete" block above the footer on every data page.
- daily-hot-sheet.html       Loads nav.js (gets the block + tap-to-open menus).
- index.html, dispatch-cta.js, subscribe-dispatch.html, thanks-dispatch.html
                             The email product is now the Daily Hot Sheet by email,
                             every morning (the thing that actually ships), not a
                             Friday issue that never did.
- netlify/functions/send-hot-sheet-email.js (+ -retry.js), netlify.toml
                             The daily email send. Runs 12:30 UTC daily. DRY-RUN
                             until the Netlify env var HOTSHEET_EMAIL_LIVE=true.
- _redirects, sitemap.xml    preference-center + incentive-watch fold into the
                             subscribe page; dashboard.html redirects home.
- share-kit.html, for-agents.html   noindex.
- reports.html               "Coming soon" Field Notes block removed.
- start-here, buyer-guides, get-guides   One Playbook email policy: no email required.
- communities.html           Fix: a GA event param was polluting traffic sources.
