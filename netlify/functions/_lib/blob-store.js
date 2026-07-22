/**
 * netlify/functions/_lib/blob-store.js
 *
 * Thin wrapper around Netlify Blobs for the two private data stores that
 * back the rep-outreach automation:
 *   - "rep-contacts"       one JSON object per rep (keyed by repId)
 *   - "field-observations" one JSON object per logged observation/response
 *
 * Netlify Blobs is used instead of a file in the deployed bundle because
 * function code is read-only at runtime — a scheduled/inbound function needs
 * somewhere to WRITE (lastContacted, logged responses) that survives between
 * invocations. Blobs are private to this Netlify site; nothing here is
 * served on a public URL the way sitework/*.html is.
 *
 * Requires the "@netlify/blobs" package to be present in
 * netlify/functions/package.json — Netlify's own build step (zip-it-and-
 * ship-it) resolves and bundles it; nothing to install by hand.
 */

const { getStore } = require('@netlify/blobs');

function repsStore() {
  return getStore('rep-contacts');
}

function observationsStore() {
  return getStore('field-observations');
}

/** Read the whole rep-contacts collection as a plain array (schema nhd-rep-contacts-v1 shape). */
async function readAllReps() {
  const store = repsStore();
  const { blobs } = await store.list();
  const reps = [];
  for (const b of blobs) {
    const rep = await store.get(b.key, { type: 'json' });
    if (rep) reps.push(rep);
  }
  return reps;
}

async function readRep(repId) {
  return repsStore().get(repId, { type: 'json' });
}

async function writeRep(rep) {
  if (!rep || !rep.repId) throw new Error('writeRep: rep.repId is required');
  await repsStore().setJSON(rep.repId, rep);
}

/** Append one observation (does not overwrite — each call is a new record, id must be unique). */
async function appendObservation(obs) {
  if (!obs || !obs.id) throw new Error('appendObservation: obs.id is required');
  await observationsStore().setJSON(obs.id, obs);
}

async function readAllObservations() {
  const store = observationsStore();
  const { blobs } = await store.list();
  const out = [];
  for (const b of blobs) {
    const o = await store.get(b.key, { type: 'json' });
    if (o) out.push(o);
  }
  return out;
}

module.exports = {
  repsStore,
  observationsStore,
  readAllReps,
  readRep,
  writeRep,
  appendObservation,
  readAllObservations,
};
