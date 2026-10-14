import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { confirm } from "@/lib/auth-actions";

export const metadata: Metadata = {
  title: "Confirmar acesso — Itaqui Digital",
  referrer: "no-referrer",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const value = (key: string) => {
    const v = query[key];
    return typeof v === "string" ? v : "";
  };
  if (!value("code") && !(value("token_hash") && value("type")))
    redirect("/login?erro=link-invalido");
  return (
    <>
      <div>
        <h1 className="auth-title">Confirmar acesso</h1>
        <p className="auth-lead">
          {value("type") === "recovery" || value("type") === "invite"
            ? "Continue para definir sua senha."
            : "Continue para confirmar seu e-mail e entrar."}
        </p>
      </div>
      {/* A verificação só acontece no POST deste formulário. */}
      <AuthForm action={confirm} submit="Continuar" pending="Confirmando…">
        {["token_hash", "type", "next", "code"].map((key) => (
          <input key={key} type="hidden" name={key} value={value(key)} />
        ))}
      </AuthForm>
    </>
  );
}
