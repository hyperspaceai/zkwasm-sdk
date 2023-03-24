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
   * @returns Promise
   */
  async init() {
    if (!(this.binary instanceof Uint8Array)) {
      if (this.binary instanceof ArrayBuffer) {
        this.binary = new Uint8Array(this.binary);
      } else {
        throw "Binary must be `Uint8Array` or `ArrayBuffer`";
      }
    }

    let workerRes = await fetch("https://dl.kartikn.com/file/worker.mjs");
    let workerContents = await workerRes.blob();

    this.worker = new Worker(URL.createObjectURL(workerContents), {
      type: "module",
    });

    await new Promise((res) => {
      this.worker.addEventListener("message", (e) => {
        if (e.data.operation === "initialized") res();
      });
    });

    this.worker.addEventListener("message", async function (e) {
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
          console.log("result: ", args);
          return;
      }

      Atomics.notify(i32, 0);
    });

    this.worker.postMessage({ action: "init_module", args: [this.binary] });
    console.log(this.worker, "posted message");

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
   * Invokes an export on the module and returns the result.
   * @param {string} exportName
   * @param {Uint8Array[]} args
   * @returns {Promise<Uint8Array>}
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
