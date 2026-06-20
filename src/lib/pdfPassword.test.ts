import { test, expect } from "vite-plus/test";
import {
  isPasswordException,
  passwordPromptState,
  makeOnPassword,
  NEED_PASSWORD,
  INCORRECT_PASSWORD,
} from "./pdfPassword";

/** A shape that mimics pdf.js's PasswordException (name + numeric code). */
function passwordError(code: number) {
  return { name: "PasswordException", message: "No password", code };
}

test("isPasswordException recognizes pdf.js password errors by name", () => {
  expect(isPasswordException(passwordError(NEED_PASSWORD))).toBe(true);
  expect(isPasswordException(passwordError(INCORRECT_PASSWORD))).toBe(true);
});

test("isPasswordException rejects unrelated errors", () => {
  expect(isPasswordException(new Error("boom"))).toBe(false);
  expect(isPasswordException({ name: "InvalidPDFException" })).toBe(false);
  expect(isPasswordException(null)).toBe(false);
  expect(isPasswordException(undefined)).toBe(false);
  expect(isPasswordException("PasswordException")).toBe(false);
});

test("passwordPromptState maps NEED_PASSWORD to a first-time prompt", () => {
  const s = passwordPromptState(passwordError(NEED_PASSWORD));
  expect(s.needsPassword).toBe(true);
  expect(s.wrong).toBe(false);
});

test("passwordPromptState maps INCORRECT_PASSWORD to a retry prompt", () => {
  const s = passwordPromptState(passwordError(INCORRECT_PASSWORD));
  expect(s.needsPassword).toBe(true);
  expect(s.wrong).toBe(true);
});

test("passwordPromptState returns no-prompt for non-password errors", () => {
  const s = passwordPromptState(new Error("network"));
  expect(s.needsPassword).toBe(false);
  expect(s.wrong).toBe(false);
});

test("makeOnPassword feeds a known password straight into pdf.js on first ask", () => {
  let fed: string | null = null;
  let askedWrong = false;
  const onPassword = makeOnPassword({
    getPassword: () => "hunter2",
    onIncorrect: () => {
      askedWrong = true;
    },
  });
  onPassword((pw) => {
    fed = pw;
  }, NEED_PASSWORD);
  expect(fed).toBe("hunter2");
  expect(askedWrong).toBe(false);
});

test("makeOnPassword reports an incorrect password instead of re-feeding it", () => {
  let fed: string | null = null;
  let askedWrong = false;
  const onPassword = makeOnPassword({
    getPassword: () => "stale",
    onIncorrect: () => {
      askedWrong = true;
    },
  });
  onPassword((pw) => {
    fed = pw;
  }, INCORRECT_PASSWORD);
  // On rejection it must NOT loop by re-feeding the same wrong password.
  expect(fed).toBeNull();
  expect(askedWrong).toBe(true);
});

test("makeOnPassword reports a missing password as needing input on first ask", () => {
  let fed: string | null = null;
  let askedFor = false;
  const onPassword = makeOnPassword({
    getPassword: () => null,
    onNeedPassword: () => {
      askedFor = true;
    },
    onIncorrect: () => {},
  });
  onPassword((pw) => {
    fed = pw;
  }, NEED_PASSWORD);
  expect(fed).toBeNull();
  expect(askedFor).toBe(true);
});
