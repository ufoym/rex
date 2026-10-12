// Asyncify pauses only the local worker's stdin read. Other filesystem I/O stays
// synchronous against packaged resources; the hosted engine uses shared memory.
export class InputPending {
  constructor(ready) { this.ready = ready; }
}

export function asyncRuntime(wasmModule) {
  let exports, stack, pending, value;
  const stackSize = 1024 * 1024;
  return {
    instantiateWasm(imports, ready) {
      const read = imports.wasi_snapshot_preview1.fd_read;
      imports.wasi_snapshot_preview1.fd_read = (...args) => {
        if (exports.asyncify_get_state() === 2) {
          exports.asyncify_stop_rewind();
          return value;
        }
        try { return read(...args); }
        catch (error) {
          if (!(error instanceof InputPending)) throw error;
          pending = error.ready.then(() => read(...args));
          stack ||= exports.malloc(stackSize + 8);
          new Uint32Array(exports.memory.buffer, stack, 2).set([stack + 8, stack + 8 + stackSize]);
          exports.asyncify_start_unwind(stack);
          return 0;
        }
      };
      WebAssembly.instantiate(wasmModule, imports).then(instance => {
        exports = instance.exports;
        ready(instance, wasmModule);
      });
      return {};
    },
    async callMain(M, args) {
      // Emscripten's synchronous callMain would exit while unwinding. Keep argv
      // and the runtime alive until the resident compiler actually finishes.
      const strings = ["/bin/luatex", ...args].map(arg => M.stringToNewUTF8(arg));
      const argv = M._malloc((strings.length + 1) * 4);
      new Uint32Array(M.HEAPU8.buffer, argv, strings.length + 1).set([...strings, 0]);
      try {
        let result = M._main(strings.length, argv);
        while (exports.asyncify_get_state() === 1) {
          exports.asyncify_stop_unwind();
          value = await pending;
          exports.asyncify_start_rewind(stack);
          result = M._main(strings.length, argv);
        }
        return result;
      } catch (error) {
        if (error.name === "ExitStatus") return error.status;
        throw error;
      } finally {
        for (const pointer of [...strings, argv, stack].filter(Boolean)) M._free(pointer);
      }
    },
  };
}
