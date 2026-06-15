export const meta = {
  name: "research-ocr-text-recovery",
  description:
    "Research the best approach to turn image text into clean editable/selectable text — no lost characters, correct paragraph and bullet line breaks",
  whenToUse:
    "Run to get a grounded, cited recommendation for improving the OCR-to-editable-text pipeline: engine choice, pre-processing, layout/paragraph reconstruction, and bullet/list detection — plus a concrete plan that fits this codebase.",
  phases: [
    { title: "Ground", detail: "one agent maps the current OCR pipeline and its failure modes in code" },
    { title: "Investigate", detail: "one agent per research angle: engine, pre-processing, layout reconstruction, bullets/lists, validation" },
    { title: "Verify", detail: "adversarially fact-check each angle's key claims against sources" },
    { title: "Synthesize", detail: "one architect agent merges findings into a single recommended approach + plan" },
  ],
};

// The concrete problems the user wants solved, in priority order.
const PROBLEMS = `1. "Loose characters" — individual glyphs dropped, mangled, or split off (e.g. "rn" -> "m", ligatures lost, accents stripped, low-confidence chars silently kept or dropped).
2. Paragraphs that are visually separate but come out joined into one block, OR a single paragraph wrongly split mid-sentence at every visual line wrap.
3. Bullet / numbered list lines that are glued together into a run-on instead of one editable line per bullet, and the bullet marker (•, -, 1., a)) being lost or merged into the text.`;

// Each research angle is investigated independently, then its claims are verified.
const ANGLES = [
  {
    key: "engine-and-config",
    label: "OCR engine + configuration",
    focus: `Which browser-runnable OCR approach best preserves every character. Compare tesseract.js (current) tuned configs vs alternatives runnable client-side or via a thin server: Tesseract LSTM modes (--oem, --psm, user_defined_dpi), trained-data choice (eng vs eng.traineddata fast/best), preserve_interword_spaces, tessedit_char_whitelist trade-offs; PaddleOCR / docTR / EasyOCR (server) and ONNX/WASM ports; cloud APIs (Google Document AI, Azure Document Intelligence, AWS Textract) for layout-aware OCR. Call out which ones return per-word/char bounding boxes AND confidence (needed for the later stages).`,
  },
  {
    key: "preprocessing",
    label: "Image pre-processing",
    focus: `Pre-processing that reduces lost/mangled characters BEFORE OCR: DPI upscaling to ~300dpi, grayscale + binarization (Otsu / adaptive / Sauvola), deskew, denoise, contrast/sharpen, removing background shading and table lines. What is achievable in-browser (canvas, WASM OpenCV / opencv.js, jimp) vs needing native. Which steps measurably cut character error rate and which hurt (e.g. over-binarization eating thin strokes / accents).`,
  },
  {
    key: "layout-paragraphs",
    label: "Layout & paragraph reconstruction",
    focus: `Turning OCR word/line boxes into correctly-segmented paragraphs. Tesseract's block/paragraph hierarchy (hOCR / TSV / blocks API) and its reliability; using line bounding-box geometry — vertical gaps (inter-line vs inter-paragraph leading), left-margin/indent changes, line-height clustering — to decide where a paragraph really breaks vs a soft wrap; de-hyphenation of words split across line wraps; column detection so multi-column text isn't read across columns. Whether hOCR/ALTO output should be parsed instead of plain text.`,
  },
  {
    key: "bullets-lists",
    label: "Bullet & list detection",
    focus: `Detecting and preserving bullet / numbered lists so each item becomes its own editable line. Recognizing bullet glyphs (•, ◦, ▪, -, *, –) and ordinal markers (1. 2), a) i.) that OCR often misreads or drops; using the marker's x-position + the hanging-indent of wrapped continuation lines to group an item's lines together and split between items; reconstructing the marker when OCR mangles it. Heuristics vs ML layout models (LayoutLMv3, PaddleOCR PP-Structure, docTR) for list/structure detection.`,
  },
  {
    key: "postprocess-validation",
    label: "Post-processing & confidence handling",
    focus: `Cleaning OCR output without inventing text: using per-char/word confidence to flag (not silently drop) low-confidence glyphs, spell/dictionary correction trade-offs (SymSpell etc.) and when it corrupts proper nouns/codes, Unicode normalization (NFC), fixing common confusions (rn/m, l/I/1, O/0) safely, ligature/accent restoration. How to surface uncertain characters to the user for review rather than guessing.`,
  },
];

