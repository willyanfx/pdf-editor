import { useEditorStore } from "../store/useEditorStore";
import { fileToDataUrl } from "./file";

const IMAGE_TYPES = ["image/png", "image/jpeg"];

/** Add an image/signature edit on the current page. Shared by the toolbar's
 * "Add Image" button and by file drop, so the edit shape stays in one place. */
export async function addImageFromFile(file: File): Promise<void> {
  const dataUrl = await fileToDataUrl(file);
  const { addEdit, selectedPageIndex, setErrorMessage } = useEditorStore.getState();
  setErrorMessage(null);
  addEdit({
    id: crypto.randomUUID(),
    type: "image",
    pageIndex: selectedPageIndex,
    x: 100,
    y: 100,
    width: 220,
    height: 120,
    dataUrl,
  });
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

  // No PDF dropped — if one is already open, accept an image as an edit.
  const hasPdf = useEditorStore.getState().file != null;
  if (!hasPdf) return;

  const image = list.find((f) => IMAGE_TYPES.includes(f.type));
  if (image) {
    void addImageFromFile(image).catch(() => {
      useEditorStore.getState().setErrorMessage("Could not decode that image.");
    });
  }
}
