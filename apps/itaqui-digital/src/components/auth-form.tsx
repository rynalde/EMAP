"use client";
import { startTransition, useActionState } from "react";
import type { AuthState } from "@/lib/auth";

export function AuthForm({
  action,
  submit,
  pending,
  children,
}: {
  action: (state: AuthState, form: FormData) => Promise<AuthState>;
  submit: string;
  pending: string;
  children?: React.ReactNode;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  return (
    <form
      className="auth-form"
      action={formAction}
      // Envio manual evita que o React limpe os campos quando a ação devolve um erro.
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => formAction(form));
      }}
    >
      {children}
      <p
        className={`auth-status ${state?.error ? "error" : ""}`}
        role="status"
        aria-live="polite"
      >
        {state?.error ?? state?.message}
        {state?.link && (
          <>
            {" "}
            <a href={state.link.href}>{state.link.label}</a>
          </>
        )}
      </p>
      <button className="auth-submit" type="submit" disabled={isPending}>
        {isPending ? pending : submit}
      </button>
    </form>
  );
}
