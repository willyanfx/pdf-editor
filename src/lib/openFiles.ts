import { useEditorStore } from "../store/useEditorStore";
import { useToastStore } from "../store/useToastStore";
import { fileToDataUrl } from "./file";

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

/** Add an image edit (from a data URL) on the current page. Shared by the image
 * picker, drop handler, and signature modal so the edit shape stays in one place. */
export function addImageDataUrl(
  dataUrl: string,
  size: { width: number; height: number } = { width: 220, height: 120 },
): void {
  const { addEdit, selectedPageIndex } = useEditorStore.getState();
  addEdit({
    id: crypto.randomUUID(),
    type: "image",
    pageIndex: selectedPageIndex,
    x: 100,
    y: 100,
    width: size.width,
    height: size.height,
    dataUrl,
    origin: "added",
  });
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
