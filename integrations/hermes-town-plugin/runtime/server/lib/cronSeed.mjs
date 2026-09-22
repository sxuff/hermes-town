// Pre-register the town's keepers from the scheduler's own job file.
//
// A scheduled job's resident key is deterministic: the plugin derives it as
// HMAC(subkey, "cron\0" + job id), where subkey is HMAC(token, "hermes-town.
// pseudonym.v1"). The server already holds that token for bearer auth, so it
// can compute the same key for every configured job without the plugin sending
// anything. That is what lets a keeper stand at its post from the first page
// load instead of appearing the moment the job first fires.
//
// The read is deliberately narrow: the jobs file also carries prompts, models,
// workdirs, and error text. Only a job's `id` and its `enabled` flag are ever
// looked at, and only the id leaves this module. Nothing here reads a prompt,
// a schedule, a name, or a path out of an entry.

import crypto from 'node:crypto';
import fs from 'node:fs';

import { AGENT_KEY } from './contract.mjs';

/** Pseudonym subkey, derived exactly as the plugin derives it. Never returned. */
export function pseudonymSubkey(token) {
  return crypto.createHmac('sha256', token).update('hermes-town.pseudonym.v1', 'utf8').digest();
}

/**
 * The resident key for one scheduled job, byte-identical to
 * `_Bridge.key_for("cron", job id)` in the plugin.
 */
export function deriveCronKey(token, jobId) {
  const digest = crypto
    .createHmac('sha256', pseudonymSubkey(token))
    .update(`cron\x00${jobId}`, 'utf8')
    .digest('hex');
  const key = `h/cron/${digest.slice(0, 16)}`;
  if (!AGENT_KEY.test(key)) throw new Error('derived a key the contract rejects');
  return key;
}

/** A job id the town can carry: the same charset the ingress id allows. */
const JOB_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Read the enabled job ids from a Hermes scheduler jobs file.
 *
 * Accepts the shape Hermes writes (`{"jobs": [...], "updated_at": ...}`) and a
 * bare list. An entry counts only when it is an object, its `id` is a string
 * that fits the wire charset, and `enabled` is exactly `true`. A missing file
 * yields no ids rather than an error: an operator whose scheduler has not run
 * yet should still get a town, not a failed boot.
 */
export function readEnabledJobIds(jobsFilePath) {
  let text;
  try {
    text = fs.readFileSync(jobsFilePath, 'utf8');
  } catch {
    return { ok: true, ids: [], absent: true };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed_json' };
  }
  const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.jobs) ? parsed.jobs : null;
  if (entries === null) return { ok: false, reason: 'no_jobs_array' };
  const ids = [];
  let skipped = 0;
  for (const entry of entries) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (!JOB_ID.test(id)) { skipped += 1; continue; }
    if (entry.enabled !== true) { skipped += 1; continue; }
    ids.push(id);
  }
  return { ok: true, ids, skipped, absent: false };
}

/**
 * Turn enabled job ids into seed entries: one `{key}` per distinct job, in
 * file order. Duplicate ids collapse to one resident, as the plugin's identity
 * map would.
 */
export function cronSeedEntries(token, ids, { maxAgents = 256 } = {}) {
  const seen = new Set();
  const seeds = [];
  for (const id of ids) {
    if (seeds.length >= maxAgents) break;
    const key = deriveCronKey(token, id);
    if (seen.has(key)) continue;
    seen.add(key);
    seeds.push({ key });
  }
  return seeds;
}
