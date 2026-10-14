import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authErrorMessage,
  safeNext,
  signupErrorMessage,
  SIGNUP_CLOSED,
} from "../src/lib/auth";

test("safeNext keeps same-origin relative paths", () => {
  for (const path of ["/", "/3d", "/3d?berco=101#vista", "/a/b%2F%2Fc"])
    assert.equal(safeNext(path), path);
});

test("safeNext rejects external, malformed and non-string targets", () => {
  for (const value of [
    "//evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    undefined,
    null,
    ["/3d"],
  ])
    assert.equal(safeNext(value), "/", String(value));
});

test("authErrorMessage maps GoTrue codes to pt-BR", () => {
  assert.equal(
    authErrorMessage("invalid_credentials"),
    "E-mail ou senha incorretos.",
  );
  for (const code of [
    "email_not_confirmed",
    "user_already_exists",
    "weak_password",
    "same_password",
    "over_email_send_rate_limit",
    "over_request_rate_limit",
    "otp_expired",
    "validation_failed",
    "email_address_invalid",
    "signup_disabled",
  ])
    assert.notEqual(authErrorMessage(code), authErrorMessage(), code);
});

test("signupErrorMessage detects the closed-signup hook", () => {
  for (const error of [
    { status: 403, code: "unknown", message: "qualquer" },
    { status: 403, code: "hook_payload_invalid" },
    { status: 500, code: "unexpected_failure", message: SIGNUP_CLOSED },
  ])
    assert.equal(signupErrorMessage(error), SIGNUP_CLOSED);
  assert.equal(
    signupErrorMessage({ status: 403, code: "signup_disabled" }),
    authErrorMessage("signup_disabled"),
  );
  assert.equal(
    signupErrorMessage({ status: 422, code: "weak_password" }),
    authErrorMessage("weak_password"),
  );
});

test("authErrorMessage falls back for unknown or prototype codes", () => {
  const fallback = "Não foi possível concluir. Tente novamente.";
  for (const code of [undefined, "", "unexpected_failure", "toString"])
    assert.equal(authErrorMessage(code), fallback);
});
