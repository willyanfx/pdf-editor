/// <reference lib="webworker" />
/**
 * Web Worker that runs Florence-2 (`<OCR_WITH_REGION>`) via Transformers.js on
 * WebGPU, off the main thread. The worker loads the model once (singleton),
 * streams download progress back, and answers `recognize` requests with text
 * regions + quad boxes.
 *
 * Why a worker: model load is hundreds of MB and inference holds the GPU for
 * seconds; running it on the main thread would freeze the editor. ImageBitmaps
 * are transferred in (zero-copy) and reconstructed here via OffscreenCanvas —
 * HTMLCanvasElement is not available in a worker.
 */

import {
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  Florence2Processor,
  RawImage,
  env,
  type PreTrainedTokenizer,
} from "@huggingface/transformers";
import {
  FLORENCE_MODEL_ID,
  OCR_WITH_REGION_TASK,
  type VlmRegion,
  type WorkerRequest,
  type WorkerResponse,
} from "./types";
import type { QuadBox } from "./fontSize";

// Browser context: never look for models on a local filesystem, and persist the
// downloaded shards in the Cache API so reloads are instant.
env.allowLocalModels = false;
env.useBrowserCache = true;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(msg: WorkerResponse) {
  ctx.postMessage(msg);
}

/** Detect WebGPU + fp16 shader support so we can pick the best dtype. */
async function detectWebGPU(): Promise<{ supported: boolean; fp16: boolean }> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) return { supported: false, fp16: false };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { supported: false, fp16: false };
    return { supported: true, fp16: adapter.features.has("shader-f16") };
  } catch {
    return { supported: false, fp16: false };
  }
}

type Loaded = {
  model: Florence2ForConditionalGeneration;
  processor: Florence2Processor;
  tokenizer: PreTrainedTokenizer;
};

let loadPromise: Promise<Loaded> | null = null;

function load(): Promise<Loaded> {
  if (loadPromise) return loadPromise;
  const p = (async () => {
    const { supported, fp16 } = await detectWebGPU();
    const device = supported ? "webgpu" : "wasm";

    const progress = (p: unknown) => {
      const e = p as {
        status?: string;
        file?: string;
        progress?: number;
        loaded?: number;
        total?: number;
      };
      if (e.status === "progress") {
        post({
          type: "load-progress",
          file: e.file ?? "",
          progress: e.progress ?? 0,
          loaded: e.loaded ?? 0,
          total: e.total ?? 0,
        });
      }
    };

    // Per-component dtype: the vision encoder is quantization-sensitive (keep it
    // fp16 where fp16 shaders exist), the text encoder/decoder tolerate q4. On a
    // GPU without shader-f16 (or the wasm fallback) drop to a uniform q4/q8.
    const dtype = supported
      ? fp16
        ? {
            embed_tokens: "fp16" as const,
            vision_encoder: "fp16" as const,
            encoder_model: "q4" as const,
            decoder_model_merged: "q4" as const,
          }
        : ("q4" as const)
      : ("q8" as const);

    const [model, processor, tokenizer] = await Promise.all([
      Florence2ForConditionalGeneration.from_pretrained(FLORENCE_MODEL_ID, {
        dtype,
        device,
        progress_callback: progress,
      }),
      AutoProcessor.from_pretrained(FLORENCE_MODEL_ID, { progress_callback: progress }),
      AutoTokenizer.from_pretrained(FLORENCE_MODEL_ID, { progress_callback: progress }),
    ]);

    // from_pretrained's static return types are the generic base classes; for
    // this model the runtime instances are the Florence-2 subclasses, so narrow.
    return {
      model: model as Florence2ForConditionalGeneration,
      processor: processor as Florence2Processor,
      tokenizer,
    };
  })();

  loadPromise = p;
  // Don't cache a failed load (e.g. transient CDN error) — let the next request
  // retry from scratch instead of being permanently dead.
  p.catch(() => {
    loadPromise = null;
  });
  return p;
}

