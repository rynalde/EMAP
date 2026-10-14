import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalEmail,
  parseDomains,
  rpcErrorMessage,
  updateResult,
  waitingNotice,
  type UpdatedUser,
} from "../src/lib/admin";

test("parseDomains splits lines, commas and blanks", () => {
  assert.deepEqual(parseDomains(" emap.ma.gov.br,\n\n@Porto.com ; a.b  "), [
    "emap.ma.gov.br",
    "@Porto.com",
    "a.b",
  ]);
  assert.deepEqual(parseDomains("  \n, "), []);
});

test("waitingNotice picks the message by status", () => {
  assert.match(waitingNotice("pendente").text, /receberá um e-mail/);
  assert.match(waitingNotice("rejeitado").title, /não aprovado/);
  assert.match(waitingNotice("bloqueado").title, /bloqueado/);
  assert.deepEqual(waitingNotice(undefined), waitingNotice("pendente"));
});

test("rpcErrorMessage maps SQL error codes", () => {
  assert.equal(
    rpcErrorMessage({ code: "42501", message: "forbidden" }),
    "Sem permissão.",
  );
  assert.equal(
    rpcErrorMessage({
      code: "P0001",
      message: "Você não pode alterar a própria conta.",
    }),
    "Você não pode alterar a própria conta.",
  );
  assert.equal(
    rpcErrorMessage({ code: "22P02", message: "invalid input syntax" }),
    "Não foi possível concluir. Tente novamente.",
  );
});

const row: UpdatedUser = {
  email: "ana@emap.ma.gov.br",
  full_name: "Ana",
  previous_status: "pendente",
  status: "aprovado",
  role: "operador",
};

test("updateResult reports role, status and approval e-mail", () => {
  assert.deepEqual(updateResult({ ...row, previous_status: "aprovado" }), {
    message: "Papel de Ana: Operador.",
  });
  assert.deepEqual(updateResult(row, true), {
    message: "Status de Ana: Aprovado (Operador). Enviamos um e-mail de aviso.",
  });
  assert.match(
    updateResult(row, false)?.error ?? "",
    /aprovado, mas o e-mail de aviso não foi enviado/,
  );
  assert.deepEqual(
    updateResult({ ...row, full_name: null, status: "bloqueado" }),
    { message: "Status de ana@emap.ma.gov.br: Bloqueado (Operador)." },
  );
});

test("approvalEmail links to login and escapes the name", () => {
  const mail = approvalEmail(
    '<img src=x onerror="x">',
    "https://itaqui-digital.vercel.app/login",
  );
  assert.equal(mail.subject, "Sua conta no Itaqui Digital foi aprovada");
  assert.ok(
    mail.html.includes('href="https://itaqui-digital.vercel.app/login"'),
  );
  assert.ok(!mail.html.includes("<img"));
  assert.ok(mail.html.includes("&#60;img"));
  assert.ok(mail.text.includes("https://itaqui-digital.vercel.app/login"));
  assert.ok(approvalEmail(null, "/login").text.startsWith("Olá!"));
});
