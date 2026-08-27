// Type surface of the Emscripten-generated engine modules (single-file WASM).
// Built from the amath-engine repo: `make deploy-ui`, which runs both `wasm`
// and `wasm-mt` and copies the two artifacts into this directory.
//
// One declaration covers both because they are the same engine with the same
// exports — `amath_engine_mt.mjs` differs only in that its sample loop runs on
// several cores, which is invisible across this boundary.
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

declare module "*amath_engine_mt.mjs" {
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
