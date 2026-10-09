import { describe, expect, it, vi } from "vite-plus/test";
import { handleStaleChunk } from "./staleChunkReload";

function makeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("handleStaleChunk", () => {
  it("reloads on the first failure", () => {
    const reload = vi.fn();
    expect(handleStaleChunk({ storage: makeStorage(), reload, now: () => 1000 })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload again within the window", () => {
    const reload = vi.fn();
    const storage = makeStorage();
    handleStaleChunk({ storage, reload, now: () => 1000 });
    expect(handleStaleChunk({ storage, reload, now: () => 5000 })).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("reloads again once the window has passed", () => {
    const reload = vi.fn();
    const storage = makeStorage();
    handleStaleChunk({ storage, reload, now: () => 1000 });
    expect(handleStaleChunk({ storage, reload, now: () => 20_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when storage is unavailable", () => {
    const reload = vi.fn();
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(handleStaleChunk({ storage, reload, now: () => 1 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when there is no storage at all", () => {
    const reload = vi.fn();
    expect(handleStaleChunk({ storage: null, reload, now: () => 1 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
