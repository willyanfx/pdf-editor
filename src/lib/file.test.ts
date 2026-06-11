import { afterEach, expect, test } from "vite-plus/test";
import { fileToDataUrl } from "./file";

const originalFileReader = globalThis.FileReader;

afterEach(() => {
  globalThis.FileReader = originalFileReader;
});

function mockFileReader(result: string | ArrayBuffer) {
  class MockFileReader {
    result: string | ArrayBuffer | null = result;
    error: DOMException | null = null;
    onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;
    onerror: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

    readAsDataURL() {
      this.onload?.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
}

test("fileToDataUrl resolves data URL strings", async () => {
  mockFileReader("data:text/plain;base64,aGk=");

  await expect(fileToDataUrl(new File(["hi"], "hi.txt", { type: "text/plain" }))).resolves.toBe(
    "data:text/plain;base64,aGk=",
  );
});

test("fileToDataUrl rejects non-string FileReader results", async () => {
  mockFileReader(new ArrayBuffer(2));

  await expect(fileToDataUrl(new File(["hi"], "hi.txt", { type: "text/plain" }))).rejects.toThrow(
    "FileReader did not return a data URL",
  );
});
