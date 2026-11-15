import assert from "node:assert/strict";
import {createSharedLoader} from "../app/components/sharedLoader";

async function main() {
    let attempts = 0;
    const loader = createSharedLoader(async () => {
        if (++attempts === 1) throw new Error("Transient chunk/network failure");
        return {items: ["Fixture"]};
    });
    const failed = loader.load();
    assert.equal(loader.load(), failed, "Concurrent search boxes share an in-flight load");
    await assert.rejects(failed, /Transient/);
    assert.equal(attempts, 1);
    assert.equal(loader.current, undefined, "Failed work is not published as loaded data");
    const retry = loader.load();
    assert.equal(loader.load(), retry);
    const data = await retry;
    assert.equal(attempts, 2, "A later user intent can retry the failed request");
    assert.equal(loader.current, data);
    assert.equal(await loader.load(), data);
    assert.equal(attempts, 2, "Successful work remains shared across later navigations");
    console.log("PASS: shared search loaders deduplicate concurrent work, recover after failure and reuse successful data");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
