import { headers } from "next/headers";

// Links enviados por e-mail apontam para a origem que fez o pedido (local, produção ou prévia).
export async function appUrl(path: string) {
  const h = await headers();
  const origin =
    h.get("origin") ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return `${origin}${path}`;
}
