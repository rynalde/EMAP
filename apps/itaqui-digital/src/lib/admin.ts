import type { AuthState } from "@/lib/auth";

// Espelho à mão do contrato em supabase/migrations/20261014180000_user_approval_admin.sql.
export const ROLES = ["admin", "gestor", "operador", "visualizador"] as const;
export type AppRole = (typeof ROLES)[number];
export type AccountStatus = "pendente" | "aprovado" | "rejeitado" | "bloqueado";

export type Profile = {
  email: string;
  full_name: string | null;
  role: AppRole;
  status: AccountStatus;
};

export type AdminUser = Profile & {
  id: string;
  created_at: string;
  reviewed_at: string | null;
  reviewer_email: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
};

export type UpdatedUser = Profile & { previous_status: AccountStatus };

export type AppSettings = {
  signup_enabled: boolean;
  approval_required: boolean;
  default_role: AppRole;
  auto_approve_domains: string[];
  updated_at: string;
  updated_by: string | null;
};

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  operador: "Operador",
  visualizador: "Visualizador",
};

export const STATUS_LABEL: Record<AccountStatus, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  bloqueado: "Bloqueado",
};

// Botões de cada linha da tabela: [novo status, rótulo].
export const STATUS_ACTIONS: Record<AccountStatus, [AccountStatus, string][]> =
  {
    pendente: [
      ["aprovado", "Aprovar"],
      ["rejeitado", "Rejeitar"],
    ],
    aprovado: [["bloqueado", "Bloquear"]],
    rejeitado: [["aprovado", "Reativar"]],
    bloqueado: [["aprovado", "Reativar"]],
  };

// Sem profile (não deveria acontecer) conta como pendente.
export function waitingNotice(status?: AccountStatus) {
  if (status === "rejeitado")
    return {
      title: "Cadastro não aprovado",
      text: "Seu cadastro não foi aprovado. Procure o administrador do sistema se precisar de acesso.",
    };
  if (status === "bloqueado")
    return {
      title: "Acesso bloqueado",
      text: "Seu acesso foi bloqueado. Procure o administrador do sistema.",
    };
  return {
    title: "Aguardando aprovação",
    text: "Recebemos seu cadastro. Um administrador precisa aprová-lo antes do primeiro acesso; você receberá um e-mail quando isso acontecer.",
  };
}

// Um por linha ou separados por vírgula; o banco normaliza e valida cada um.
export function parseDomains(value: string): string[] {
  return value.split(/[\s,;]+/).filter(Boolean);
}

export function rpcErrorMessage(error: { code?: string; message: string }) {
  if (error.code === "42501") return "Sem permissão.";
  // As funções SQL levantam P0001 já com a mensagem em pt-BR.
  if (error.code === "P0001") return error.message;
  return "Não foi possível concluir. Tente novamente.";
}

export function updateResult(
  user: UpdatedUser,
  emailSent?: boolean,
): AuthState {
  const who = user.full_name || user.email;
  if (user.status === user.previous_status)
    return { message: `Papel de ${who}: ${ROLE_LABEL[user.role]}.` };
  if (emailSent === false)
    return {
      error: `${who}: aprovado, mas o e-mail de aviso não foi enviado.`,
    };
  return {
    message: `Status de ${who}: ${STATUS_LABEL[user.status]} (${ROLE_LABEL[user.role]}).${emailSent ? " Enviamos um e-mail de aviso." : ""}`,
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Mesmo visual dos templates do GoTrue em infra/supabase/mail-templates.
export function approvalEmail(name: string | null, loginUrl: string) {
  const hello = name ? `Olá, ${name}!` : "Olá!";
  const body =
    "Sua conta no Itaqui Digital foi aprovada por um administrador. Você já pode entrar com seu e-mail e senha.";
  return {
    subject: "Sua conta no Itaqui Digital foi aprovada",
    text: `${hello}\n\n${body}\n\nEntrar: ${loginUrl}\n`,
    html: `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:32px 16px;background:#0c181c;font-family:Arial,sans-serif;color:#edf0e9">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#152328;border-radius:12px">
      <tr>
        <td style="padding:32px">
          <p style="margin:0 0 24px;font-size:20px;font-weight:600">Itaqui <span style="font-weight:300">Digital</span></p>
          <h1 style="margin:0 0 12px;font-size:18px;font-weight:500">${escapeHtml(hello)}</h1>
          <p style="margin:0 0 24px;line-height:1.6;color:#c9d0c8">${body}</p>
          <a href="${escapeHtml(loginUrl)}"
             style="display:inline-block;padding:12px 20px;border-radius:8px;background:#b7e58b;color:#0c181c;font-weight:600;text-decoration:none">Entrar</a>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
