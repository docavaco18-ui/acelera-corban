import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";

export interface SessionState {
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  email: string | null;
  userId: string | null;
}

export function useSession(): SessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const meta = (session?.user?.app_metadata ?? {}) as Record<string, unknown>;
  const isAdmin = meta.role === "admin";

  return {
    session,
    loading,
    isAdmin,
    email: session?.user?.email ?? null,
    userId: session?.user?.id ?? null,
  };
}
