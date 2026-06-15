export const meta = {
  name: 'evaluate-features',
  description: 'Audit the PDF editor against Adobe Acrobat features; draft a gap-closing plan for every feature that is absent or partial',
  whenToUse: 'Run to measure the codebase against Acrobat\'s marketed feature set and get an implementation plan for each gap.',
  phases: [
    { title: 'Audit', detail: 'one read-only agent per feature: implemented / partial / absent + file evidence' },
    { title: 'Plan', detail: 'one architect agent per non-implemented feature: files, libraries, approach' },
  ],
}

// --- Feature catalog: Acrobat's claims + a seed hint from a prior exploration.
// Agents re-verify against live code and MUST trust the code over the seed hint.
const FEATURES = [
  {
    key: 'edit-text-images',
    label: 'Edit text and images',
    acrobatClaim: 'Fix text and swap images right in the document without jumping to another app.',
    seedHint: 'Text editing implemented (textLayer.ts, ExistingTextLayer.tsx, RichTextEditor.tsx, exportPdf.ts). Placing new images implemented (openFiles.ts, EditBox.tsx). Swapping/replacing an image already embedded in the source PDF appears ABSENT.',
  },
  {
    key: 'create-from-other-formats',
    label: 'Create PDFs from other file types',
    acrobatClaim: 'Convert images, PowerPoint, spreadsheets, and Word docs into a PDF.',
    seedHint: 'Appears absent. File picker only accepts application/pdf; no docx/xlsx/pptx/image-to-pdf conversion pipeline or libraries.',
  },
  {
    key: 'sign',
    label: 'Sign documents',
    acrobatClaim: 'Sign documents.',
    seedHint: 'Partial: an "Add Image / Signature" overlay lets you place a PNG/JPEG (e.g. a photo of a signature). No freehand signature canvas and no cryptographic/certificate-based digital signing.',
  },
  {
    key: 'organize-reorder-pages',
    label: 'Organize and reorder pages',
    acrobatClaim: 'Add, reorder via drag and drop, and delete pages.',
    seedHint: 'Appears absent. Viewer is read-only (tanstack virtual scroll). No thumbnail/page panel, no reorder, no delete. pdf-lib supports removePage/insertPage but they are not called.',
  },
  {
    key: 'merge-split',
    label: 'Merge and split PDFs',
    acrobatClaim: 'Combine multiple PDFs into one, or split one PDF into several.',
    seedHint: 'Appears absent. No multi-PDF picker, no PDFDocument.copyPages usage, no page-range split UI.',
  },
  {
    key: 'rotate-crop',
    label: 'Rotate and crop',
    acrobatClaim: 'Rotate pages, adjust margins, resize pages, and crop.',
    seedHint: 'Appears absent. No page rotate/crop controls. pdf-lib setRotation/setCropBox/setMediaBox not used. BottomBar only has zoom.',
  },
  {
    key: 'annotate',
    label: 'Annotate PDFs',
    acrobatClaim: 'Comment, highlight, underline, and freehand draw anywhere in the file.',
    seedHint: 'Appears absent. No highlight/underline/comment/ink tools. renderAnnotationLayer={false}. Only a plain black-border rectangle shape (addRectangle) exists, drawn via page.drawRectangle on export.',
  },
  {
    key: 'compress',
    label: 'Compress your file',
    acrobatClaim: 'Reduce the file size to make it easier to share.',
    seedHint: 'Appears absent. exportPdf.ts calls pdfDoc.save() with no options; no image downsampling, object streams, or compress command.',
  },
  {
    key: 'ocr',
    label: 'Extract and edit text with OCR',
    acrobatClaim: 'OCR a scan into editable, searchable text that preserves fonts and formatting.',
    seedHint: 'OCR extraction/editing implemented (ocr.ts with tesseract.js worker, OcrLayer.tsx region OCR, full-page + image OCR, recognized lines become editable cover-text edits). Text SEARCH / Find bar appears ABSENT.',
  },
]

const AUDIT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'label', 'status', 'evidence', 'libraries', 'summary'],
  properties: {
    key: { type: 'string', description: 'The feature key, copied verbatim from the prompt.' },
    label: { type: 'string', description: 'The human-readable feature label.' },
    status: {
      type: 'string',
      enum: ['implemented', 'partial', 'absent'],
      description: 'implemented = the full Acrobat claim is met; partial = some of it works but something specific is missing; absent = no real support.',
    },
    missing: {
      type: 'string',
      description: 'If partial or absent, exactly what is missing relative to the Acrobat claim. Empty string if implemented.',
    },
    evidence: {
      type: 'array',
      description: 'Concrete code citations. For absent features, cite where it WOULD live / what proves its absence (e.g. the file picker accept filter).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'note'],
        properties: {
          path: { type: 'string', description: 'Real repo-relative file path you actually inspected, e.g. src/lib/ocr.ts.' },
          note: { type: 'string', description: 'What this file shows about the feature.' },
        },
      },
    },
    libraries: {
      type: 'array',
      items: { type: 'string' },
      description: 'Libraries already present that this feature uses or would use (e.g. pdf-lib, tesseract.js).',
    },
    summary: { type: 'string', description: 'One or two sentence verdict.' },
  },
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['key', 'effort', 'newLibraries', 'filesToTouch', 'approach', 'risks'],
  properties: {
    key: { type: 'string' },
    effort: { type: 'string', enum: ['S', 'M', 'L'], description: 'Rough size: S < a day, M a few days, L a week+.' },
    newLibraries: {
      type: 'array',
      items: { type: 'string' },
      description: 'npm packages to add. Empty if achievable with existing deps (pdf-lib, pdfjs-dist, react-pdf, tesseract.js, react-rnd, zustand).',
    },
    filesToTouch: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['path', 'change'],
        properties: {
          path: { type: 'string', description: 'Repo-relative path (existing file to edit or new file to create).' },
          change: { type: 'string', description: 'What changes here.' },
        },
      },
    },
    approach: { type: 'string', description: 'Concise implementation approach. Name existing utilities to reuse (e.g. exportPdf.ts PDFDocument, useEditorStore edits, EditBox react-rnd pattern, ocr.ts worker).' },
    risks: { type: 'array', items: { type: 'string' }, description: 'Pitfalls, edge cases, or unknowns.' },
  },
}

