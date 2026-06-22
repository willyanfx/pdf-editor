import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { fileToDataUrl } from "./file";
import { resolveImagePlacement } from "./signatureZones";

const IMAGE_TYPES = ["image/png", "image/jpeg"];

/** Convert a non-PDF file (image/Word/Excel) to a PDF and open it as the doc. */
export async function openConvertedFile(file: File): Promise<void> {
  const { convertToPdf } = await import("./convertToPdf");
  const bytes = await convertToPdf(file);
  const name = file.name.replace(/\.[^.]+$/, "") + ".pdf";
  const pdfFile = new File([bytes.slice()], name, { type: "application/pdf" });
  useEditorStore.getState().setFile(pdfFile);
  useToastStore.getState().addToast("Converted to PDF", "success");
}

/**
 * Fetch a PDF from a URL and open it as the document. Throws on network/CORS
 * failure, a non-OK response, or a non-PDF payload so callers can show a toast.
 * The derived filename is the URL's last path segment (fallback "document.pdf").
 */
export async function openPdfFromUrl(url: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // fetch rejects on network errors and (opaquely) on CORS blocks.
    throw new Error("network-or-cors");
  }
  if (!res.ok) throw new Error(`http-${res.status}`);

  const blob = await res.blob();
  const looksPdf =
    blob.type === "application/pdf" || /\.pdf(\?|#|$)/i.test(url) || blob.type === "";
  if (!looksPdf) throw new Error("not-a-pdf");

  const name = url.split(/[?#]/)[0].split("/").pop() || "document.pdf";
  const fileName = /\.pdf$/i.test(name) ? name : `${name || "document"}.pdf`;
  const bytes = await blob.arrayBuffer();
  const file = new File([bytes], fileName, { type: "application/pdf" });
  useEditorStore.getState().setFile(file);
}

/** Add an image edit (from a data URL) on the current page. Shared by the image
 * picker, drop handler, and signature modal so the edit shape stays in one place.
 *
 * When an auto-detected signature zone is targeted (`signaturePlacement` set),
 * the image drops into that zone (correct page + fitted size) instead of the
 * default corner; the placement is consumed and cleared afterward. */
export function addImageDataUrl(
  dataUrl: string,
  size: { width: number; height: number } = { width: 220, height: 120 },
): void {
  const { addEdit, selectedPageIndex, signaturePlacement, setSignaturePlacement } =
    useEditorStore.getState();
  const placed = resolveImagePlacement(
    signaturePlacement
      ? {
          id: "placement",
          kind: "signature",
          x: signaturePlacement.x,
          y: signaturePlacement.y,
          width: signaturePlacement.width,
          height: signaturePlacement.height,
        }
      : null,
    size,
  );
  addEdit({
    id: crypto.randomUUID(),
    type: "image",
    pageIndex: signaturePlacement?.pageIndex ?? selectedPageIndex,
    x: placed.x,
    y: placed.y,
    width: placed.width,
    height: placed.height,
    dataUrl,
    origin: "added",
  });
  if (signaturePlacement) setSignaturePlacement(null);
}

/** Add an image/signature edit on the current page from a File. */
export async function addImageFromFile(file: File): Promise<void> {
  const dataUrl = await fileToDataUrl(file);
  addImageDataUrl(dataUrl);
}

/** Route dropped/picked files to the right action: a PDF opens (or replaces)
 * the document; an image is added as an edit when a PDF is already open.
 * Unsupported files are ignored. */
export function openFiles(files: FileList | File[] | null | undefined): void {
  if (!files) return;
  const list = Array.from(files);

  const pdf = list.find((f) => f.type === "application/pdf");
  if (pdf) {
    useEditorStore.getState().setFile(pdf);
    return;
  }

  const hasPdf = useEditorStore.getState().file != null;

  // No PDF dropped. If one is already open, an image becomes an edit; otherwise
  // a convertible file (image/Word/Excel) is converted into a new PDF document.
  const image = list.find((f) => IMAGE_TYPES.includes(f.type));
  if (hasPdf && image) {
    void addImageFromFile(image).catch(() => {
      useToastStore.getState().addToast("Could not decode that image.", "error");
    });
    return;
  }

  const convertible = list.find((f) => /\.(docx|xlsx|xls|csv|png|jpe?g)$/i.test(f.name));
  if (convertible) {
    void openConvertedFile(convertible).catch(() => {
      useToastStore.getState().addToast("Could not convert that file.", "error");
    });
  }
}