const REPO_CONTEXT = `Target codebase: a browser-based PDF editor (Vite + React + TypeScript), fully client-side.
Current OCR pipeline:
- src/lib/ocr.ts — a single lazy tesseract.js (v5) WASM worker behind a serialized queue; functions recognizePageRegion() and recognizeImageDataUrl(). Renders a region/image to a canvas/dataURL and calls Tesseract.recognize.
- src/components/OcrLayer.tsx — UI for region OCR and full-page/image OCR; recognized lines are turned into editable "cover-text" edits placed over the image.
- Output flows into useEditorStore (TextEdit / cover-text edit models) and is exported via src/lib/exportPdf.ts (pdf-lib).
Existing deps available: tesseract.js ^5.1.1, pdf-lib, pdfjs-dist, react-pdf, @pdf-lib/fontkit, zustand, react-rnd.
Constraints to respect: prefer staying client-side/offline; reuse the existing single-worker queue and the cover-text edit model rather than inventing parallel machinery; a server step or new npm dep is acceptable ONLY if the quality gain is clearly justified.`;

const ANGLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["key", "summary", "techniques", "recommendation", "claims", "sources"],
  properties: {
    key: { type: "string", description: "The angle key, copied verbatim." },
    summary: { type: "string", description: "2-4 sentence overview of what the research found for this angle." },
    techniques: {
      type: "array",
      description: "Concrete techniques/options found, ranked best-first for THIS codebase's constraints.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "whatItDoes", "fixesProblem", "browserFeasible", "tradeoffs"],
        properties: {
          name: { type: "string" },
          whatItDoes: { type: "string" },
          fixesProblem: {
            type: "string",
            description: "Which of the 3 user problems (loose chars / paragraph breaks / bullets) this addresses, and how.",
          },
          browserFeasible: {
            type: "string",
            enum: ["client-side", "client-side-with-wasm", "needs-server", "needs-cloud-api"],
          },
          tradeoffs: { type: "string", description: "Cost, accuracy, latency, or correctness risks." },
        },
      },
    },
    recommendation: { type: "string", description: "The single best choice for this angle and why." },
    claims: {
      type: "array",
      description: "3-6 specific, checkable factual claims this angle relies on (for the verify stage).",
      items: { type: "string" },
    },
    sources: {
      type: "array",
      description: "URLs / docs / papers actually consulted.",
      items: { type: "string" },
    },
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
          note: { type: "string", description: "Evidence or correction, with a source if possible." },
        },
      },
    },
    overallConfidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recommendedApproach", "pipelineStages", "newLibraries", "filesToTouch", "effort", "risks", "openQuestions"],
  properties: {
    recommendedApproach: {
      type: "string",
      description: "The end-to-end recommended approach in prose: engine + config, pre-processing, layout/paragraph reconstruction, bullet handling, post-processing — and how they fix the 3 problems.",
    },
    pipelineStages: {
      type: "array",
      description: "Ordered stages of the proposed image->editable-text pipeline.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "does", "tech"],
        properties: {
          stage: { type: "string" },
          does: { type: "string" },
          tech: { type: "string", description: "Library/API/algorithm used; note if reusing existing tesseract.js worker." },
        },
      },
    },
    newLibraries: {
      type: "array",
      items: { type: "string" },
      description: "npm packages or services to add. Empty if achievable with existing deps.",
    },
    filesToTouch: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "change"],
        properties: {
          path: { type: "string", description: "Repo-relative path (existing to edit or new to create), e.g. src/lib/ocr.ts." },
          change: { type: "string" },
        },
      },
    },
    effort: { type: "string", enum: ["S", "M", "L"], description: "S < a day, M a few days, L a week+." },
    risks: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" }, description: "Things needing a prototype/measurement before committing." },
  },
};