const REPO_FACTS = `This is a browser-based PDF editor (Vite + React + TypeScript). Key existing modules:
- src/lib/exportPdf.ts — exportEditedPdf() builds the output with pdf-lib (PDFDocument), embeds fonts via @pdf-lib/fontkit, draws cover rects, text, images, rectangles.
- src/store/useEditorStore.ts — zustand store; TextEdit / image / rectangle edit models; helpers like makeTextEdit, makeCoverTextEdit.
- src/lib/textLayer.ts — extractScreenTextItems() reads existing PDF text via pdfjs-dist.
- src/lib/ocr.ts — single lazy tesseract.js WASM worker, serialized queue; recognizePageRegion(), recognizeImageDataUrl().
- src/lib/openFiles.ts — file open + addImageFromFile() (accept image/png, image/jpeg; PDF picker is application/pdf).
- src/components/PdfViewer.tsx — react-pdf rendering, @tanstack/react-virtual scrolling, renderAnnotationLayer={false}.
- src/components/EditBox.tsx — react-rnd draggable/resizable overlay for image/box edits.
- src/components/ToolRail.tsx, CommandPalette.tsx, BottomBar.tsx — UI surfaces for tools/zoom.
- src/hooks/useEditorActions.ts — action wiring (pickImage, addRectangle, extractText, etc.).
Reuse these wherever possible instead of inventing parallel machinery.`

function auditPrompt(f) {
  return `You are auditing a PDF editor codebase against an Adobe Acrobat feature.

Feature: "${f.label}" (key: ${f.key})
Acrobat's claim: ${f.acrobatClaim}

Prior-exploration seed hint (may be stale — TRUST THE LIVE CODE OVER THIS HINT):
${f.seedHint}

${REPO_FACTS}

Investigate the codebase under src/ (grep + read the relevant files). Decide whether the feature is
"implemented" (the full claim is met), "partial" (works but something specific is missing), or
"absent". For "partial"/"absent" you MUST state exactly what is missing in the 'missing' field.
Cite real file paths you actually inspected in 'evidence' — for an absent feature, cite what proves
its absence (e.g. a file picker accept filter, an unused pdf-lib API, a config flag).
Copy key="${f.key}" and label="${f.label}" verbatim. Return ONLY the structured object.`
}

function planPrompt(f, audit) {
  return `Design a concrete, grounded plan to close the gap for this PDF-editor feature.

Feature: "${f.label}" (key: ${f.key})
Acrobat's claim: ${f.acrobatClaim}
Audit status: ${audit.status}
What's missing: ${audit.missing || '(see summary)'}
Audit summary: ${audit.summary}
Audit evidence: ${JSON.stringify(audit.evidence)}

${REPO_FACTS}

Produce an implementation plan that REUSES the existing modules above wherever possible (e.g. extend
exportPdf.ts's pdf-lib PDFDocument for page ops/merge via PDFDocument.copyPages; reuse the EditBox
react-rnd overlay for new on-page tools; reuse the ocr.ts tesseract worker for text-search indexing).
Only add npm libraries when the existing deps genuinely can't do it. List concrete files to touch
(existing to edit + new to create) with the change in each, give a realistic effort, and call out
risks. Copy key="${f.key}" verbatim. Return ONLY the structured object.`
}

phase('Audit')
log(`Auditing ${FEATURES.length} Acrobat features against the codebase...`)

const results = await pipeline(
  FEATURES,
  // Stage 1 — static, read-only audit.
  (f) => agent(auditPrompt(f), { label: `audit:${f.key}`, phase: 'Audit', schema: AUDIT_SCHEMA, agentType: 'Explore' }),
  // Stage 2 — gap-closing plan, only when the feature is not fully implemented.
  (audit, f) => {
    if (!audit) return null
    if (audit.status === 'implemented') return { ...audit, plan: null }
    return agent(planPrompt(f, audit), { label: `plan:${f.key}`, phase: 'Plan', schema: PLAN_SCHEMA, agentType: 'Plan' })
      .then((plan) => ({ ...audit, plan }))
  },
)

const clean = results.filter(Boolean)
const by = (s) => clean.filter((r) => r.status === s).map((r) => r.label)
const summary = {
  total: clean.length,
  implemented: by('implemented'),
  partial: by('partial'),
  absent: by('absent'),
  plansDrafted: clean.filter((r) => r.plan).length,
}
log(`Done: ${summary.implemented.length} implemented, ${summary.partial.length} partial, ${summary.absent.length} absent; ${summary.plansDrafted} gap plans drafted.`)

return { summary, results: clean }
