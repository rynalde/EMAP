export type AuthState =
  | { error?: string; message?: string; link?: { href: string; label: string } }
  | undefined;

const BASE = "http://localhost";

// Só caminhos relativos da própria origem; o resto vira "/" (evita redirecionamento aberto).
export function safeNext(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    /[\\\x00-\x1f\x7f]/.test(value)
  )
    return "/";
  return new URL(value, BASE).origin === BASE ? value : "/";
}

const MESSAGES = new Map(
  Object.entries({
    invalid_credentials: "E-mail ou senha incorretos.",
    email_not_confirmed:
      "Confirme seu e-mail antes de entrar. Procure o link na sua caixa de entrada.",
    user_already_exists: "Já existe uma conta com este e-mail.",
    weak_password: "Senha fraca. Use pelo menos 8 caracteres.",
    same_password: "A nova senha precisa ser diferente da atual.",
    over_email_send_rate_limit:
      "Aguarde 60 segundos antes de pedir outro e-mail.",
    over_request_rate_limit:
      "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
    otp_expired: "O link expirou ou já foi usado. Peça um novo e-mail.",
    validation_failed: "Confira os dados informados.",
    email_address_invalid: "Informe um e-mail válido.",
    signup_disabled: "Novos cadastros estão desativados.",
  }),
);

export function authErrorMessage(code?: string): string {
  return (
    MESSAGES.get(code ?? "") ?? "Não foi possível concluir. Tente novamente."
  );
}

export const SIGNUP_CLOSED = "Os cadastros estão fechados no momento.";

// O hook before-user-created recusa com HTTP 403 e sem código próprio do GoTrue.
export function signupErrorMessage(error: {
  code?: string;
  status?: number;
  message?: string;
}): string {
  if (
    error.message === SIGNUP_CLOSED ||
    (error.status === 403 && !MESSAGES.has(error.code ?? ""))
  )
    return SIGNUP_CLOSED;
  return authErrorMessage(error.code);
}
