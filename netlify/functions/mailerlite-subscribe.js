/**
 * netlify/functions/mailerlite-subscribe.js
 *
 * Bridges Netlify Forms -> MailerLite, without touching any of the site's
 * existing HTML/JS. Netlify still captures every submission natively
 * (spam filtering, the Forms dashboard, existing thanks-*.html redirects
 * all keep working exactly as they do today) — this function just also
 * pushes qualifying submissions into MailerLite as a second step.
 *
 * SUBSCRIPTION PREFERENCES (added 2026-07-20, session 3):
 * Forms can now include optional checkboxes so a visitor picks exactly what
 * they want, from one form: `pref_weekly` (Weekly Dispatch), `pref_quarterly`
 * (Quarterly Playbook Update), `pref_dailyhotsheet` (Daily Hot Sheet — the
 * scrubbed incentive-tracker changes). Each form sets its own "primary"
 * preference as a hidden field (always on) and offers the other two as
 * visible optional checkboxes, so submitting subscribe-dispatch.html always
 * gets Weekly Dispatch plus whatever else was checked, get-guides.html
 * always gets Quarterly plus whatever else was checked, etc. If a form has
 * none of the pref_* fields at all (older/other forms), this falls back to
 * FORM_GROUP_MAP's single-group-per-form behavior so nothing existing breaks.
 *
 * WIRING (one-time, in the Netlify dashboard, done by a human — not this
 * function):
 *   1. Site configuration -> Environment variables -> add
 *        MAILERLITE_API_TOKEN = <the personal access token from
 *        MailerLite: Account Settings -> Integrations -> API>
 *      This is the ONE step that has to be done by hand in the Netlify UI —
 *      an API token is a credential, and it doesn't get typed into a
 *      dashboard field by the automation that will go on to use it.
 *      (Already set and confirmed live as of 2026-07-20.)
 *   2. Site configuration -> Forms -> Form notifications -> Add notification
 *        -> Outgoing webhook -> Event: "New form submission" ->
 *        URL: https://newhomedispatch.com/.netlify/functions/mailerlite-subscribe
 *      Set this up once per form you want pushed to MailerLite (see
 *      FORM_GROUP_MAP below) — or one catch-all notification covering all
 *      forms, since this function checks form_name itself and just no-ops
 *      for anything not in the map. (Already set and confirmed live.)
 *
 * GROUP IDS: MailerLite assigns a numeric ID to every group/list you create.
 * Find them under Subscribers -> Groups -> (open a group) -> the ID is in
 * the URL, or via GET https://connect.mailerlite.com/api/groups.
 */

// Group IDs are not secrets (they're just list identifiers, visible in the
// MailerLite UI/URL) so they're hardcoded directly rather than routed
// through env vars — one less setup step. Created 2026-07-20 in the
// "New Home Dispatch" MailerLite account.
const GROUP_IDS = {
  weekly: '193524324269819638',          // Weekly Dispatch
  quarterly: '193524384371049861',       // Guide Signup / Quarterly Playbook Update
  dailyHotSheet: '193542652911682577',   // Daily Hot Sheet
  reportRequests: '193543544099571383',  // Report Requests (per-report "email me the list" forms)
};

// Preference checkbox field name -> group ID. A submission can carry any
// combination of these (hidden "always on" fields + visible optional
// checkboxes) so one form can subscribe someone to multiple lists at once.
// Finer preference groups added 2026-07-23 for the preference center
// (preference-center.html). Create these three groups in MailerLite and set
// their numeric IDs as Netlify env vars: ML_GROUP_EVENING,
// ML_GROUP_MAJOR_ALERTS, ML_GROUP_BUILDER_ALERTS. Until they're set, these
// preferences are still captured in Netlify Forms — they just don't route to a
// dedicated MailerLite group yet (graceful: undefined IDs are filtered out, so
// nothing breaks and the morning/weekly groups keep working).
const OPTIONAL_GROUP_IDS = {
  evening: process.env.ML_GROUP_EVENING,
  majorAlerts: process.env.ML_GROUP_MAJOR_ALERTS,
  builderAlerts: process.env.ML_GROUP_BUILDER_ALERTS,
};

