import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { requestPasswordReset } from "@/lib/auth-actions";

export const metadata: Metadata = {
  title: "Esqueci minha senha — Itaqui Digital",
};

export default function Page() {
  return (
    <>
      <div>
        <h1 className="auth-title">Esqueci minha senha</h1>
        <p className="auth-lead">
          Informe seu e-mail para receber um link de redefinição.
        </p>
      </div>
      <AuthForm
        action={requestPasswordReset}
        submit="Enviar link"
        pending="Enviando…"
      >
        <label className="auth-field">
          E-mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
      </AuthForm>
      <nav className="auth-links" aria-label="Outras opções">
        <a href="/login">Voltar para o login</a>
      </nav>
    </>
  );
}
