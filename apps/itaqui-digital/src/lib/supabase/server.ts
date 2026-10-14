import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Profile } from "@/lib/admin";
import { cookieOptions, supabaseEnv } from "./env";

export async function createClient() {
  const store = await cookies();
  return createServerClient(...supabaseEnv(), {
    cookieOptions,
    cookies: {
      getAll: () => store.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          // Server Components não gravam cookies; o proxy já renovou a sessão.
        }
      },
    },
  });
}

// Claims verificadas (assinatura do JWT), uma vez por requisição.
export const getUser = cache(async () => {
  const { data } = await (await createClient()).auth.getClaims();
  return data?.claims ?? null;
});

// Papel e status sempre lidos do banco (a RLS mostra a própria linha), uma vez por requisição.
export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const { data } = await (
    await createClient()
  )
    .from("profiles")
    .select("role,status,full_name,email")
    .eq("id", user.sub)
    .maybeSingle<Profile>();
  return data;
});
