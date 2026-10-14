/**
 * netlify/functions/send-weekly-dispatch-retry.js
 * Second scheduled slot for send-weekly-dispatch (13:30 UTC Fridays). Same handler;
 * the MailerLite campaign-name check makes it a no-op if the 12:30 UTC run sent.
 */
exports.handler = require('./send-weekly-dispatch.js').handler;
