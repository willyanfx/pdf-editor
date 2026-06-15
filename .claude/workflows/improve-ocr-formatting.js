export const meta = {
  name: "improve-ocr-formatting",
  description:
    "Improve the OCR pipeline so a scanned PDF (the Rapha clinical doc) extracts as formatted editable text — preserving bold headings and bullet/numbered lists — and add whole-document + region OCR modes",
  whenToUse:
    "Run to close the gap between the current flat-paragraph OCR output and the richly-formatted .docx target (bold section labels, 206 list items), evaluate alternative OCR engines, and design the whole-PDF and region OCR flows.",
  phases: [
    { title: "Ground", detail: "map the current OCR pipeline, data model, and the two OCR entry points in code" },
    { title: "Investigate", detail: "one agent per angle: bold detection, list/numbering reconstruction, engine alternatives, whole-doc OCR, region OCR" },
    { title: "Verify", detail: "adversarially fact-check each angle's load-bearing claims" },
    { title: "Synthesize", detail: "merge into one plan: pipeline changes + UX for whole-doc & region modes" },
  ],
};

// --- The concrete target, grounded in the user's real files ----------------

const ASSETS = `Reference assets staged in .claude/workflow-assets/ (READ THEM):
- rapha-sample-page1.png / rapha-sample-page2.png — two rendered pages of the SOURCE scan
  ("Rapha May PDF.pdf", a 35-page image-only scan with NO text layer).
- rapha-target-text.txt — the EXPECTED output, derived from the user's gold-standard OCR
  ("Rapha May PDF-ocr.docx"). Lines marked [BOLD] are bold section headings; lines starting
  with "  • " are bulleted list items whose full (often multi-line) text is preserved on one line.
The original files are at /Users/wgeraldo/Downloads/Rapha May PDF.pdf and
/Users/wgeraldo/Downloads/Rapha May PDF-ocr.docx — agents MAY inspect them directly
(e.g. unzip the .docx to read word/document.xml + word/numbering.xml) but the staged
assets are the fast path.`;

const TARGET = `What "preserving formatting" means for THIS document (see rapha-target-text.txt):
1. Bold section headings ("Client Profile", "History of present condition", "Past medical history",
   "Objective Information", etc.) must come out as their OWN block, flagged bold — NOT merged into
   the paragraph or list below them.
2. Bullet list items (• under each heading) must each be a separate editable block, with the bullet
   preserved, and a wrapped multi-line item joined into ONE block (not split per visual line).
3. Inline bold labels ("Client name:", "Age:", "Gender:", "Occupation:") should ideally keep their
   bold weight, though block-level bold-heading detection is the priority.
4. Character accuracy is secondary to STRUCTURE here — even the gold .docx has OCR slips
   ("3/1 Oat rest" for "3/10 at rest"). The user's complaint is LOST FORMATTING, not garbled letters.`;

const CURRENT_STATE = `Current pipeline (verify against live code in src/lib/ocr.ts — it was recently changed):
- recognizePageRegion(canvas, renderWidth, region?, onProgress) does BOTH whole-page (region omitted)
  and region (drag-rect) OCR. It now pre-processes (greyscale/contrast/DPI upscale), sets tuned
  Tesseract params (preserve_interword_spaces, user_defined_dpi, thresholding_method), picks PSM
  AUTO for pages / SINGLE_BLOCK for crops, and reconstructs paragraphs via paragraphsFromData()
  using line-gap + first-word-x0 geometry, with bullet-marker detection and misread-bullet recovery.
- paragraphsFromData() returns OcrParagraph[] = { text, bbox, isListItem }. It does NOT detect bold,
  does NOT tie list items to a real numbering scheme, and ALWAYS emits bold:false downstream.
- ocrBoxToScreenItem() projects each paragraph to a ScreenTextItem; OcrLayer/PdfViewer turn each into
  a cover-text edit via makeCoverTextEdit(). bold is hard-coded false in ocrLine/Para projection.

Entry points today:
- Region OCR: src/components/OcrLayer.tsx — drag a rectangle, OCRs that region. WORKS.
- Whole-PAGE OCR: src/components/PdfViewer.tsx (ocrRequestPageIndex effect) — OCRs the one selected
  rendered page canvas. WORKS, but only the current page, not all 35.
- There is NO whole-DOCUMENT (all pages) OCR, and pages must be rendered to a canvas first.

Data model facts (src/store/useEditorStore.ts, src/lib/textLayer.ts):
- ScreenTextItem and TextRun ALREADY carry a per-run/box 'bold' boolean — OCR just never sets it.
- makeCoverTextEdit(item, pageIndex, coverColor) builds a TextEdit; textToRuns honors run.bold/italic.
- Tesseract v5 blocks tree exposes per-word font attributes (is_bold, bbox, confidence) and
  rowAttributes — currently unread.`;

