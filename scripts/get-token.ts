import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// npm run token -- you@example.com yourpassword
// Signs in (or signs up on first use) and prints a JWT for:  Authorization: Bearer <token>
async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) throw new Error('usage: npm run token -- <email> <password>');

  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

  let session = (await sb.auth.signInWithPassword({ email, password })).data.session;
  if (!session) {
    console.error('sign-in failed, trying sign-up...');
    const signUp = await sb.auth.signUp({ email, password });
    if (signUp.error) throw signUp.error;
    session = signUp.data.session;
  }
  if (!session) {
    throw new Error('Account created but no session: confirm the email, or turn off "Confirm email" in Supabase > Authentication > Providers > Email (dev only).');
  }
  console.log(session.access_token);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
