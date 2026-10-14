"use server";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  authErrorMessage,
  safeNext,
  signupErrorMessage,
  SIGNUP_CLOSED,
  type AuthState,
} from "@/lib/auth";
import { appUrl } from "@/lib/origin";
import { createClient, getUser } from "@/lib/supabase/server";

const OTP_TYPES = [
  "email",
  "signup",
  "recovery",
  "invite",
  "email_change",
  "magiclink",
];

const text = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim();

// Os templates de e-mail do servidor esperam exatamente esta URL, sem query.
const confirmUrl = () => appUrl("/auth/confirm");

// O redirect da action segue o 307 do proxy no servidor, mas a URL do navegador
// fica com o destino pedido; quem não está aprovado já vai direto para a espera.
async function landing(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string | undefined,
  next: string,
) {
  // O .eq é obrigatório: pela RLS um admin vê todas as linhas.
  const { data } = await supabase
    .from("profiles")
    .select("status")
    .eq("id", id ?? "")
    .maybeSingle();
  return data?.status === "aprovado" ? next : "/aguardando-aprovacao";
}

function checkPassword(form: FormData): AuthState {
  const password = String(form.get("password") ?? "");
  if (password.length < 8)
    return { error: "A senha precisa ter pelo menos 8 caracteres." };
  if (password !== form.get("confirm"))
    return { error: "As senhas não coincidem." };
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const email = text(form, "email");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: String(form.get("password") ?? ""),
  });
  if (error?.code === "email_not_confirmed")
    return {
      error: authErrorMessage(error.code),
      link: {
        href: `/verificar-email?email=${encodeURIComponent(email)}`,
        label: "Reenviar e-mail de confirmação",
      },
    };
  if (error) return { error: authErrorMessage(error.code) };
  redirect(await landing(supabase, data.user?.id, safeNext(form.get("next"))));
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const fullName = text(form, "full_name");
  const email = text(form, "email");
  if (!fullName) return { error: "Informe seu nome completo." };
  const invalid = checkPassword(form);
  if (invalid) return invalid;
  const supabase = await createClient();
  // Aviso antecipado; quem barra de fato é o hook before-user-created do GoTrue.
  const { data: open } = await supabase.rpc("signup_open");
  if (open === false) return { error: SIGNUP_CLOSED };
  const { error } = await supabase.auth.signUp({
    email,
    password: String(form.get("password")),
    options: {
      emailRedirectTo: await confirmUrl(),
      data: { full_name: fullName },
    },
  });
  // E-mail já cadastrado segue o mesmo caminho de um novo: a tela não revela contas.
  if (error && error.code !== "user_already_exists")
    return { error: signupErrorMessage(error) };
  redirect(`/verificar-email?email=${encodeURIComponent(email)}`);
}

export async function resendConfirmation(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = text(form, "email");
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: await confirmUrl() },
  });
  if (error) return { error: authErrorMessage(error.code) };
  return { message: `Enviamos um novo link para ${email}.` };
}

export async function requestPasswordReset(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  // O GoTrue responde igual para contas inexistentes; só limite e e-mail inválido falham.
  const { error } = await supabase.auth.resetPasswordForEmail(
    text(form, "email"),
    { redirectTo: await confirmUrl() },
  );
  if (error) return { error: authErrorMessage(error.code) };
  return {
    message:
      "Se houver uma conta com este e-mail, enviamos um link para redefinir a senha. Ele vale por 1 hora.",
  };
}

export async function updatePassword(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const user = await getUser();
  if (!user) redirect("/esqueci-senha");
  const invalid = checkPassword(form);
  if (invalid) return invalid;
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: String(form.get("password")),
  });
  if (error) return { error: authErrorMessage(error.code) };
  redirect(await landing(supabase, user.sub, "/"));
}

// Só no POST: leitores de link corporativos fazem GET e queimariam o token de uso único.
export async function confirm(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const type = text(form, "type");
  const code = text(form, "code");
  const tokenHash = text(form, "token_hash");
  if (!code && !(tokenHash && OTP_TYPES.includes(type)))
    redirect("/login?erro=link-invalido");
  const supabase = await createClient();
  const { data, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        type: type as EmailOtpType,
        token_hash: tokenHash,
      });
  if (error) {
    console.error(
      "Falha ao confirmar link de e-mail.",
      error.code,
      error.status,
      error.message,
    );
    redirect("/login?erro=link-invalido");
  }
  redirect(
    type === "recovery" || type === "invite"
      ? "/redefinir-senha"
      : await landing(supabase, data.user?.id, safeNext(form.get("next"))),
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
