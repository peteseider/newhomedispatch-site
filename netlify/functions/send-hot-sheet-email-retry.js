/**
 * netlify/functions/send-hot-sheet-email-retry.js
 * Second scheduled slot for send-hot-sheet-email (13:30 UTC). Same handler;
 * the Blobs "last-sent" record means it is a no-op if the 12:30 UTC run sent.
 */
exports.handler = require('./send-hot-sheet-email.js').handler;
