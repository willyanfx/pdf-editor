import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { PenLine } from "lucide-react";
import { useEditorStore } from "../store/useEditorStore";
import { extractScreenTextItems } from "../lib/textLayer";
import { findSignatureZones, type SignatureZone } from "../lib/signatureZones";
import { VIEWER_WIDTH } from "../lib/pdfGeometry";

type Props = {
  pageIndex: number;
  page: PDFPageProxy | null;
};

const KIND_LABEL: Record<SignatureZone["kind"], string> = {
  signature: "Sign here",
  initials: "Initials",
  date: "Date",
};

/**
 * Overlay (active only in "signZones" mode) that highlights auto-detected
 * signature / initials / date spots. Clicking a zone records it as the next
 * signature's placement target and opens the SignatureModal, so the drawn/typed
 * signature drops exactly where the document asks for it. Detection is the pure
 * `findSignatureZones` pass over the page's positioned text.
 */
export function SignatureZoneLayer({ pageIndex, page }: Props) {
  const mode = useEditorStore((s) => s.mode);
  const setSignaturePlacement = useEditorStore((s) => s.setSignaturePlacement);
  const setSignatureModalOpen = useEditorStore((s) => s.setSignatureModalOpen);
  const [zones, setZones] = useState<SignatureZone[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!page) {
      setZones([]);
      return;
    }
    void extractScreenTextItems(page, VIEWER_WIDTH).then((items) => {
      if (cancelled) return;
      setZones(findSignatureZones(items));
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  if (mode !== "signZones" || zones.length === 0) return null;

  function pick(zone: SignatureZone) {
    setSignaturePlacement({
      pageIndex,
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
    });
    setSignatureModalOpen(true);
  }

  return (
    <div className="sigzone-layer">
      {zones.map((z) => (
        <button
          key={z.id}
          type="button"
          className={`sigzone-target sigzone-${z.kind}`}
          title={`${KIND_LABEL[z.kind]} — click to add a signature here`}
          style={{ left: z.x, top: z.y, width: z.width, height: z.height }}
          onClick={(e) => {
            e.stopPropagation();
            pick(z);
          }}
        >
          <PenLine size={14} aria-hidden />
          <span>{KIND_LABEL[z.kind]}</span>
        </button>
      ))}
    </div>
  );
}
