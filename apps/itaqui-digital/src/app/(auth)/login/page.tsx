import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { login } from "@/lib/auth-actions";
import { safeNext } from "@/lib/auth";

export const metadata: Metadata = { title: "Entrar — Itaqui Digital" };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; erro?: string }>;
}) {
  const { next, erro } = await searchParams;
  return (
    <>
      <div>
        <h1 className="auth-title">Entrar</h1>
        <p className="auth-lead">Acesse o mapa do Porto do Itaqui.</p>
      </div>
      {erro === "link-invalido" && (
        <p className="auth-notice error" role="alert">
          O link é inválido ou expirou. Entre novamente ou{" "}
          <a href="/esqueci-senha">peça um novo e-mail</a>.
        </p>
      )}
      <AuthForm action={login} submit="Entrar" pending="Entrando…">
        <input type="hidden" name="next" value={safeNext(next)} />
        <label className="auth-field">
          E-mail
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="auth-field">
          Senha
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </label>
      </AuthForm>
      <nav className="auth-links" aria-label="Outras opções">
        <a href="/esqueci-senha">Esqueci minha senha</a>
        <a href="/cadastro">Criar conta</a>
      </nav>
    </>
  );
}
