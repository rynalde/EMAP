// Toda a autenticação roda no servidor: o JavaScript da página não precisa ler a sessão.
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
};

export function supabaseEnv(): [url: string, key: string] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw Error(
      "Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (veja .env.example).",
    );
  return [url, key];
}
