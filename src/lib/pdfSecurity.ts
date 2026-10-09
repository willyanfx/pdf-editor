/**
 * PDF encryption / decryption via qpdf compiled to WASM.
 *
 * pdf-lib can neither write encryption nor read encrypted content (it throws
 * EncryptedPDFError, or with `ignoreEncryption` returns still-encrypted
 * streams), so the editor's pdf-lib pipeline works on decrypted bytes and
 * protection is applied as a final pass over the exported file. qpdf is loaded
 * lazily so its ~1.3MB wasm only downloads when security is actually used.
 *
 * Everything but `encryptPdf` / `decryptPdf` is pure and importable from UI code
 * without pulling in the wasm.
 */

export type PrintPermission = "full" | "low" | "none";

/** What a viewer that honors the permissions password may do with the file. */
export type PdfPermissions = {
  print: PrintPermission;
  /** Copy text and images out of the document. */
  copy: boolean;
  /** Change the page content. */
  edit: boolean;
  /** Add comments and fill in form fields. */
  annotate: boolean;
  /** Insert, delete, rotate and reorder pages. */
  assemble: boolean;
};

export const ALL_PERMISSIONS: PdfPermissions = {
  print: "full",
  copy: true,
  edit: true,
  annotate: true,
  assemble: true,
};

export type ProtectOptions = {
  /** Password required to open the file. Empty = anyone can open it. */
  userPassword: string;
  /** Password required to change permissions/security. Needed for restrictions. */
  ownerPassword: string;
  permissions: PdfPermissions;
};

/** True when `p` withholds at least one capability. */
export function hasRestrictions(p: PdfPermissions): boolean {
  return p.print !== "full" || !p.copy || !p.edit || !p.annotate || !p.assemble;
}

/**
 * Why `options` can't be applied, or null when they're fine. Restrictions are
 * only enforceable with an owner password that differs from the open password —
 * a reader that opened the file with the user password would otherwise already
 * hold the owner's authority.
 */
export function validateProtectOptions(options: ProtectOptions): string | null {
  const restricted = hasRestrictions(options.permissions);
  if (!options.userPassword && !restricted) {
    return "Set a password to open the file, or restrict at least one permission.";
  }
  if (restricted && !options.ownerPassword) {
    return "Set a permissions password so the restrictions can't simply be switched off.";
  }
  if (restricted && options.userPassword && options.userPassword === options.ownerPassword) {
    return "The permissions password must differ from the open password, or the restrictions are meaningless.";
  }
  return null;
}

const yn = (b: boolean) => (b ? "y" : "n");

/** Build the qpdf argv that encrypts `input` into `output` with AES-256. */
export function buildEncryptArgs(options: ProtectOptions, input: string, output: string): string[] {
  const { permissions: p } = options;
  return [
    input,
    "--encrypt",
    options.userPassword,
    // qpdf rejects an open password paired with an empty owner password (the
    // empty one would unlock the file), so default the owner to the open password.
    options.ownerPassword || options.userPassword,
    "256",
    `--print=${p.print}`,
    `--extract=${yn(p.copy)}`,
    `--modify-other=${yn(p.edit)}`,
    `--annotate=${yn(p.annotate)}`,
    `--form=${yn(p.annotate)}`,
    `--assemble=${yn(p.assemble)}`,
    // Screen readers must keep working regardless of the copy restriction.
    "--accessibility=y",
    "--",
    output,
  ];
}

/**
 * pdf-lib ships ES5-compiled error classes whose `instanceof` checks fail (the
 * thrown value is a bare Error), so recognise its "input is encrypted" error by
 * message.
 */
export function isEncryptedPdfError(err: unknown): boolean {
  return err instanceof Error && /\bis encrypted\b/.test(err.message);
}

/** The file is encrypted and the supplied password was missing or wrong. */
export class PdfPasswordError extends Error {
  constructor() {
    super("Incorrect or missing PDF password");
    this.name = "PdfPasswordError";
  }
}