const REPO_CONTEXT = `Browser-based PDF editor (Vite + React + TS), fully client-side.
Deps: tesseract.js ^5.1.1, pdf-lib, pdfjs-dist ^5.4.296 (pinned), react-pdf, @pdf-lib/fontkit,
mammoth (docx->html, already a dep), zustand, react-rnd. Pages are rendered by react-pdf to canvas;
PdfViewer owns the canvases (canvasRefs). Constraint: prefer staying client-side/offline; reuse the
existing single tesseract.js worker queue and the cover-text edit model. A new npm dep or optional
server/cloud step is acceptable ONLY if the quality/structure gain is clearly justified and called out.`;

const ANGLES = [
  {
    key: "bold-heading-detection",
    label: "Bold heading & inline-bold detection",
    focus: `How to detect bold text from OCR so section headings (and ideally inline labels) come out
flagged bold. Read tesseract.js word-level font attributes (is_bold and friends) from the blocks tree
— verify they're actually populated by the v5 WASM build (the LSTM engine may not fill them). Fallback
signals if is_bold is unreliable: stroke-density / darkness of the word's pixels vs the page median,
larger font size, standalone short line above a list. How to map a detected-bold line to
ScreenTextItem.bold / TextRun.bold (the model already supports it). Aim: every [BOLD] heading in
rapha-target-text.txt is flagged, with few false positives on body text.`,
  },
  {
    key: "list-numbering-reconstruction",
    label: "List / bullet structure reconstruction",
    focus: `How to turn the • items in the scan into clean, separate list blocks that match the target:
bullet glyph preserved/normalized, each item its own block, wrapped continuation lines merged into the
item, and items grouped under their heading. Examine whether Tesseract's paragraph/block hierarchy or
pure geometry (bullet x-column + hanging indent of wrapped lines) is more reliable on THIS layout.
Consider whether to model an ordered/unordered list type (like the .docx numbering.xml) vs just keeping
the literal bullet glyph in the text. Tie back to the existing paragraphsFromData() isListItem flag.`,
  },
  {
    key: "engine-alternatives",
    label: "Alternative CLIENT-SIDE OCR approaches",
    focus: `CONSTRAINT: the user wants to stay fully client-side/offline — do NOT recommend a cloud
Document AI path as the answer (only mention cloud briefly as a rejected option, noting it uploads the
doc). Compare CLIENT-SIDE approaches that improve STRUCTURE + accuracy on this printed clinical scan:
(a) tesseract.js hOCR/ALTO output (carries font weight, size, and nested block/par/line/word structure
— richer than the plain blocks tree we use); (b) Tesseract traineddata 'best' vs default and OEM modes;
(c) in-browser ML layout/structure models (PaddleOCR PP-StructureV2 / PP-OCRv5 via onnxruntime-web,
docTR ONNX) for heading+list detection — weigh model-download size vs benefit. For each: does it
preserve bold & lists, is it truly browser-feasible, and is it worth it vs just improving the Tesseract
path. Note what Adobe/ABBYY (which made the user's gold .docx) do that we don't, but keep the
recommendation client-side.`,
  },
  {
    key: "whole-document-ocr",
    label: "Whole-document (all pages) OCR mode",
    focus: `Design a 'OCR entire PDF' flow for the 35-page scan. How to render every page to a canvas
(reuse PdfViewer canvasRefs vs render off-screen via pdfjs getViewport/render at a target DPI),
serialize through the single tesseract.js worker queue with overall progress + cancel, place results
as edits on each page, and keep memory bounded (don't hold 35 hi-res canvases at once). Per-page error
isolation (one bad page shouldn't abort the run). Where the trigger lives (ToolRail/CommandPalette).
Consider time: ~1s/page in testing → ~35s; surface progress as 'page N of 35'.`,
  },
  {
    key: "region-ocr-ux",
    label: "Region OCR mode & UX",
    focus: `Refine the existing drag-region OCR (OcrLayer.tsx). Best PSM for a region (single block vs
single line for a 1-line crop), making region OCR respect the same bold/list reconstruction, and the
interaction: drag rectangle, show recognized blocks, drop into select mode for editing. Edge cases:
tiny crops, crops spanning a heading + list, crops at high zoom. How region and whole-doc modes share
one recognition core so improvements land in both.`,
  },
  {
    key: "formatted-export",
    label: "Formatted-document export (.docx / clean doc)",
    focus: `The user ALSO wants to export the OCR result as a flowing FORMATTED document (like the gold
rapha-target-text.txt / .docx), not only positioned overlay edits. Design how the reconstructed blocks
(heading vs list-item vs body, bold flags, list grouping) serialize to a clean document. Compare
client-side options: generating a .docx (e.g. the 'docx' npm library, or hand-writing the minimal
OOXML word/document.xml + numbering.xml that the gold file uses — note 'mammoth' is already a dep but
it only goes docx->html, not html->docx), vs exporting a formatted PDF via the existing pdf-lib
exportPdf.ts, vs HTML/Markdown. Map the editor's block model (headings, bullets, bold runs) to the
target's structure (ListParagraph + numPr + bold runs). Keep it client-side. Tie concretely to
reproducing a section of rapha-target-text.txt (a bold heading followed by its bullet list).`,
  },
];

const ANGLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["key", "summary", "findings", "recommendation", "appliesToTarget", "claims", "sources"],
  properties: {
    key: { type: "string", description: "Angle key, copied verbatim." },
    summary: { type: "string", description: "2-4 sentence overview of the finding." },
    findings: {
      type: "array",
      description: "Concrete options/techniques, ranked best-first for this codebase.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "whatItDoes", "browserFeasible", "tradeoffs"],
        properties: {
          name: { type: "string" },
          whatItDoes: { type: "string" },
          browserFeasible: {
            type: "string",
            enum: ["client-side", "client-side-with-wasm", "needs-server", "needs-cloud-api"],
          },
          tradeoffs: { type: "string" },
        },
      },
    },
    recommendation: { type: "string", description: "The single best choice for this angle and why." },
    appliesToTarget: {
      type: "string",
      description:
        "Concretely, how this makes the Rapha output match rapha-target-text.txt better (cite a heading or bullet example).",
    },
    claims: {
      type: "array",
      description: "3-6 specific checkable claims this angle relies on (for verification).",
      items: { type: "string" },
    },
    sources: { type: "array", items: { type: "string" } },
  },
};

const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts", "overallConfidence"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["claim", "status", "note"],
        properties: {
          claim: { type: "string" },
          status: { type: "string", enum: ["supported", "refuted", "unverifiable", "needs-nuance"] },
          note: { type: "string" },
        },
      },
    },
    overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "recommendedApproach",
    "formatPreservation",
    "wholeDocumentMode",
    "regionMode",
    "formattedExport",
    "pipelineStages",
    "newLibraries",
    "filesToTouch",
    "effort",
    "risks",
    "openQuestions",
  ],
  properties: {
    recommendedApproach: {
      type: "string",
      description: "End-to-end prose: engine path, format preservation, and the two OCR modes.",
    },
    formatPreservation: {
      type: "string",
      description: "Exactly how bold headings and list items get detected and carried into the edit model.",
    },
    wholeDocumentMode: {
      type: "string",
      description: "How 'OCR entire PDF' works: rendering, queue, progress/cancel, memory, trigger UI.",
    },
    regionMode: {
      type: "string",
      description: "How the drag-region OCR works and shares the recognition core with whole-doc.",
    },
    formattedExport: {
      type: "string",
      description:
        "How the reconstructed blocks export to a flowing formatted document (.docx or formatted PDF), client-side: chosen format, library/approach, and how headings/bold/lists map to it.",
    },
    pipelineStages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "does", "tech"],
        properties: {
          stage: { type: "string" },
          does: { type: "string" },
          tech: { type: "string" },
        },
      },
    },
    newLibraries: { type: "array", items: { type: "string" } },
    filesToTouch: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "change"],
        properties: {
          path: { type: "string" },
          change: { type: "string" },
        },
      },
    },
    effort: { type: "string", enum: ["S", "M", "L"] },
    risks: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
  },
};

function groundPrompt() {
  return `You are mapping the CURRENT OCR pipeline of a browser PDF editor before a team improves it for FORMAT PRESERVATION.

${ASSETS}

${TARGET}

${CURRENT_STATE}

${REPO_CONTEXT}

Read src/lib/ocr.ts, src/components/OcrLayer.tsx, src/components/PdfViewer.tsx (the ocrRequestPageIndex effect), and the TextRun/TextEdit/ScreenTextItem definitions in src/store/useEditorStore.ts and src/lib/textLayer.ts. Also open rapha-sample-page1.png and skim rapha-target-text.txt. Report, with file:line citations:
- The exact data path from a page canvas to a placed cover-text edit, and where 'bold' is hard-coded false.
- What the tesseract.js recognize() call currently returns and which fields are unused (word is_bold, rowAttributes, confidence, hOCR).
- Precisely why, in this code, a bold heading like "Past medical history" would currently come out NOT bold and possibly merged with the bullet below it.
- The current whole-PAGE OCR trigger and why there's no whole-DOCUMENT option.
This baseline is what every other agent builds on. Return plain prose.`;
}

