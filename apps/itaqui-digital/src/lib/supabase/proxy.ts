import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { cookieOptions, supabaseEnv } from "./env";

export async function updateSession(request: NextRequest) {
  const cookies: { name: string; value: string; options: CookieOptions }[] = [];
  const headers: Record<string, string> = {};
  const supabase = createServerClient(...supabaseEnv(), {
    cookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, cacheHeaders) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        cookies.push(...cookiesToSet);
        Object.assign(headers, cacheHeaders);
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  // Toda resposta (seguir, redirecionar ou 401) leva os cookies renovados.
  const send = <T extends NextResponse>(response: T) => {
    cookies.forEach(({ name, value, options }) =>
      response.cookies.set(name, value, options),
    );
    Object.entries(headers).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  };
  return {
    user: data?.claims ?? null,
    supabase,
    send,
    next: () => send(NextResponse.next({ request })),
  };
}
