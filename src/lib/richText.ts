import type { TextRun } from "../store/useEditorStore";

/** True when two runs carry identical formatting (text aside). `undefined`
 * compares equal to `undefined` — i.e. both inherit the same box default. */
function runsStyleEqual(a: TextRun, b: TextRun): boolean {
  return (
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.color === b.color &&
    a.fontSize === b.fontSize &&
    a.fontFamily === b.fontFamily
  );
}

/** Merge adjacent runs with identical formatting and drop empty runs. Always
 * returns at least one run (an empty one) so the editor never has zero spans. */
export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const prev = out[out.length - 1];
    if (prev && runsStyleEqual(prev, run)) {
      prev.text += run.text;
    } else {
      out.push({ ...run });
    }
  }
  return out.length > 0 ? out : [{ text: "" }];
}

/** Total character length across all runs. */
export function runsLength(runs: TextRun[]): number {
  let n = 0;
  for (const r of runs) n += r.text.length;
  return n;
}

/** Split the runs array into two halves at character `offset` (counted across
 * all runs). A run straddling the boundary is split, preserving its style. */
export function splitRunsAt(runs: TextRun[], offset: number): [TextRun[], TextRun[]] {
  const left: TextRun[] = [];
  const right: TextRun[] = [];
  let remaining = offset;
  for (const run of runs) {
    if (remaining <= 0) {
      right.push({ ...run });
    } else if (remaining >= run.text.length) {
      left.push({ ...run });
      remaining -= run.text.length;
    } else {
      left.push({ ...run, text: run.text.slice(0, remaining) });
      right.push({ ...run, text: run.text.slice(remaining) });
      remaining = 0;
    }
  }
  return [left, right];
}

/** Apply a style patch to the character range [start, end), splitting runs at
 * the boundaries and re-normalizing. Out-of-range or empty ranges return the
 * runs unchanged (normalized). */
export function applyFormatToRange(
  runs: TextRun[],
  start: number,
  end: number,
  patch: Partial<TextRun>,
): TextRun[] {
  if (end <= start) return normalizeRuns(runs);
  const [before, rest] = splitRunsAt(runs, start);
  const [middle, after] = splitRunsAt(rest, end - start);
  const patched = middle.map((r) => ({ ...r, ...patch }));
  return normalizeRuns([...before, ...patched, ...after]);
}