function anglePrompt(a, baseline) {
  return `You are researching ONE angle of improving a browser PDF editor's OCR so a scanned clinical document extracts as FORMATTED editable text (bold headings + bullet lists), matching a gold .docx target.

${TARGET}

${ASSETS}

Your angle: "${a.label}" (key: ${a.key})
Focus: ${a.focus}

Baseline (current pipeline):
${baseline}

${CURRENT_STATE}

${REPO_CONTEXT}

Research with web search + the staged assets + (optionally) the real files. Prefer client-side/offline solutions but include server/cloud where they clearly win on STRUCTURE. For every option state browser-feasibility and tradeoffs, and concretely tie it to making the Rapha output match rapha-target-text.txt (cite a specific heading or bullet). List load-bearing factual claims for verification. Copy key="${a.key}" verbatim. Return ONLY the structured object.`;
}

function verifyPrompt(a, claims) {
  return `Adversarially fact-check these claims from OCR-improvement angle "${a.label}". Try to REFUTE each using authoritative sources; default to "unverifiable" if you can't confirm. Watch especially for: whether tesseract.js's WASM/LSTM build actually populates word is_bold/font fields, overstated ML-model accuracy, "browser-feasible" claims that need native/server, and cloud APIs that don't really emit heading/list roles.

Claims:
${claims.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Return ONLY the structured object.`;
}

function synthPrompt(baseline, angles) {
  const findings = angles
    .map(
      (a) =>
        `### ${a.label} (${a.key})\nSummary: ${a.summary}\nRecommendation: ${a.recommendation}\nApplies to target: ${a.appliesToTarget}\nFindings: ${JSON.stringify(a.findings)}\nVerification: ${JSON.stringify(a.verification?.verdicts || [])} (confidence: ${a.verification?.overallConfidence || "n/a"})`,
    )
    .join("\n\n");

  return `You are the lead architect. Merge the verified research into ONE plan to make the scanned Rapha PDF extract as FORMATTED editable text (bold headings + bullet lists matching rapha-target-text.txt), and to ship BOTH a whole-document and a region OCR mode.

${TARGET}

Baseline:
${baseline}

${CURRENT_STATE}

${REPO_CONTEXT}

Verified research:
${findings}

SCOPE DECISIONS (from the user — honor these):
- STAY CLIENT-SIDE / offline. Do NOT propose a cloud OCR path as the recommendation; the document must
  not be uploaded. If cloud was the only way to get some structure, say so as an open question, not the plan.
- In ADDITION to positioned overlay edits on the scan, the plan MUST include a formatted-document EXPORT
  (.docx or formatted PDF) that reproduces headings + bold + bullet lists — populate the formattedExport field.

Rules:
- Lowest-complexity approach that actually preserves bold headings + lists. Reuse the existing
  tesseract.js single-worker queue, paragraphsFromData(), and the cover-text edit model (which already
  has a bold flag) unless a HIGH-confidence claim says otherwise.
- Treat any "refuted"/"unverifiable" claim as NON-load-bearing — don't build on it; list it under openQuestions.
- Be explicit about: how bold is detected and carried to TextRun.bold; how list items are reconstructed
  and grouped under headings; how whole-document OCR renders+queues 35 pages with progress/cancel and
  bounded memory; how region OCR shares the same core. Map each to concrete files (ocr.ts, OcrLayer.tsx,
  PdfViewer.tsx, useEditorStore.ts, ToolRail/CommandPalette).
- Separate quick wins (read word is_bold / hOCR, geometry list grouping) from larger bets (ML layout model, cloud Document AI).
Return ONLY the structured object.`;
}

phase("Ground");
log("Mapping the current OCR pipeline, data model, and entry points...");
const baseline = await agent(groundPrompt(), {
  label: "ground:pipeline-and-target",
  phase: "Ground",
  agentType: "Explore",
});

phase("Investigate");
log(`Researching ${ANGLES.length} angles, verifying each as it completes...`);
const investigated = await pipeline(
  ANGLES,
  (a) =>
    agent(anglePrompt(a, baseline), {
      label: `research:${a.key}`,
      phase: "Investigate",
      schema: ANGLE_SCHEMA,
    }),
  (research, a) => {
    if (!research) return null;
    return agent(verifyPrompt(a, research.claims), {
      label: `verify:${a.key}`,
      phase: "Verify",
      schema: VERDICT_SCHEMA,
    }).then((verification) => ({ ...research, label: a.label, verification }));
  },
);

const angles = investigated.filter(Boolean);
log(`${angles.length}/${ANGLES.length} angles researched and verified.`);

phase("Synthesize");
log("Synthesizing the implementation plan (format + whole-doc + region)...");
const plan = await agent(synthPrompt(baseline, angles), {
  label: "synthesize:plan",
  phase: "Synthesize",
  schema: PLAN_SCHEMA,
  agentType: "Plan",
});

return { baseline, angles, plan };
