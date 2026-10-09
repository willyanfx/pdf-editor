import { PDFDocument } from "pdf-lib";
import { isEncryptedPdfError } from "./pdfSecurity";

/**
 * Load a PDF for editing with pdf-lib. pdf-lib refuses encrypted input outright
 * (and `ignoreEncryption` would hand back undecrypted streams), so an encrypted
 * file is first run through qpdf to strip the encryption. `password` is the user
 * or owner password; `onDecrypted` fires when that decryption step was needed, so
 * callers can tell the user the output no longer carries the original protection.
 *
 * Every pdf-lib load of a user's document should go through here — a bare
 * `PDFDocument.load` fails on any encrypted file.
 */
export async function loadPdfLibDocument(
  bytes: ArrayBuffer | Uint8Array,
  password?: string,
  onDecrypted?: () => void,
): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch (err) {
    if (!isEncryptedPdfError(err)) throw err;
    const { decryptPdf } = await import("./pdfSecurity");
    const plain = await decryptPdf(
      bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      password,
    );
    onDecrypted?.();
    return PDFDocument.load(plain);
  }
}
