import { createRequire } from "node:module";
import { test, expect, vi } from "vite-plus/test";
import { PDFDocument } from "pdf-lib";
import { exportEditedPdf } from "./exportPdf";
import { isPdfEncrypted } from "./pdfMetadata";
import {
  ALL_PERMISSIONS,
  buildEncryptArgs,
  decryptPdf,
  encryptPdf,
  hasRestrictions,
  isEncryptedPdfError,
  validateProtectOptions,
  PdfPasswordError,
  type ProtectOptions,
} from "./pdfSecurity";

// Vite's `?url` import yields a browser-relative path; in Node the Emscripten glue
// reads the wasm from disk, so point it at the real file.
vi.mock("@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url", () => ({
  default: createRequire(import.meta.url).resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm"),
}));

const open = (over: Partial<ProtectOptions> = {}): ProtectOptions => ({
  userPassword: "",
  ownerPassword: "",
  permissions: ALL_PERMISSIONS,
  ...over,
});

test("hasRestrictions is false only when every permission is granted", () => {
  expect(hasRestrictions(ALL_PERMISSIONS)).toBe(false);
  expect(hasRestrictions({ ...ALL_PERMISSIONS, print: "low" })).toBe(true);
  expect(hasRestrictions({ ...ALL_PERMISSIONS, copy: false })).toBe(true);
  expect(hasRestrictions({ ...ALL_PERMISSIONS, assemble: false })).toBe(true);
});

test("validateProtectOptions requires some protection", () => {
  expect(validateProtectOptions(open())).toMatch(/Set a password/);
  expect(validateProtectOptions(open({ userPassword: "x" }))).toBeNull();
});

test("restrictions need a distinct permissions password", () => {
  const restricted = { ...ALL_PERMISSIONS, copy: false };
  expect(validateProtectOptions(open({ permissions: restricted }))).toMatch(/permissions password/);
  expect(
    validateProtectOptions(
      open({ permissions: restricted, userPassword: "same", ownerPassword: "same" }),
    ),
  ).toMatch(/must differ/);
  expect(
    validateProtectOptions(
      open({ permissions: restricted, userPassword: "a", ownerPassword: "b" }),
    ),
  ).toBeNull();
  // Owner-only protection (no open password) is valid.
  expect(validateProtectOptions(open({ permissions: restricted, ownerPassword: "b" }))).toBeNull();
});

test("buildEncryptArgs defaults the owner password to the open password", () => {
  const args = buildEncryptArgs(open({ userPassword: "pw" }), "/in.pdf", "/out.pdf");
  expect(args.slice(2, 4)).toEqual(["pw", "pw"]);
});

test("buildEncryptArgs maps permissions to qpdf flags", () => {
  const args = buildEncryptArgs(
    open({
      userPassword: "u",
      ownerPassword: "o",
      permissions: { print: "low", copy: false, edit: true, annotate: false, assemble: true },
    }),
    "/in.pdf",
    "/out.pdf",
  );
  expect(args.slice(0, 5)).toEqual(["/in.pdf", "--encrypt", "u", "o", "256"]);
  expect(args).toContain("--print=low");
  expect(args).toContain("--extract=n");
  expect(args).toContain("--modify-other=y");
  expect(args).toContain("--annotate=n");
  expect(args).toContain("--form=n");
  expect(args).toContain("--assemble=y");
  expect(args.slice(-2)).toEqual(["--", "/out.pdf"]);
});

async function samplePdf() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  doc.addPage([300, 300]);
  return new Uint8Array(await doc.save());
}

test("encrypt then decrypt round-trips through qpdf", async () => {
  const plain = await samplePdf();
  const encrypted = await encryptPdf(plain, open({ userPassword: "s3cret" }));

  // pdf-lib can't read it — proof the output really is encrypted.
  await expect(PDFDocument.load(encrypted).catch(isEncryptedPdfError)).resolves.toBe(true);

  const decrypted = await decryptPdf(encrypted, "s3cret");
  expect((await PDFDocument.load(decrypted)).getPageCount()).toBe(2);
});

test("decrypt rejects a wrong password", async () => {
  const encrypted = await encryptPdf(await samplePdf(), open({ userPassword: "right" }));
  await expect(decryptPdf(encrypted, "wrong")).rejects.toBeInstanceOf(PdfPasswordError);
});

test("owner-only protection opens with an empty password", async () => {
  const encrypted = await encryptPdf(
    await samplePdf(),
    open({ ownerPassword: "boss", permissions: { ...ALL_PERMISSIONS, print: "none" } }),
  );
  await expect(PDFDocument.load(encrypted).catch(isEncryptedPdfError)).resolves.toBe(true);
  expect((await PDFDocument.load(await decryptPdf(encrypted))).getPageCount()).toBe(2);
});

test("exportEditedPdf decrypts an encrypted source and writes it unprotected", async () => {
  const encrypted = await encryptPdf(await samplePdf(), open({ userPassword: "pw" }));
  const file = new File([encrypted.slice()], "locked.pdf", { type: "application/pdf" });

  const out = await exportEditedPdf(file, [], { password: "pw" });
  // Loads without ignoreEncryption → the export is no longer encrypted.
  expect((await PDFDocument.load(out)).getPageCount()).toBe(2);

  await expect(exportEditedPdf(file, [], { password: "nope" })).rejects.toBeInstanceOf(
    PdfPasswordError,
  );
});

test("isPdfEncrypted detects AES-256 files that ignoreEncryption can't parse", async () => {
  const plain = await samplePdf();
  const encrypted = await encryptPdf(plain, open({ userPassword: "pw" }));
  expect(await isPdfEncrypted(new File([plain.slice()], "a.pdf"))).toBe(false);
  expect(await isPdfEncrypted(new File([encrypted.slice()], "b.pdf"))).toBe(true);
});
