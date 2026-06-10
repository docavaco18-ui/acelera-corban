import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!URL || !ANON) {
  // Vite injeta env em BUILD time — bundle sem essas vars = login quebrado silencioso.
  throw new Error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ausentes no build. " +
    "Configure no .env (dev) ou nos build args do Docker (prod).",
  );
}

export const supabase = createClient(URL, ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
