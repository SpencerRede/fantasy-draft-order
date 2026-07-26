// The node-env unit tests exercise browser modules that use the Web Crypto API
// via globalThis.crypto (standard in browsers and Node 20+). Node's vm sandbox
// used by the test runner does not always expose it, so provide it here — a
// test-only shim that never reaches the browser bundle.
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}
