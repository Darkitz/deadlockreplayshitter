// Parses one demo file off the main thread with the WebAssembly build of dlparse
// (parser/dlparse/src/wasm.rs). One worker per file: wasm memory can't shrink, so the page
// terminates the worker afterwards to give the memory back.
//
// in:  { file: File, matchId: number }
// out: { type: "progress", t } (game seconds reached) · { type: "done", json } · { type: "error", message }

self.onmessage = async ({ data: { file, matchId, version } }) => {
  try {
    const url = new URL(`../parser/dlparse.wasm?v=${version || ""}`, import.meta.url);
    const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {
      env: { progress: (t) => self.postMessage({ type: "progress", t }) },
    });
    const e = instance.exports;
    let bytes = new Uint8Array(await file.arrayBuffer());
    const len = bytes.length;
    const ptr = e.dl_alloc(len);
    new Uint8Array(e.memory.buffer, ptr, len).set(bytes);
    bytes = null; // the copy inside wasm memory is all we need
    const status = e.dl_parse(ptr, len, matchId);
    const text = new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.dl_result_ptr(), e.dl_result_len()));
    if (status !== 0) throw new Error(text || "parse failed");
    self.postMessage({ type: "done", json: text, version: e.dl_version() });
  } catch (err) {
    // RangeError: the browser refused more memory (very long demos on 32-bit / low-memory devices)
    // RuntimeError: the parser panicked (not a Deadlock demo, truncated file, or a format change)
    const msg = err instanceof RangeError ? `out of memory (${err.message})`
      : err instanceof WebAssembly.RuntimeError ? `the parser crashed on this file (${err.message}): not a Deadlock demo, cut off, or from a newer game version`
      : String(err?.message || err);
    self.postMessage({ type: "error", message: msg });
  }
};
