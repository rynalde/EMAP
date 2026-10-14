import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { signup } from "@/lib/auth-actions";

export const metadata: Metadata = { title: "Criar conta — Itaqui Digital" };

export default function Page() {
  return (
    <>
      <div>
        <h1 className="auth-title">Criar conta</h1>
        <p className="auth-lead">
          Enviaremos um link para confirmar seu e-mail.
        </p>
      </div>
      <AuthForm action={signup} submit="Criar conta" pending="Criando conta…">
        <label className="auth-field">
          Nome completo
          <input name="full_name" autoComplete="name" required />
        </label>
        <label className="auth-field">
          E-mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label className="auth-field">
          Senha (mínimo de 8 caracteres)
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className="auth-field">
          Confirmar senha
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
      </AuthForm>
      <nav className="auth-links" aria-label="Outras opções">
        <a href="/login">Já tenho conta</a>
      </nav>
    </>
  );
}
