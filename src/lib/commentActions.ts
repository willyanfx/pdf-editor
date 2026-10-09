import { PDFDocument } from "pdf-lib";
import { useEditorStore } from "../store/useEditorStore";
import { useBookmarksUiStore } from "../store/useBookmarksUiStore";
import { useCommentsUiStore } from "../store/useCommentsUiStore";
import { useToastStore } from "../store/useToastStore";
import { downloadText } from "./download";
import { isAnnotation } from "./annotations";
import type { XfdfPageSize } from "./xfdf";

/** The visible page order (falls back to natural order before it's seeded). */
function visibleOrder(): number[] {
  const { pageOrder, numPages } = useEditorStore.getState();
  return pageOrder.length ? pageOrder : Array.from({ length: numPages }, (_, i) => i);
}

/** Open the sidebar on the Comments view, optionally opening one thread. */
export function showComments(editId?: string): void {
  if (!useEditorStore.getState().file) return;
  if (editId) useCommentsUiStore.getState().setExpandedId(editId);
  useBookmarksUiStore.getState().showTab("comments");
}

/** PDF-point size of every original page of the open file (unrotated MediaBox,
 * the same space the export draws in). */
async function readPageSizes(file: File): Promise<XfdfPageSize[]> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  return doc.getPages().map((p) => ({ width: p.getWidth(), height: p.getHeight() }));
}

/** Download every comment and markup as an .xfdf file. */
export async function exportCommentsXfdf(): Promise<void> {
  const { file, edits } = useEditorStore.getState();
  const toast = useToastStore.getState().addToast;
  if (!file) return;
  if (!edits.some(isAnnotation)) {
    toast("There are no comments to export.", "info");
    return;
  }
  try {
    const [sizes, { exportXfdf }] = await Promise.all([readPageSizes(file), import("./xfdf")]);
    const xml = exportXfdf(edits, {
      pageOrder: visibleOrder(),
      pageSize: (i) => sizes[i],
      fileName: file.name,
    });
    downloadText(xml, file.name.replace(/\.pdf$/i, "") + ".xfdf", "application/vnd.adobe.xfdf");
    toast("Comments exported as XFDF", "success");
  } catch {
    toast("Could not export the comments.", "error");
  }
}

/** Plain-English summary of what an import skipped. */
function describeSkipped(skipped: Record<string, number>): string {
  const parts = Object.entries(skipped).map(([what, n]) => `${n} ${what}`);
  return parts.length ? ` Skipped: ${parts.join(", ")}.` : "";
}

/** Read an .xfdf file and add its comments to the open document (one undo step).
 * Comments already in the document (same id) are left alone, so importing the
 * file you just exported doesn't duplicate everything. */
export async function importCommentsXfdf(xfdfFile: File): Promise<void> {
  const { file } = useEditorStore.getState();
  const toast = useToastStore.getState().addToast;
  if (!file) return;
  try {
    const [sizes, { importXfdf, mergeImportedComments }, xml] = await Promise.all([
      readPageSizes(file),
      import("./xfdf"),
      xfdfFile.text(),
    ]);
    const { edits, skipped } = importXfdf(xml, {
      pageOrder: visibleOrder(),
      pageSize: (i) => sizes[i],
    });
    const { added, updated, unchanged } = mergeImportedComments(
      useEditorStore.getState().edits,
      edits,
    );
    const tail =
      (unchanged ? ` ${unchanged} already in this document.` : "") + describeSkipped(skipped);
    if (!added.length && !updated.length) {
      toast(`No new comments to import.${tail}`, "info");
      return;
    }
    useEditorStore.getState().applyEditChanges(added, updated);
    const parts = [
      added.length && `Imported ${added.length} comment${added.length === 1 ? "" : "s"}`,
      updated.length && `updated ${updated.length} with new replies or status`,
    ].filter(Boolean);
    const lead = parts.join(", ");
    toast(`${lead.charAt(0).toUpperCase()}${lead.slice(1)}.${tail}`, "success");
    showComments();
  } catch (err) {
    const notXfdf = err instanceof Error && /XFDF|Invalid XML/.test(err.message);
    toast(
      notXfdf ? "That file isn't a valid XFDF comments file." : "Could not import the comments.",
      "error",
    );
  }
}
