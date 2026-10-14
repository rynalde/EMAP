import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ArrowLeft, Waves } from "lucide-react";
import { AccountMenu } from "@/components/account-menu";
import { AdminUsers } from "@/components/admin-users";
import { AuthForm } from "@/components/auth-form";
import {
  ROLES,
  ROLE_LABEL,
  type AdminUser,
  type AppSettings,
} from "@/lib/admin";
import { updateSettings } from "@/lib/admin-actions";
import { searchText } from "@/lib/cartography";
import { createClient, getProfile, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Administração — Itaqui Digital" };

const TABS = [
  ["pendente", "Pendentes"],
  ["aprovado", "Aprovados"],
  ["rejeitado", "Rejeitados"],
  ["bloqueado", "Bloqueados"],
  ["todos", "Todos"],
] as const;

const DATE = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Fortaleza",
});

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[]; q?: string | string[] }>;
}) {
  const me = await getProfile();
  if (me?.role !== "admin" || me.status !== "aprovado") redirect("/");
  const [{ status, q }, user, supabase] = await Promise.all([
    searchParams,
    getUser(),
    createClient(),
  ]);
  const [list, config] = await Promise.all([
    supabase.rpc("admin_list_users"),
    supabase.from("app_settings").select("*").maybeSingle<AppSettings>(),
  ]);
  const users: AdminUser[] = list.data ?? [];
  const settings = config.data;

  // ponytail: lista inteira filtrada aqui; paginar no banco quando passar de alguns milhares.
  const count = (s: string) =>
    s === "todos" ? users.length : users.filter((u) => u.status === s).length;
  const query = typeof q === "string" ? q.trim() : "";
  const tab =
    TABS.find(([s]) => s === status)?.[0] ??
    (count("pendente") ? "pendente" : "todos");
  const shown = users
    .filter(
      (u) =>
        (tab === "todos" || u.status === tab) &&
        searchText(`${u.full_name ?? ""} ${u.email}`).includes(
          searchText(query),
        ),
    )
    .map((u) => ({ ...u, created: DATE.format(new Date(u.created_at)) }));
  const href = (s: string) =>
    `/admin?${new URLSearchParams(query ? { status: s, q: query } : { status: s })}`;
  const updatedBy = users.find((u) => u.id === settings?.updated_by)?.email;

  return (
    <div className="admin-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Itaqui Digital início">
          <span className="brand-symbol">
            <Waves size={26} />
          </span>
          <span>
            itaqui<span className="brand-light">digital</span>
            <small>ADMINISTRAÇÃO</small>
          </span>
        </a>
        <div className="header-right">
          <a className="icon-button view3d-link" href="/">
            <ArrowLeft size={18} />
            <span>Mapa</span>
          </a>
          <AccountMenu />
        </div>
      </header>
      <main className="admin-main">
        <h1 className="admin-title">Administração</h1>

        <section className="admin-section" aria-labelledby="admin-usuarios">
          <h2 id="admin-usuarios">Usuários</h2>
          {list.error && (
            <p className="auth-notice error" role="alert">
              Não foi possível carregar os usuários. Recarregue a página.
            </p>
          )}
          <div className="admin-filters">
            <nav className="admin-tabs" aria-label="Filtrar por status">
              {TABS.map(([s, label]) => (
                <a
                  key={s}
                  href={href(s)}
                  aria-current={s === tab ? "page" : undefined}
                >
                  {label} <span>{count(s)}</span>
                </a>
              ))}
            </nav>
            <form className="admin-search" role="search" action="/admin">
              <input type="hidden" name="status" value={tab} />
              <input
                name="q"
                type="search"
                defaultValue={query}
                placeholder="Nome ou e-mail"
                aria-label="Buscar por nome ou e-mail"
              />
              <button className="admin-button" type="submit">
                Buscar
              </button>
            </form>
          </div>
          <AdminUsers
            users={shown}
            selfId={user?.sub ?? ""}
            caption={`${shown.length} ${shown.length === 1 ? "usuário" : "usuários"}${query ? ` para “${query}”` : ""}`}
          />
        </section>

        <section className="admin-section" aria-labelledby="admin-config">
          <h2 id="admin-config">Configurações</h2>
          {settings ? (
            <AuthForm
              action={updateSettings}
              submit="Salvar configurações"
              pending="Salvando…"
            >
              {/* Remonta os campos com os valores normalizados pelo banco após salvar. */}
              <div className="admin-fields" key={settings.updated_at}>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    name="signup_enabled"
                    defaultChecked={settings.signup_enabled}
                  />
                  <span>
                    Cadastro aberto
                    <small>
                      Desmarcado, ninguém consegue criar conta nova.
                    </small>
                  </span>
                </label>
                <label className="admin-check">
                  <input
                    type="checkbox"
                    name="approval_required"
                    defaultChecked={settings.approval_required}
                  />
                  <span>
                    Aprovação obrigatória
                    <small>Desmarcado, novas contas entram já aprovadas.</small>
                  </span>
                </label>
                <label className="auth-field">
                  Papel padrão de novas contas
                  <select
                    name="default_role"
                    defaultValue={settings.default_role}
                  >
                    {/* O banco recusa admin como papel padrão. */}
                    {ROLES.filter((r) => r !== "admin").map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="auth-field">
                  Domínios aprovados automaticamente
                  <textarea
                    name="auto_approve_domains"
                    rows={3}
                    defaultValue={settings.auto_approve_domains.join("\n")}
                    placeholder="emap.ma.gov.br"
                    aria-describedby="admin-domains-hint"
                  />
                  <small id="admin-domains-hint">
                    Um por linha ou separados por vírgula, sem “@”. Contas
                    desses domínios dispensam a aprovação.
                  </small>
                </label>
                <p className="admin-meta">
                  Atualizado em {DATE.format(new Date(settings.updated_at))}
                  {updatedBy && ` por ${updatedBy}`}.
                </p>
              </div>
            </AuthForm>
          ) : (
            <p className="auth-notice error" role="alert">
              Não foi possível carregar as configurações. Recarregue a página.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
