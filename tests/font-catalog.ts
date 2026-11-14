import assert from "node:assert/strict";
import {loadFontFamilies} from "../app/obs/fontCatalog";

async function verify() {
let requests = 0;
await assert.rejects(loadFontFamilies(async () => { requests++; throw new Error("Denied"); }));
assert.deepEqual(await loadFontFamilies(async () => { requests++; return []; }), []);
let finish!: (fonts: Array<{family: string}>) => void;
const enumerate = () => { requests++; return new Promise<Array<{family: string}>>(resolve => { finish = resolve; }); };
const first = loadFontFamilies(enumerate);
const second = loadFontFamilies(enumerate);
assert.equal(first, second, "Concurrent focus/mount requests share enumeration");
finish([{family: "Inter"}, {family: "Custom"}, {family: "Custom"}, {family: "Other"}]);
assert.deepEqual(await first, ["Inter", "Minecraft", "Custom", "Other"]);
assert.equal(await loadFontFamilies(enumerate), await first, "Repeated focus reuses the deduplicated family list");
assert.equal(requests, 3, "Denied and empty lists can retry; a successful list is enumerated once");
console.log("PASS: font enumeration deduplicates families in order, shares concurrent work, retries denied/empty results and reuses success");
}
void verify();
