# zkWasm SDK

This is the repository for the JavaScript SDK for zkWasm. You can use this library client or server-side as long as the runtime supports `Wasm`, Workers, and IndexedDB.

# Example

```js
import { Module, verify } from 'zkwasm';

let wasmBinary = { ... }; // This can be acquired in any way
let module = await Module.fromBinary(wasmBinary);
let { result, proof } = module.invokeExport('test', [...serializedArguments]);

console.log(result);
console.log(verify(proof)); // Check if a proof is valid
```

# Documentation

The SDK has two exports. The `Module` class which is used to create a Wasm module and invoke exports on it, and the `verify` function which is used to verify any proofs from the SDK.

## `class Module`

### `constructor(binary: Uint8Array)`

It's not recommended to use this. Always prefer to use `Module.fromBinary` instead. If you do use the constructor you must call `Module.prototype.init` before invoking any exports.

### `async init(): Promise<void>`

Initializes the module and sets up the internal worker.

### `initialized(): boolean`

Way to check if the module has been initialized or not. This is used internally and methods throw if it returns false.

### `static async fromBinary(binary: Uint8Array): Promise<Module>`

The recommended way to create a `Module` object. Both constructs and initialized the object internally so it's ready to use.

### `async invokeExport(exportName: string, args: Uint8Array[]): Promise<InvocationResult>`

Invokes a public export on the Wasm module and returns the result of execution and a verifiable proof.

```ts
type Proof = {
  bytes: Uint8Array;
  inputs: Uint8Array;
};

type InvocationResult = {
  proof: Proof;
  result: Uint8Array;
};
```

## `async function verify(proof: Proof): Promise<boolean>`

Verifies a proof of execution and returns whether the provided proof is valid or not.
