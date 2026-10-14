import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const PUBLIC = /^\/(login|cadastro|verificar-email|esqueci-senha|auth)(\/|$)/;
const WAITING = "/aguardando-aprovacao";

export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl;
  // Sem redirect permitido, o GoTrue manda o link para a raiz do SITE_URL.
  if (
    searchParams.has("token_hash") &&
    searchParams.has("type") &&
    pathname !== "/auth/confirm"
  )
    return NextResponse.redirect(
      new URL(`/auth/confirm${search}`, request.url),
    );

  const { user, supabase, send, next } = await updateSession(request);
  const go = (path: string) =>
    send(NextResponse.redirect(new URL(path, request.url)));
  if (user) {
    // Status lido do banco a cada requisição: bloqueio ou rejeição valem na próxima.
    const { data } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.sub)
      .maybeSingle();
    const approved = data?.status === "aprovado";
    if (
      pathname === "/login" ||
      pathname === "/cadastro" ||
      (approved && pathname === WAITING)
    )
      return go(approved ? "/" : WAITING);
    if (
      approved ||
      pathname === WAITING ||
      pathname === "/redefinir-senha" ||
      PUBLIC.test(pathname)
    )
      return next();
    if (pathname.startsWith("/api/"))
      return send(
        NextResponse.json(
          { error: "Acesso pendente de aprovação" },
          { status: 403 },
        ),
      );
    return go(WAITING);
  }
  if (PUBLIC.test(pathname)) return next();
  if (pathname === "/redefinir-senha") return go("/esqueci-senha");
  // As APIs só servem dados públicos, então o proxy é a única barreira delas.
  if (pathname.startsWith("/api/"))
    return send(
      NextResponse.json({ error: "Não autenticado" }, { status: 401 }),
    );
  return go(`/login?next=${encodeURIComponent(pathname + search)}`);
}

export const config = {
  // Internos do Next e arquivos de public/; páginas e /api passam sempre pelo proxy.
  matcher: ["/((?!_next/|__nextjs|data/|models/|favicon\\.ico$).*)"],
};
