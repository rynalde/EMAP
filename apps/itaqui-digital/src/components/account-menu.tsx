import { LogOut, ShieldCheck } from "lucide-react";
import { ROLE_LABEL } from "@/lib/admin";
import { signOut } from "@/lib/auth-actions";
import { createClient, getProfile, getUser } from "@/lib/supabase/server";

export async function AccountMenu() {
  const [user, profile] = await Promise.all([getUser(), getProfile()]);
  const name =
    profile?.full_name || user?.user_metadata?.full_name || user?.email;
  const admin = profile?.role === "admin" && profile.status === "aprovado";
  const pending = admin
    ? (
        await (
          await createClient()
        )
          .from("profiles")
          .select("*", { count: "exact", head: true })
          .eq("status", "pendente")
      ).count
    : 0;
  return (
    <form className="account-menu" action={signOut}>
      {name && (
        <span className="account-name" title={user?.email}>
          {name}
          {profile && (
            <small className="account-role">{ROLE_LABEL[profile.role]}</small>
          )}
        </span>
      )}
      {admin && (
        <a
          className="icon-button account-admin"
          href="/admin"
          title="Admin"
          aria-label={`Admin${pending ? `, ${pending} ${pending === 1 ? "cadastro pendente" : "cadastros pendentes"}` : ""}`}
        >
          <ShieldCheck size={18} />
          {!!pending && <span className="account-badge">{pending}</span>}
        </a>
      )}
      <button
        className="icon-button"
        type="submit"
        title="Sair"
        aria-label="Sair"
      >
        <LogOut size={18} />
      </button>
    </form>
  );
}
