import { openDB } from "idb";

const DB_NAME = "hysdk";
const STORE_NAME = "state";

async function initDB() {
  return await openDB(DB_NAME, 3, {
    upgrade(db, _oldVersion, _newVersion, _transaction) {
      db.createObjectStore(STORE_NAME);
    },
  });
}

/**
 * @returns {Promise<Worker>}
 */
async function initWorker() {
  let workerRes = await fetch("https://dl.kartikn.com/file/worker.mjs");
  let workerContents = await workerRes.blob();

  let worker = new Worker(URL.createObjectURL(workerContents), {
    type: "module",
  });

  await new Promise((res) => {
    worker.addEventListener("message", (e) => {
      if (e.data.operation === "initialized") res();
    });
  });

  worker.addEventListener("message", async function (e) {
    const { responseBuffer, operation, args } = e.data;
    const i32 = new Int32Array(responseBuffer);

    switch (operation) {
      case "state_get": {
        const db = await initDB();
        const value = await db.get(STORE_NAME, args[0]);
        if (value !== undefined && !(value instanceof Uint8Array)) {
          throw "expect values in IndexedDB to be Uint8Array";
        }

        i32[0] = value.byteLength;
        const buffer = new Uint8Array(i32.buffer);
        value.forEach((byte, i) => {
          buffer[i + 4] = byte;
        });

        break;
      }
      case "state_set": {
        const db = await initDB();
        await db.put(STORE_NAME, args[1], args[0]);
        break;
      }
      case "log": {
        console.log(args[0]);
        return;
      }
      case "result":
        // console.log("result: ", args);
        return;
    }

    Atomics.notify(i32, 0);
  });

  return worker;
}

/**
 * @typedef {{bytes: Uint8Array, inputs: Uint8Array}} Proof
 */

export class Module {
  /**
   * Creates a new uninitialized `Module` object.
   * @param {Uint8Array} binary
   */
  constructor(binary) {
    this.__internal_module_object = null;
    this.binary = binary;
  }

  /**
   * Initializes the module (preparing it for export invocations).
   * @returns {Promise}
   */
  async init() {
    if (this.initialized()) {
      throw "Module double initialization.";
    }

    if (!(this.binary instanceof Uint8Array)) {
      if (this.binary instanceof ArrayBuffer) {
        this.binary = new Uint8Array(this.binary);
      } else {
        throw "Binary must be `Uint8Array` or `ArrayBuffer`";
      }
    }

    this.worker = await initWorker();

    this.worker.postMessage({ action: "init_module", args: [this.binary] });

    return new Promise((res) => {
      this.worker.addEventListener("message", (e) => {
        if (e.data.operation === "result" && e.data.action === "init_module") {
          this.__internal_module_object = e.data.result;
          res();
        }
      });
    });
  }

  /**
   * Returns if this `Module` object has been intialized or not.
   * @returns {boolean}
   */
  initialized() {
    return this.__internal_module_object !== null;
  }

  /**
   * Creates a new `Module` from a provided Wasm binary.
   * @param {Uint8Array} binary
   * @returns {Promise<Module>}
   */
  static async fromBinary(binary) {
    let result = new Module(binary);
    await result.init();
    return result;
  }

  /**
   * @typedef {{proof: Proof, result: Uint8Array}} InvocationResult
   */

  /**
   * Invokes an export on the module and returns the result.
   * @param {string} exportName
   * @param {Uint8Array[]} args
   * @returns {Promise<InvocationResult>}
   */
  async invokeExport(exportName, args) {
    if (!this.initialized()) {
      throw "Attempt to use uninitialized module.";
    }

    args.forEach((arg, i) => {
      if (!(arg instanceof Uint8Array)) {
        if (arg instanceof ArrayBuffer) {
          args[i] = new Uint8Array(arg);
        } else {
          throw "Arguments must be `Uint8Array` or `ArrayBuffer`";
        }
      }
    });

    this.worker.postMessage({
      action: "invoke_export",
      args: [this.__internal_module_object, exportName, args],
    });

    return new Promise((res) => {
      this.worker.addEventListener("message", (e) => {
        if (
          e.data.operation === "result" &&
          e.data.action === "invoke_export"
        ) {
          res(e.data.result);
        }
      });
    });
  }
}

export class JSModule {
  /**
   * Creates a new uninitialized `JSModule` object.
   * @param {string} source
   */
  constructor(source) {
    this._module = null;
    this.source = source;
  }

  /**
   * Initializes the module (preparing it for function invocations).
   * @returns {Promise}
   */
  async init() {
    if (this.initialized()) {
      throw "JSModule double initialization";
    }

    let exec_js_binary = [
      0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 1, 96, 3, 127, 127, 127, 1, 127, 2, 29,
      2, 3, 101, 110, 118, 6, 109, 101, 109, 111, 114, 121, 2, 0, 1, 3, 101,
      110, 118, 7, 101, 120, 101, 99, 95, 106, 115, 0, 0, 3, 2, 1, 0, 7, 11, 1,
      7, 101, 120, 101, 99, 95, 106, 115, 0, 1, 10, 13, 1, 11, 0, 32, 0, 32, 1,
      32, 2, 16, 0, 15, 11, 0, 34, 4, 110, 97, 109, 101, 1, 27, 2, 0, 7, 101,
      120, 101, 99, 95, 106, 115, 1, 15, 101, 120, 101, 99, 95, 106, 115, 95,
      119, 114, 97, 112, 112, 101, 114,
    ];
    this._module = await Module.fromBinary(new Uint8Array(exec_js_binary));
  }

  /**
   * Creates and initializes a `JSModule` instance.
   * @param {string} source
   * @returns {Promise<JSModule>}
   */
  static async fromSource(source) {
    let mod = new JSModule(source);
    await mod.init();
    return mod;
  }

  /**
   * Returns if this `JSModule` object has been intialized or not.
   * @returns {boolean}
   */
  initialized() {
    return this._module !== null;
  }

  /**
   * Call a function within the JS module with your provided arguments.
   * @param {string} functionName
   * @param {Uint8Array[]} args
   * @returns {Promise<InvocationResult>}
   */
  async call(functionName, args) {
    if (!this.initialized()) {
      throw "Attempt to use uninitialized JS module.";
    }

    let allArgsLen = args
      .map((arr) => arr.byteLength)
      .reduce((acc, a) => acc + a, 0);
    let mergedArgs = new Uint8Array(allArgsLen + args.length * 4);
    let dataView = new DataView(mergedArgs.buffer);

    let i = 0;
    args.forEach((arr) => {
      dataView.setUint32(i, arr.byteLength, true);
      i += 4;
      for (let j = 0; j < arr.byteLength; j++) {
        mergedArgs[i + j] = arr[j];
      }
      i += arr.byteLength;
    });

    console.log(args, mergedArgs);

    return await this._module.invokeExport("exec_js", [
      new TextEncoder().encode(this.source),
      new TextEncoder().encode(functionName),
      mergedArgs,
    ]);
  }
}

/**
 * Verifies a proof, returns whether it's valid or not.
 * @param {Proof} proof
 * @returns {Promise<boolean>}
 */
export async function verify(proof) {
  let worker = await initWorker();
  worker.postMessage({ action: "verify", args: [proof] });

  return new Promise((res) => {
    worker.addEventListener("message", (e) => {
      if (e.data.operation === "result" && e.data.action === "verify") {
        res(e.data.result.result);
      }
    });
  });
}