type QpdfFS = {
  writeFile: (path: string, data: Uint8Array) => void;
  readFile: (path: string) => Uint8Array;
  unlink: (path: string) => void;
};
type Qpdf = { callMain: (args: string[]) => number; FS: QpdfFS };

let qpdfPromise: Promise<Qpdf> | null = null;
let stderr: string[] = [];

function loadQpdf(): Promise<Qpdf> {
  qpdfPromise ??= (async () => {
    const [{ default: createQpdf }, { default: wasmUrl }] = await Promise.all([
      import("@neslinesli93/qpdf-wasm"),
      import("@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url"),
    ]);
    // The typings only declare locateFile; Emscripten also takes print hooks.
    const create = createQpdf as unknown as (opts: Record<string, unknown>) => Promise<Qpdf>;
    return create({
      locateFile: () => wasmUrl,
      print: () => {},
      printErr: (line: string) => stderr.push(line),
    });
  })();
  // Don't cache a failed load (e.g. offline) — let the next attempt retry.
  qpdfPromise.catch(() => {
    qpdfPromise = null;
  });
  return qpdfPromise;
}

let jobCounter = 0;

/** Run one qpdf job over `bytes`; resolves with the output file's bytes. */
async function runQpdf(
  bytes: Uint8Array,
  argsFor: (input: string, output: string) => string[],
): Promise<{ status: number; output: Uint8Array | null; log: string }> {
  const qpdf = await loadQpdf();
  const id = ++jobCounter;
  const input = `/in-${id}.pdf`;
  const output = `/out-${id}.pdf`;
  stderr = [];
  qpdf.FS.writeFile(input, bytes);
  let status: number;
  try {
    status = qpdf.callMain(argsFor(input, output));
  } catch (err) {
    // Emscripten surfaces a non-zero exit as a thrown ExitStatus.
    const code = (err as { status?: unknown } | null)?.status;
    if (typeof code !== "number") throw err;
    status = code;
  }
  let out: Uint8Array | null = null;
  // qpdf exits 3 for "succeeded with warnings" and still writes the output.
  if (status === 0 || status === 3) {
    try {
      out = qpdf.FS.readFile(output).slice();
    } catch {
      out = null;
    }
  }
  for (const path of [input, output]) {
    try {
      qpdf.FS.unlink(path);
    } catch {
      /* output may not exist */
    }
  }
  return { status, output: out, log: stderr.join("\n") };
}

/** Encrypt `bytes` (an unencrypted PDF) with AES-256 and the given permissions. */
export async function encryptPdf(bytes: Uint8Array, options: ProtectOptions): Promise<Uint8Array> {
  const problem = validateProtectOptions(options);
  if (problem) throw new Error(problem);
  const { status, output, log } = await runQpdf(bytes, (i, o) => buildEncryptArgs(options, i, o));
  if (!output) throw new Error(`qpdf could not encrypt this PDF (exit ${status}): ${log}`);
  return output;
}

/**
 * Strip all encryption from `bytes` using `password` (the user or owner
 * password; empty works for files that only carry owner restrictions).
 * Throws PdfPasswordError when the password doesn't open the file. `bytes` must
 * be a well-formed encrypted PDF: a corrupt file fails the same way.
 */
export async function decryptPdf(bytes: Uint8Array, password = ""): Promise<Uint8Array> {
  const { status, output, log } = await runQpdf(bytes, (i, o) => [
    `--password=${password}`,
    "--decrypt",
    i,
    o,
  ]);
  if (output) return output;
  // qpdf's exit code (2) is the same for a wrong password and for a damaged file,
  // and Emscripten doesn't route its stderr through our hook under Node, so
  // callers must only pass files already known to be encrypted — for those, a
  // failed open is a password problem.
  if (status === 2) throw new PdfPasswordError();
  throw new Error(`qpdf could not decrypt this PDF (exit ${status}): ${log}`);
}
