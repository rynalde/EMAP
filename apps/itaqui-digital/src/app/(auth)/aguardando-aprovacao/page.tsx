import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { waitingNotice } from "@/lib/admin";
import { signOut } from "@/lib/auth-actions";
import { getProfile, getUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Aguardando aprovação — Itaqui Digital",
};

export default async function Page() {
  const user = await getUser();
  if (!user) redirect("/login");
  const profile = await getProfile();
  if (profile?.status === "aprovado") redirect("/");
  const { title, text } = waitingNotice(profile?.status);
  return (
    <>
      <div>
        <h1 className="auth-title">{title}</h1>
        <p className="auth-lead">{text}</p>
        <p className="auth-lead">
          Conta: <strong>{profile?.email ?? user.email}</strong>
        </p>
      </div>
      <form className="auth-form" action={signOut}>
        {/* Navegação completa: o proxy confere o status de novo no banco. */}
        <a className="auth-submit" href="/aguardando-aprovacao">
          Verificar novamente
        </a>
        <button className="auth-secondary" type="submit">
          Sair
        </button>
      </form>
    </>
  );
}
