"use client";
import { useActionState, useEffect, useRef } from "react";
import {
  ROLES,
  ROLE_LABEL,
  STATUS_ACTIONS,
  STATUS_LABEL,
  type AdminUser,
} from "@/lib/admin";
import { updateUser } from "@/lib/admin-actions";

const COLUMNS = ["Nome", "E-mail", "Papel", "Status", "Cadastro em", "Ações"];

// Um só resultado para a tabela: a linha pode sumir do filtro depois da ação.
export function AdminUsers({
  users,
  selfId,
  caption,
}: {
  users: (AdminUser & { created: string })[];
  selfId: string;
  caption: string;
}) {
  const [state, action, pending] = useActionState(updateUser, undefined);
  const wrap = useRef<HTMLDivElement>(null);
  // O botão clicado some da linha após a ação; o foco volta para a tabela.
  useEffect(() => {
    if (state && document.activeElement === document.body)
      wrap.current?.focus();
  }, [state]);
  return (
    <>
      <p
        className={`admin-status ${state?.error ? "error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {state?.error ?? state?.message}
      </p>
      <div
        ref={wrap}
        className="admin-table-wrap"
        role="region"
        aria-label={caption}
        tabIndex={0}
      >
        <table className="admin-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === selfId;
              const who = u.full_name || u.email;
              return (
                <tr key={u.id}>
                  <th scope="row">
                    {u.full_name || "—"}
                    {self && <small className="admin-tag">você</small>}
                  </th>
                  <td>
                    {u.email}
                    {!u.email_confirmed_at && (
                      <small className="admin-tag">e-mail não confirmado</small>
                    )}
                  </td>
                  <td>
                    {self ? (
                      ROLE_LABEL[u.role]
                    ) : (
                      <div className="admin-row-form">
                        {/* Um formulário por linha (o das ações): Aprovar etc. também enviam o papel escolhido. */}
                        {/* O React reinicia o formulário após a ação e select não relê defaultValue: a key remonta com o papel salvo. */}
                        <select
                          key={u.role}
                          name="role"
                          form={`row-${u.id}`}
                          defaultValue={u.role}
                          aria-label={`Papel de ${who}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <button
                          className="admin-button"
                          type="submit"
                          form={`row-${u.id}`}
                          disabled={pending}
                          aria-label={`Salvar papel de ${who}`}
                        >
                          Salvar
                        </button>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`admin-badge ${u.status}`}>
                      {STATUS_LABEL[u.status]}
                    </span>
                  </td>
                  <td>{u.created}</td>
                  <td>
                    {!self && (
                      <form
                        id={`row-${u.id}`}
                        className="admin-row-form"
                        action={action}
                      >
                        <input type="hidden" name="target" value={u.id} />
                        {/* Aprovar exige e-mail confirmado: o aviso diz "você já pode entrar". */}
                        {STATUS_ACTIONS[u.status]
                          .filter(
                            ([s]) => s !== "aprovado" || u.email_confirmed_at,
                          )
                          .map(([status, label]) => (
                            <button
                              key={status}
                              className={`admin-button ${status === "aprovado" ? "primary" : ""}`}
                              type="submit"
                              name="status"
                              value={status}
                              disabled={pending}
                              aria-label={`${label} ${who}`}
                            >
                              {label}
                            </button>
                          ))}
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {!users.length && (
              <tr>
                <td colSpan={COLUMNS.length}>Nenhum usuário encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
