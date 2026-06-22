import { useEffect } from "react";
import { useToastStore } from "../store/useToastStore";
import { isLikelyScanned } from "../lib/scannedPdf";

/**
 * After a PDF opens, detect whether it's image-only (scanned) and, if so, prompt
 * the user once to run OCR — otherwise they'd see a page with no selectable or
 * clickable text and no hint that OCR exists. Runs once per File; cancels cleanly
 * if the document is replaced before detection finishes.
 */
export function useScannedPdfPrompt(file: File | null): void {
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    void isLikelyScanned(file).then((scanned) => {
      if (cancelled || !scanned) return;
      useToastStore
        .getState()
        .addToast(
          "This looks like a scanned PDF. Run Extract Text (OCR) to make it editable.",
          "info",
          6000,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [file]);
}
