import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {apiExamples, exampleRequestUrl, exampleResponsePreview, type ApiEndpointPath} from "../app/api/_examples";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "app/api/page.tsx"), "utf8");
const documented = [...page.matchAll(/\{path: '([^']+)'/g)].map(match => match[1]);
assert.deepEqual([...documented].sort(), Object.keys(apiExamples).sort(), "Every listed endpoint needs an example");

for (const endpoint of documented as ApiEndpointPath[]) {
    const url = new URL(exampleRequestUrl(endpoint));
    assert.equal(url.origin, "https://paceman.gg");
    const expectedPath = endpoint === "../aa/api/getAllData" ? "/stats/aa/api/getAllData/" : `/stats/api/${endpoint}/`;
    assert.equal(url.pathname, expectedPath);
    const route = path.join(root, "app", url.pathname.slice("/stats/".length), "route.ts");
    assert.ok(fs.existsSync(route), `Example URL must point to an existing route: ${endpoint}`);
    const preview = exampleResponsePreview(apiExamples[endpoint].response);
    assert.doesNotThrow(() => JSON.parse(preview.json), `Abbreviated examples must remain valid JSON: ${endpoint}`);
}

// Catch common documentation mismatches: supported query values, response
// wrappers, cursor types, and player selectors.
assert.equal(new URL(exampleRequestUrl("getLeaderboard")).searchParams.get("type"), "qty");
assert.ok(Array.isArray(apiExamples.getLatestCompletion.response));
assert.equal(typeof apiExamples.getPlayerRuns.response.nextCursor, "number");
assert.equal(typeof apiExamples.getAAPlayerRuns.response.nextCursor, "number");
assert.equal(new URL(exampleRequestUrl("getRecentRuns")).searchParams.get("name"), "jojoe77777");
assert.equal(new URL(exampleRequestUrl("getPBs")).searchParams.get("names"), "jojoe77777");
assert.equal(new URL(exampleRequestUrl("exportStats")).searchParams.get("format"), "json");
assert.equal(new URL(exampleRequestUrl("exportResetStats")).searchParams.get("format"), "json");
assert.equal(Object.hasOwn(apiExamples.exportStats.response, "notes"), false);
assert.equal(Object.hasOwn(apiExamples.exportResetStats.response, "notes"), false);

const small = {count: 24, avg: "3:00", empty: [], nullable: null};
const smallPreview = exampleResponsePreview(small);
assert.equal(smallPreview.truncated, false);
assert.deepEqual(JSON.parse(smallPreview.json), small);

const large = {
    rows: Array.from({length: 100}, (_, id) => ({id, name: "x".repeat(1000)})),
    metadata: Object.fromEntries(Array.from({length: 100}, (_, id) => [`field${id}`, id])),
    nextCursor: 100,
};
const original = JSON.stringify(large);
const largePreview = exampleResponsePreview(large);
const parsed = JSON.parse(largePreview.json);
assert.equal(largePreview.truncated, true);
assert.ok(largePreview.json.length < 2000, "A large response should produce a small preview");
assert.ok(parsed.rows.length < large.rows.length);
assert.ok(parsed.rows[0].name.length < large.rows[0].name.length);
assert.ok(Object.keys(parsed.metadata).length < Object.keys(large.metadata).length);
assert.equal(parsed.nextCursor, large.nextCursor, "Keep response pagination metadata");
assert.equal(JSON.stringify(large), original, "Previewing must not mutate response fixtures");

const nested = {one: {two: {three: {four: {five: {six: {value: "deep"}}}}}}};
const nestedPreview = exampleResponsePreview(nested);
assert.equal(nestedPreview.truncated, true);
assert.doesNotThrow(() => JSON.parse(nestedPreview.json));

console.log(`API documentation: ${documented.length} example URLs and responses, player selectors, valid JSON truncation and metadata preservation passed`);
