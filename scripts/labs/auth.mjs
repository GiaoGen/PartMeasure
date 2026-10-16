import { readFile, writeFile, unlink } from 'node:fs/promises';
import { config, client, evidence, safeError, stateDir } from './cloud-common.mjs';

async function main() {
const [command, actor] = process.argv.slice(2);
if (!['A', 'B'].includes(actor) || !['request', 'verify'].includes(command)) throw new Error('Usage: auth.mjs request|verify A|B');
const c = await config();
const auth = client(c).auth;
if (command === 'request') {
  try {
    const previous=JSON.parse(await readFile(`docs/evidence/closeout/auth-request-${actor}.json`,'utf8'));
    if(previous.accepted&&!process.argv.includes('--resend-confirmed'))throw new Error('Email already requested. Reuse existing email; explicit resend authorization required.');
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  const { error } = await auth.signInWithOtp({ email: c.emails[actor], options: { shouldCreateUser: true } });
  const result = { actor, operation: 'email-request', accepted: !error, error: safeError(error), delivery: 'not yet verified' };
  await evidence(`auth-request-${actor}`, result);
  console.log(JSON.stringify(result));
  if (error) process.exitCode = 1;
} else {
  // Put code OR the original email confirmation URL in the ignored input file.
  const path = `${stateDir}/otp-${actor}.txt`;
  const input = (await readFile(path, 'utf8')).trim();
  let verification;
  let method='otp';
  if (/^\d{6,10}$/.test(input)) verification = await auth.verifyOtp({ email: c.emails[actor], token: input, type: 'email' });
  else {
    const url = new URL(input);
    if(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)) {
      // Default implicit email flow can succeed at Auth then redirect to an absent local app.
      // Recover only tokens supplied by the user; validate them against the lab Auth server.
      const params=new URLSearchParams(url.hash.slice(1));
      const access_token=params.get('access_token');const refresh_token=params.get('refresh_token');
      if(!access_token||!refresh_token)throw new Error('Local callback contains no usable session; use original unconsumed email URL');
      verification=await auth.setSession({access_token,refresh_token});method='existing-email-callback';
    } else {
      if (url.protocol !== 'https:' || url.hostname !== `${c.projectRef}.supabase.co` || url.pathname !== '/auth/v1/verify') throw new Error('Expected original lab email confirmation URL');
      const hash = url.searchParams.get('token_hash') ?? url.searchParams.get('token');
      const type=url.searchParams.get('type')??'email';
      if (!hash||!['email','signup','magiclink'].includes(type)) throw new Error('Expected lab login token');
      verification=await auth.verifyOtp({token_hash:hash,type});method='existing-email-link';
    }
  }
  const { data, error } = verification;
  const session = data.session;
  const matches = data.user?.email?.toLowerCase() === c.emails[actor].toLowerCase();
  if (!error && session && matches) await writeFile(`${stateDir}/session-${actor}.json`, JSON.stringify(session), { mode: 0o600 });
  await unlink(path);
  const result = { actor, operation: 'email-verification', method, verified: !error && !!session && matches, emailMatchesExpected: matches, error: safeError(error) };
  await evidence(`auth-verify-${actor}`, result);
  console.log(JSON.stringify(result));
  if (!result.verified) process.exitCode = 1;
}
}
await main().catch(error=>{
  console.log(JSON.stringify({operation:'auth-experiment',completed:false,error:safeError(error)}));
  process.exitCode=1;
});
