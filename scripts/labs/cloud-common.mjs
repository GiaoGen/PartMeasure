import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

export const labRef = 'rvysclscetfqicpnzlra';
export const stateDir = 'tmp/p0-0-cloud';
export async function config() {
  const c = JSON.parse(await readFile(`${stateDir}/config.json`, 'utf8'));
  if (c.projectRef !== labRef || c.url !== `https://${labRef}.supabase.co`) throw new Error('Unapproved lab target');
  return c;
}
export function client(c, session) {
  return createClient(c.url, c.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(session ? { global: { headers: { Authorization: `Bearer ${session.access_token}` } } } : {}),
  });
}
export async function loadSession(actor) {
  return JSON.parse(await readFile(`${stateDir}/session-${actor}.json`, 'utf8'));
}
export async function evidence(file, data) {
  await mkdir('docs/evidence/closeout', { recursive: true });
  await writeFile(`docs/evidence/closeout/${file}.json`, `${JSON.stringify({ checkedAt: new Date().toISOString(), projectRef: labRef, scope: 'isolated service experiment, not application acceptance', ...data }, null, 2)}\n`);
}
// Only fixed fields/codes are recorded. Never serialize SDK responses, tokens or URLs.
export function safeError(error) {
  if(!error)return null;
  return{status:Number.isInteger(error.status)?error.status:null,code:typeof error.code==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(error.code)?error.code:'UNKNOWN'};
}