/** ImageBitmap → RawImage via an OffscreenCanvas (works in a worker). */
function bitmapToRawImage(bitmap: ImageBitmap): RawImage {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const c2d = canvas.getContext("2d");
  if (!c2d) throw new Error("OffscreenCanvas 2D context unavailable in worker");
  c2d.drawImage(bitmap, 0, 0);
  // RawImage.fromCanvas accepts OffscreenCanvas (and HTMLCanvasElement on the
  // main thread). It reads pixels synchronously, so the bitmap can be closed.
  return RawImage.fromCanvas(canvas as unknown as HTMLCanvasElement);
}

/** Pull quad boxes + labels out of Florence-2's post-processed output. The
 * post-processor returns `{ "<OCR_WITH_REGION>": { quad_boxes, labels } }`. */
function toRegions(parsed: unknown): VlmRegion[] {
  const block = (parsed as Record<string, unknown>)?.[OCR_WITH_REGION_TASK] as
    | { quad_boxes?: number[][]; labels?: string[] }
    | undefined;
  if (!block?.quad_boxes || !block.labels) return [];
  const regions: VlmRegion[] = [];
  const n = Math.min(block.quad_boxes.length, block.labels.length);
  for (let i = 0; i < n; i++) {
    const q = block.quad_boxes[i];
    const label = block.labels[i];
    if (!Array.isArray(q) || q.length < 8 || typeof label !== "string") continue;
    // Florence-2 prefixes OCR labels with "</s>" occasionally; strip control text.
    const text = label.replace(/<\/?s>/g, "").trim();
    if (!text) continue;
    regions.push({ text, quad: q.slice(0, 8) as QuadBox });
  }
  return regions;
}

/** Token budget for one page. Dense scans can exceed this; when they do the
 * decode is cut off mid-output and the region list is incomplete — see the
 * truncation check in `recognize`. */
const MAX_NEW_TOKENS = 1024;

async function recognize(bitmap: ImageBitmap): Promise<{
  regions: VlmRegion[];
  imageWidth: number;
  imageHeight: number;
  truncated: boolean;
}> {
  const { model, processor, tokenizer } = await load();
  const image = bitmapToRawImage(bitmap);
  const imageWidth = bitmap.width;
  const imageHeight = bitmap.height;
  bitmap.close();

  // Florence-2 takes a task token as its text prompt; the processor expands it.
  const prompts = processor.construct_prompts(OCR_WITH_REGION_TASK);
  const text_inputs = tokenizer(prompts);
  const vision_inputs = await processor(image);

  const generated = await model.generate({
    ...text_inputs,
    ...vision_inputs,
    max_new_tokens: MAX_NEW_TOKENS,
    num_beams: 1,
    do_sample: false,
  });

  const decoded = tokenizer.batch_decode(
    generated as Parameters<typeof tokenizer.batch_decode>[0],
    {
      skip_special_tokens: false,
    },
  );

  // Florence-2 ends a complete generation with the EOS token ("</s>"). If the
  // decode hit the token budget first it stops without one, meaning the tail of
  // a dense page was dropped. Checking the decoded string is device-agnostic
  // (works on WebGPU and the WASM fallback) and avoids depending on the prompt
  // length to subtract it from the sequence dims.
  const truncated = !decoded[0].trimEnd().endsWith("</s>");
  // post_process_generation scales coord i by image_size[i % 2]; since quad
  // locations are x,y,x,y… that means [0]=width, [1]=height. (The d.ts JSDoc
  // says "height x width" but the implementation and the official demo pass
  // [width, height] — verified against the bundled source.)
  const parsed = processor.post_process_generation(decoded[0], OCR_WITH_REGION_TASK, [
    imageWidth,
    imageHeight,
  ]);

  return { regions: toRegions(parsed), imageWidth, imageHeight, truncated };
}

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === "load") {
    void load().then(
      () => post({ type: "ready" }),
      (e: unknown) => post({ type: "load-error", message: errMessage(e) }),
    );
    return;
  }
  if (msg.type === "recognize") {
    const { requestId, image } = msg;
    void recognize(image).then(
      (result) => post({ type: "result", requestId, result }),
      (e: unknown) => post({ type: "recognize-error", requestId, message: errMessage(e) }),
    );
  }
});

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
