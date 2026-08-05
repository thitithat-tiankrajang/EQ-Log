// Type surface of the Emscripten-generated engine module (single-file WASM).
// Built from the amath-engine repo: `make wasm`, then copy
// build/amath_engine.mjs into this directory.
declare module "*amath_engine.mjs" {
  export interface AmathEngineModule {
    _engine_handle(requestPtr: number): number;
    _engine_alloc(size: number): number;
    _engine_free(ptr: number): void;
    UTF8ToString(ptr: number): string;
    stringToUTF8(str: string, ptr: number, maxBytes: number): void;
    lengthBytesUTF8(str: string): number;
  }
  const createModule: () => Promise<AmathEngineModule>;
  export default createModule;
}
