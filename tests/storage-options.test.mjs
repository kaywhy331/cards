import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.EZCARDS_MEMORY_STORE = "1";

const { blobWriteOptions } = await import("../netlify/lib/storage.mjs");

test("Netlify Blob write options omit absent conditional fields", () => {
  assert.deepEqual(blobWriteOptions({}), {});
  assert.deepEqual(blobWriteOptions({ onlyIfNew: true }), { onlyIfNew: true });
  assert.deepEqual(blobWriteOptions({ onlyIfMatch: '"etag-1"' }), { onlyIfMatch: '"etag-1"' });
  assert.deepEqual(blobWriteOptions({ metadata: { source: "test" } }), { metadata: { source: "test" } });
});

test("Netlify Blob writes never invent the mutually exclusive condition", () => {
  const createOnly = blobWriteOptions({ onlyIfNew: true, onlyIfMatch: undefined, metadata: undefined });
  assert.equal(Object.hasOwn(createOnly, "onlyIfNew"), true);
  assert.equal(Object.hasOwn(createOnly, "onlyIfMatch"), false);

  const matchOnly = blobWriteOptions({ onlyIfNew: false, onlyIfMatch: '"etag-2"' });
  assert.equal(Object.hasOwn(matchOnly, "onlyIfNew"), false);
  assert.equal(Object.hasOwn(matchOnly, "onlyIfMatch"), true);
});
