"use server";
import { revalidatePath } from "next/cache";
import {
  approvalEmail,
  parseDomains,
  rpcErrorMessage,
  updateResult,
  type UpdatedUser,
} from "@/lib/admin";
import type { AuthState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const value = (form: FormData, key: string) =>
  String(form.get(key) ?? "").trim() || null;

// A autorização fica nas funções SQL (is_admin); estas ações só repassam o pedido.
export async function updateUser(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("admin_update_user", {
      target: value(form, "target"),
      new_status: value(form, "status"),
      new_role: value(form, "role"),
    })
    .single<UpdatedUser>();
  if (error) return { error: rpcErrorMessage(error) };
  revalidatePath("/admin");
  if (data.previous_status === "aprovado" || data.status !== "aprovado")
    return updateResult(data);
  return updateResult(data, await sendApproval(data));
}

// A aprovação já valeu no banco; falha no aviso só muda a mensagem da tela.
async function sendApproval({ email, full_name }: UpdatedUser) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("RESEND_API_KEY ausente: aviso de aprovação não enviado.");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Itaqui Digital <no-reply@rynalde.com>",
        to: [email],
        // Fixo: o link vai para quem foi aprovado, não para a origem do admin (local ou prévia).
        ...approvalEmail(full_name, "https://itaqui-digital.vercel.app/login"),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      console.error(
        `Resend recusou o aviso de aprovação (HTTP ${res.status}).`,
      );
    return res.ok;
  } catch (e) {
    console.error("Falha ao enviar o aviso de aprovação.", e);
    return false;
  }
}

export async function updateSettings(
  _: AuthState,
  form: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_settings", {
    p_signup_enabled: form.has("signup_enabled"),
    p_approval_required: form.has("approval_required"),
    p_default_role: value(form, "default_role"),
    p_auto_approve_domains: parseDomains(
      String(form.get("auto_approve_domains") ?? ""),
    ),
  });
  if (error) return { error: rpcErrorMessage(error) };
  revalidatePath("/admin");
  return { message: "Configurações salvas." };
}
