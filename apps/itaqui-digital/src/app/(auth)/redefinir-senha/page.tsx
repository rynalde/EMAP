import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { updatePassword } from "@/lib/auth-actions";

export const metadata: Metadata = {
  title: "Nova senha — Itaqui Digital",
};

export default function Page() {
  return (
    <>
      <div>
        <h1 className="auth-title">Nova senha</h1>
        <p className="auth-lead">
          Escolha uma senha com pelo menos 8 caracteres.
        </p>
      </div>
      <AuthForm
        action={updatePassword}
        submit="Salvar senha"
        pending="Salvando…"
      >
        <label className="auth-field">
          Nova senha
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>
        <label className="auth-field">
          Confirmar nova senha
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
        <a href="/">Voltar ao mapa</a>
      </nav>
    </>
  );
}
