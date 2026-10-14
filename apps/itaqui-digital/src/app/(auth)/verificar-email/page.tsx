import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { resendConfirmation } from "@/lib/auth-actions";

export const metadata: Metadata = {
  title: "Confirme seu e-mail — Itaqui Digital",
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>;
}) {
  const { email } = await searchParams;
  const address = typeof email === "string" ? email : "";
  return (
    <>
      <div>
        <h1 className="auth-title">Confirme seu e-mail</h1>
        <p className="auth-lead">
          {address ? (
            <>
              Enviamos um link de confirmação para <strong>{address}</strong>.
            </>
          ) : (
            "Enviamos um link de confirmação para o seu e-mail."
          )}{" "}
          Ele vale por 1 hora.
        </p>
      </div>
      <AuthForm
        action={resendConfirmation}
        submit="Reenviar e-mail"
        pending="Reenviando…"
      >
        {address ? (
          <input type="hidden" name="email" value={address} />
        ) : (
          <label className="auth-field">
            E-mail
            <input name="email" type="email" autoComplete="email" required />
          </label>
        )}
      </AuthForm>
      <nav className="auth-links" aria-label="Outras opções">
        <a href="/login">Voltar para o login</a>
      </nav>
    </>
  );
}