const PREF_FIELD_GROUP_MAP = {
  pref_weekly: GROUP_IDS.weekly,
  pref_quarterly: GROUP_IDS.quarterly,
  pref_dailyhotsheet: GROUP_IDS.dailyHotSheet,
  pref_reportrequests: GROUP_IDS.reportRequests,
  pref_evening: OPTIONAL_GROUP_IDS.evening,
  pref_alerts: OPTIONAL_GROUP_IDS.majorAlerts,
  pref_builderalerts: OPTIONAL_GROUP_IDS.builderAlerts,
};

// Fallback for forms that don't (yet) carry pref_* fields: form `name`
// attribute -> single MailerLite group ID.
const FORM_GROUP_MAP = {
  'weekly-dispatch': GROUP_IDS.weekly,   // subscribe-dispatch.html + playbook-unlock.html
  'guide-signup': GROUP_IDS.quarterly,   // get-guides.html
  // Intentionally NOT auto-subscribed to a marketing list — these are
  // one-off submissions handled by their own email notification, not
  // newsletter growth:
  //   buyer-story, buyer-strategy-call, field-visit-summary,
  //   incentive-report, past-client-story
};

const ML_API_BASE = 'https://connect.mailerlite.com/api';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const token = process.env.MAILERLITE_API_TOKEN;

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    console.error('mailerlite-subscribe: could not parse Netlify form webhook payload', e);
    return { statusCode: 200, body: 'ignored (bad payload)' };
  }

  // Netlify's outgoing form webhook payload shape:
  // { form_name, human_fields: {...}, data: {...}, ... }
  const formName = payload.form_name || (payload.payload && payload.payload.form_name);
  const fields = (payload.data) || (payload.payload && payload.payload.data) || {};

  // Build the group list from whichever pref_* fields came in checked
  // ("yes" — Netlify posts checked-checkbox values, and omits unchecked
  // ones entirely, so presence + truthy value is what matters).
  const prefGroups = Object.keys(PREF_FIELD_GROUP_MAP)
    .filter((key) => {
      const v = fields[key];
      return v === 'yes' || v === 'on' || v === 'true' || v === true;
    })
    .map((key) => PREF_FIELD_GROUP_MAP[key])
    .filter(Boolean);   // drop optional groups whose env-var ID isn't set yet

  const hadPrefFields = Object.keys(PREF_FIELD_GROUP_MAP).some((key) => key in fields);
  const groupIds = prefGroups.length > 0 ? prefGroups : (!hadPrefFields ? [FORM_GROUP_MAP[formName]].filter(Boolean) : []);

  const email = fields.email || fields.Email;

  if (groupIds.length === 0) {
    console.log(`mailerlite-subscribe: form "${formName}" — no preference groups selected/mapped — no-op.`);
    return { statusCode: 200, body: 'ignored (no group selected)' };
  }
  if (!email) {
    console.warn(`mailerlite-subscribe: form "${formName}" submission had no email field — no-op.`);
    return { statusCode: 200, body: 'ignored (no email)' };
  }
  if (!token) {
    console.error('mailerlite-subscribe: MAILERLITE_API_TOKEN is not set — cannot forward subscriber. Set it in Netlify env vars.');
    return { statusCode: 200, body: 'ignored (no API token configured)' };
  }

  // First-name field is `first_name` (underscore) on every current form.
  // Keep a couple of loose fallbacks in case a future form names it
  // differently, but first_name must be checked to actually capture names.
  const name = fields.first_name || fields.name || fields.Name || fields['first-name'] || '';

  try {
    const resp = await fetch(`${ML_API_BASE}/subscribers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        email,
        fields: name ? { name } : undefined,
        groups: groupIds,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`mailerlite-subscribe: MailerLite API returned ${resp.status} for ${email}: ${errText}`);
      // Still 200 back to Netlify — we don't want Netlify to retry-storm on
      // a MailerLite-side error; the submission itself is already safely
      // captured in Netlify Forms regardless of what happens here.
      return { statusCode: 200, body: `logged (mailerlite error ${resp.status})` };
    }

    console.log(`mailerlite-subscribe: added/updated ${email} in group(s) ${groupIds.join(', ')} (form: ${formName}).`);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('mailerlite-subscribe: request to MailerLite failed', err);
    return { statusCode: 200, body: 'logged (request failed)' };
  }
};