function groundPrompt() {
  return `You are mapping the CURRENT image-text-to-editable-text (OCR) pipeline of a browser PDF editor so a research team can improve it.

${REPO_CONTEXT}

Read src/lib/ocr.ts and src/components/OcrLayer.tsx (and anything they call into / that consumes their output). Report:
- Exactly how an image region becomes text today: rendering, DPI/scale, any pre-processing, the tesseract.js call options used (oem/psm/whitelist/preserve_interword_spaces if any), and what output shape is used (plain text vs words vs lines vs blocks).
- How lines/paragraphs are currently segmented and how each becomes a cover-text edit.
- Concrete places where the 3 target problems would arise TODAY given this code:
${PROBLEMS}
Cite real file paths and line ranges. Be specific and factual — this is the baseline everyone else builds on. Return your findings as plain prose (no special format).`;
}

function anglePrompt(a, baseline) {
  return `You are researching ONE angle of how to turn text in an image into clean, editable, selectable text.

The three problems to solve (in priority order):
${PROBLEMS}

Your angle: "${a.label}" (key: ${a.key})
Focus on: ${a.focus}

Baseline — how the target codebase does OCR today:
${baseline}

${REPO_CONTEXT}

Research this angle using web search and authoritative sources (official docs for tesseract.js/Tesseract, PaddleOCR, docTR; cloud OCR docs; relevant papers/benchmarks). Favor approaches that keep the editor client-side/offline when quality allows, but include server/cloud options where they clearly win. For every technique, state which of the 3 problems it fixes and whether it is browser-feasible. Rank techniques best-first FOR THIS CODEBASE'S CONSTRAINTS. List the specific factual claims you rely on so they can be fact-checked. Copy key="${a.key}" verbatim. Return ONLY the structured object.`;
}

function verifyPrompt(a, claims) {
  return `Adversarially fact-check these claims from OCR research angle "${a.label}". For each, try to REFUTE it using authoritative sources; default to "unverifiable" if you cannot confirm. Watch for: outdated Tesseract behavior, overstated accuracy numbers, "browser-feasible" claims that actually require native/server, and conflated engine capabilities.

Claims:
${claims.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Return ONLY the structured object.`;
}

function synthPrompt(baseline, angles) {
  const findings = angles
    .map(
      (a) =>
        `### ${a.label} (${a.key})\nSummary: ${a.summary}\nRecommendation: ${a.recommendation}\nTechniques: ${JSON.stringify(a.techniques)}\nVerification: ${JSON.stringify(a.verification?.verdicts || [])} (confidence: ${a.verification?.overallConfidence || "n/a"})`,
    )
    .join("\n\n");

  return `You are the lead architect. Merge the verified research below into ONE recommended approach for turning image text into clean editable/selectable text in this PDF editor, then produce a concrete plan.

The three problems to solve (priority order):
${PROBLEMS}

Current pipeline (baseline):
${baseline}

${REPO_CONTEXT}

Verified research by angle:
${findings}

Rules:
- Prefer the lowest-complexity approach that actually fixes all three problems; reuse the existing tesseract.js single-worker queue and cover-text edit model unless a claim with HIGH verification confidence says you must replace them.
- Treat any "refuted" or "unverifiable" claim as NOT load-bearing — don't build the recommendation on it; note it as an open question instead.
- Be explicit about how each pipeline stage maps onto src/lib/ocr.ts / OcrLayer.tsx changes.
- Distinguish quick wins (better tesseract config, pre-processing, geometry-based paragraph/bullet grouping) from larger bets (layout-ML model, cloud Document AI).
Return ONLY the structured object.`;
}

phase("Ground");
log("Mapping the current OCR pipeline and its failure modes...");
const baseline = await agent(groundPrompt(), {
  label: "ground:current-pipeline",
  phase: "Ground",
  agentType: "Explore",
});

phase("Investigate");
log(`Researching ${ANGLES.length} angles, verifying each as it completes...`);

const investigated = await pipeline(
  ANGLES,
  // Stage 1 — research the angle.
  (a) =>
    agent(anglePrompt(a, baseline), {
      label: `research:${a.key}`,
      phase: "Investigate",
      schema: ANGLE_SCHEMA,
    }),
  // Stage 2 — adversarially verify this angle's claims as soon as it's done.
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
log("Synthesizing a single recommended approach + implementation plan...");
const plan = await agent(synthPrompt(baseline, angles), {
  label: "synthesize:recommendation",
  phase: "Synthesize",
  schema: PLAN_SCHEMA,
  agentType: "Plan",
});

return { baseline, angles, plan };
