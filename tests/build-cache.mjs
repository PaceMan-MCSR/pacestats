/** Isolated build/nginx cache tests; no production files or services are used. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {createServer} from "node:http";
import {refreshNginxCache, renderCacheVersion, inspectNginxConfig} from "../scripts/refresh-nginx-cache.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pacestats-build-cache-"));
let nextFixture = 0;

function fixture({id = "new-build_123", publish = true, previous = "previous namespace\n"} = {}) {
    const directory = path.join(temporary, String(nextFixture++)), next = path.join(directory, ".next");
    const publishDir = path.join(directory, "published"), published = path.join(publishDir, "nginx-cache-version.conf");
    fs.mkdirSync(next, {recursive: true});
    if (publish) fs.mkdirSync(publishDir);
    if (publish && previous !== null) fs.writeFileSync(published, previous);
    const setBuild = (buildId, headers = [{source: "/stats/:path*", headers: [{key: "X-PaceStats-Build", value: buildId}]}]) => {
        fs.writeFileSync(path.join(next, "BUILD_ID"), `${buildId}\n`);
        fs.writeFileSync(path.join(next, "routes-manifest.json"), JSON.stringify({headers}));
    };
    setBuild(id);
    const logs = [], calls = [];
    const env = {PACESTATS_STATIC_DIR: publishDir};
    const config = ({key = '$scheme$host$pacestats_cache_build$request_uri', noCache = '$pacestats_cache_mismatch', included = true} = {}) => `
# configuration file /etc/nginx/nginx.conf:
http {
    server { location /stats/ {
        proxy_pass http://127.0.0.1:5050;
        proxy_cache pacestats;
        proxy_cache_key "${key}";
        proxy_no_cache ${noCache};
    } }
}
${included ? `# configuration file ${published}:\n${fs.readFileSync(published, "utf8")}` : ""}`;
    const runner = (binary, args, options) => {
        calls.push({binary, args, options});
        return {status: 0, stdout: args[0] === "-T" ? config() : "", stderr: ""};
    };
    const run = (options = {}) => refreshNginxCache(directory, {env, runner, log: message => logs.push(message), ...options});
    return {directory, next, publishDir, published, env, logs, calls, config, runner, run, setBuild};
}

function verifyGenerationAndActivation() {
    const f = fixture();
    const result = f.run();
    assert.equal(result.reloaded, true);
    assert.equal(result.buildId, "new-build_123");
    const contents = fs.readFileSync(result.artifactPath, "utf8");
    assert.equal(fs.readFileSync(f.published, "utf8"), contents);
    assert.equal(contents, renderCacheVersion(result.buildId));
    assert.ok(contents.includes('default "new-build_123";'));
    assert.ok(contents.includes('"new-build_123" 0;'));
    assert.ok(contents.includes('map $upstream_http_x_pacestats_build $pacestats_cache_mismatch'));
    assert.deepEqual(f.calls.map(call => call.args), [["-T"], ["-s", "reload"]]);
    assert.ok(f.calls.every(call => !call.options.shell && call.options.windowsHide));
    assert.ok(f.logs[0].includes("Activated build new-build_123"));
    assert.deepEqual(fs.readdirSync(f.next).sort(), ["BUILD_ID", "nginx-cache-version.conf", "routes-manifest.json"]);
    assert.deepEqual(fs.readdirSync(f.publishDir), ["nginx-cache-version.conf"]);
    if (process.platform !== "win32") assert.equal(fs.statSync(f.published).mode & 0o777, 0o644);
    f.env.PACESTATS_NGINX_BIN = "/custom path/nginx";
    f.setBuild("another-build");
    f.run();
    assert.equal(f.calls.at(-1).binary, "/custom path/nginx", "Custom executable paths are passed directly without a shell");
    assert.ok(fs.readFileSync(f.published, "utf8").includes('"another-build"'));
}

function verifyBuildValidation() {
    for (const id of ["", "x".repeat(129), "bad/id", 'bad";include secret;', "bad\ninternal-newline"]) {
        const f = fixture({id});
        assert.throws(() => f.run(), /Invalid Next build ID/);
        assert.equal(fs.readFileSync(f.published, "utf8"), "previous namespace\n");
        assert.equal(f.calls.length, 0);
        assert.equal(fs.existsSync(path.join(f.next, "nginx-cache-version.conf")), false);
    }
    for (const headers of [[], [{source: "/stats/api", headers: [{key: "X-PaceStats-Build", value: "new-build_123"}]}],
        [{source: "/stats/:path*", headers: [{key: "X-PaceStats-Build", value: "old-build"}]}],
        [{source: "/:path*", headers: [{key: "X-PaceStats-Build", value: "new-build_123"}, {key: "X-PaceStats-Build", value: "conflict"}]}]]) {
        const f = fixture();
        f.setBuild("new-build_123", headers);
        assert.throws(() => f.run(), /global X-PaceStats-Build/);
        assert.equal(f.calls.length, 0);
        assert.equal(fs.readFileSync(f.published, "utf8"), "previous namespace\n");
    }
    const malformed = fixture();
    fs.writeFileSync(path.join(malformed.next, "routes-manifest.json"), "not-json");
    assert.throws(() => malformed.run(), /routes-manifest/);
    const absent = fixture();
    fs.unlinkSync(path.join(absent.next, "BUILD_ID"));
    assert.throws(() => absent.run(), /BUILD_ID/);
    const lowercase = fixture();
    lowercase.setBuild("build", [{source: "/:path*", headers: [{key: "x-pacestats-build", value: "build"}]}]);
    assert.equal(lowercase.run().reloaded, true);
}

function verifySafeSkipsAndSettings() {
    const local = fixture({publish: false});
    assert.equal(local.run().publishedPath, null);
    assert.equal(local.calls.length, 0, "An absent publishing directory never touches unrelated local nginx");
    local.env.PACESTATS_NGINX_RELOAD = "1";
    assert.throws(() => local.run(), /directory does not exist/);
    const prepareOnly = fixture();
    prepareOnly.env.PACESTATS_NGINX_RELOAD = "0";
    assert.equal(prepareOnly.run().reloaded, false);
    assert.equal(prepareOnly.calls.length, 0);
    assert.ok(fs.readFileSync(prepareOnly.published, "utf8").includes("new-build_123"));
    const missing = fixture(), probes = [];
    const unavailable = (binary, args) => {probes.push({binary, args}); return {status: null, error: {code: "ENOENT"}};};
    assert.equal(missing.run({runner: unavailable}).reloaded, false);
    assert.deepEqual(probes.map(probe => probe.binary), ["nginx", "/usr/sbin/nginx"]);
    const required = fixture();
    required.env.PACESTATS_NGINX_RELOAD = "1";
    assert.throws(() => required.run({runner: unavailable}), /nginx is unavailable/);
    assert.equal(fs.readFileSync(required.published, "utf8"), "previous namespace\n");
    const unrelated = fixture();
    assert.equal(unrelated.run({runner: (_binary, args) => {
        assert.deepEqual(args, ["-T"]);
        return {status: 0, stdout: unrelated.config({included: false})};
    }}).reloaded, false);
    assert.ok(unrelated.logs[0].includes("one-time nginx include/cache-key setup"));
    const requiredUnrelated = fixture();
    requiredUnrelated.env.PACESTATS_NGINX_RELOAD = "1";
    assert.throws(() => requiredUnrelated.run({runner: () => ({status: 0, stdout: "# unrelated nginx configuration\n"})}), /does not include/);
    assert.equal(fs.readFileSync(requiredUnrelated.published, "utf8"), "previous namespace\n");
    const configuredEnv = fixture();
    fs.writeFileSync(path.join(configuredEnv.directory, ".env"), "PACESTATS_NGINX_RELOAD=1\n");
    fs.writeFileSync(path.join(configuredEnv.directory, ".env.local"), "PACESTATS_NGINX_RELOAD=0\n");
    assert.equal(configuredEnv.run().reloaded, false);
    assert.equal(configuredEnv.calls.length, 0, ".env.local takes priority over .env");
    configuredEnv.env.PACESTATS_NGINX_RELOAD = "1";
    assert.equal(configuredEnv.run().reloaded, true, "Explicit environment settings take priority over dotenv files");
    const productionEnv = fixture();
    for (const name of [".env", ".env.production", ".env.local"]) fs.writeFileSync(path.join(productionEnv.directory, name), "PACESTATS_NGINX_RELOAD=1\n");
    fs.writeFileSync(path.join(productionEnv.directory, ".env.production.local"), "PACESTATS_NGINX_RELOAD=0\n");
    assert.equal(productionEnv.run().reloaded, false);
    assert.equal(productionEnv.calls.length, 0, ".env.production.local takes precedence over all other production dotenv files");
}

function verifyConfigurationGuardsAndRollback() {
    for (const settings of [{key: "$request_uri"}, {noCache: "$http_authorization"}]) {
        const f = fixture();
        assert.throws(() => f.run({runner: () => ({status: 0, stdout: f.config(settings)})}), /cache key and no-cache rule/);
        assert.equal(fs.readFileSync(f.published, "utf8"), "previous namespace\n");
    }
    const f = fixture();
    const spoofed = f.config({key: "$request_uri", noCache: "$http_authorization"}) +
        '\n# proxy_cache_key $pacestats_cache_build; proxy_no_cache $pacestats_cache_mismatch;\n' +
        '\nlocation /stats/_next/static/ { proxy_cache_key $pacestats_cache_build; proxy_no_cache $pacestats_cache_mismatch; }';
    assert.deepEqual(inspectNginxConfig(spoofed, f.published), {included: true, protected: false}, "Comments/static rules do not prove that dynamic responses have the build guards");
    const anotherCache = f.config() + '\nserver { location /stats/ { proxy_cache pacestats; proxy_cache_key $request_uri; } }';
    assert.deepEqual(inspectNginxConfig(anotherCache, f.published), {included: true, protected: false}, "One protected server cannot hide another unguarded stats cache");
    for (const failAt of ["-T", "reload"]) {
        const failure = fixture();
        let thrown;
        try {failure.run({runner: (_binary, args) => {
            if (args.includes(failAt)) return {status: 1, stdout: "PRIVATE CONFIG VALUE", stderr: "SECRET API TOKEN"};
            return {status: 0, stdout: failure.config()};
        }});} catch (error) {thrown = error;}
        assert.ok(thrown instanceof Error);
        assert.ok(!thrown.message.includes("PRIVATE CONFIG") && !thrown.message.includes("SECRET API"));
        assert.ok(!failure.logs.join(" ").includes("SECRET"));
        assert.equal(fs.readFileSync(failure.published, "utf8"), "previous namespace\n");
        assert.ok(fs.readFileSync(path.join(failure.next, "nginx-cache-version.conf"), "utf8").includes("new-build_123"));
        assert.deepEqual(fs.readdirSync(failure.publishDir), ["nginx-cache-version.conf"], "Rollback leaves no partial include or temporary files");
    }
    const permissionDenied = fixture();
    assert.throws(() => permissionDenied.run({runner: () => ({status: null, error: {code: "EACCES"}})}), /configuration test failed/);
    assert.equal(fs.readFileSync(permissionDenied.published, "utf8"), "previous namespace\n");
    const firstPublish = fixture({previous: null});
    assert.throws(() => firstPublish.run({runner: () => ({status: 1})}), /configuration test failed/);
    assert.equal(fs.existsSync(firstPublish.published), false, "Failed first activation restores the original absence of an include");
}

function verifyStaticPublicationKeepsActiveInclude() {
    const f = fixture();
    const scripts = path.join(f.directory, "scripts"), staticDir = path.join(f.next, "static");
    fs.mkdirSync(scripts);
    fs.mkdirSync(staticDir);
    fs.mkdirSync(path.join(f.directory, "node_modules"));
    fs.cpSync(path.join(root, "node_modules", "dotenv"), path.join(f.directory, "node_modules", "dotenv"), {recursive: true});
    fs.copyFileSync(path.join(root, "scripts", "precompress.mjs"), path.join(scripts, "precompress.mjs"));
    const setting = value => `PACESTATS_STATIC_DIR=${JSON.stringify(value.replaceAll("\\", "/"))}\n`;
    for (const name of [".env", ".env.production", ".env.local"]) {
        fs.writeFileSync(path.join(f.directory, name), setting(path.join(f.directory, "unused-publishing-directory")));
    }
    fs.writeFileSync(path.join(f.directory, ".env.production.local"), setting(f.publishDir));
    fs.writeFileSync(path.join(staticDir, "current.js"), "current static asset");
    const oldAsset = path.join(f.publishDir, "obsolete.js");
    fs.writeFileSync(oldAsset, "old static asset");
    const old = new Date(Date.now() - 31 * 86400000);
    fs.utimesSync(oldAsset, old, old);
    fs.utimesSync(f.published, old, old);
    const env = {...process.env};
    delete env.PACESTATS_STATIC_DIR;
    const run = () => spawnSync(process.execPath, [path.join(scripts, "precompress.mjs")], {encoding: "utf8", env, windowsHide: true});
    const output = run();
    assert.equal(output.status, 0, output.stderr);
    assert.equal(fs.existsSync(oldAsset), false);
    assert.equal(fs.readFileSync(f.published, "utf8"), "previous namespace\n", "Static cleanup must preserve the active namespace even if a later build step fails");
    assert.equal(fs.readFileSync(path.join(f.publishDir, "current.js"), "utf8"), "current static asset", "Production dotenv settings select the same publishing directory as the namespace refresher");
    const override = path.join(f.directory, "explicit-publishing-directory");
    fs.mkdirSync(override);
    env.PACESTATS_STATIC_DIR = override;
    const explicit = run();
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(fs.readFileSync(path.join(override, "current.js"), "utf8"), "current static asset", "An explicit static directory overrides production dotenv settings");
}

async function verifyRealNginx() {
    const f = fixture({id: "old-build", previous: null});
    f.env.PACESTATS_NGINX_RELOAD = "0";
    f.run();
    let upstreamBuild = "old-build";
    const upstream = createServer((_request, response) => {
        response.writeHead(200, {"Content-Type": "text/plain", "Cache-Control": "public, s-maxage=3600", "X-PaceStats-Build": upstreamBuild});
        response.end(`response from ${upstreamBuild}`);
    });
    await new Promise(resolve => upstream.listen(0, "0.0.0.0", resolve));
    const name = `pacestats-build-cache-${process.pid}`, container = "/fixture";
    const docker = args => {
        const result = spawnSync("docker", args, {encoding: "utf8", windowsHide: true, timeout: 20_000});
        assert.equal(result.status, 0, `docker ${args[0]} failed: ${result.stderr}`);
        return result;
    };
    const nginxConfig = `pid /tmp/nginx.pid;\nerror_log /dev/stderr warn;\nevents {}\nhttp {\n` +
        `proxy_cache_path /tmp/pacestats-cache keys_zone=pacestats:1m;\ninclude ${container}/published/nginx-cache-version.conf;\n` +
        `server { listen 80; location /stats/ { proxy_pass http://host.docker.internal:${upstream.address().port};\n` +
        `proxy_cache pacestats; proxy_cache_key "$scheme$host|$pacestats_cache_build|$request_uri";\n` +
        `proxy_no_cache $pacestats_cache_mismatch; add_header X-Cache-Status $upstream_cache_status always; } } }\n`;
    fs.writeFileSync(path.join(f.directory, "nginx.conf"), nginxConfig);
    try {
        docker(["run", "--rm", "--detach", "--name", name, "--publish", "127.0.0.1::80", "--mount", `type=bind,src=${f.directory},dst=${container}`,
            "--entrypoint", "nginx", "nginx:1.18", "-c", `${container}/nginx.conf`, "-g", "daemon off;"]);
        const address = docker(["port", name, "80/tcp"]).stdout.trim();
        const url = `http://${address}/stats/api/`;
        const request = async () => {
            const response = await fetch(url, {headers: {Connection: "close"}});
            assert.equal(response.status, 200);
            return {status: response.headers.get("x-cache-status"), body: await response.text()};
        };
        let initial;
        for (let attempt = 0; attempt < 40; attempt++) {
            try {initial = await request(); break;} catch {await new Promise(resolve => setTimeout(resolve, 50));}
        }
        assert.ok(initial, "Isolated nginx starts listening");
        assert.deepEqual(await request(), {status: "HIT", body: "response from old-build"});
        f.setBuild("new-build");
        f.env.PACESTATS_NGINX_RELOAD = "1";
        f.run({runner: (_binary, args) => {
            const result = docker(["exec", name, "nginx", "-c", `${container}/nginx.conf`, ...args]);
            // The bind mount has different host/container path spellings.
            return {...result, stdout: result.stdout.replaceAll(`${container}/published`, f.publishDir)};
        }});
        let mismatched;
        for (let attempt = 0; attempt < 40; attempt++) {
            mismatched = await request();
            if (mismatched.status === "MISS") break;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.deepEqual(mismatched, {status: "MISS", body: "response from old-build"});
        assert.deepEqual(await request(), {status: "MISS", body: "response from old-build"}, "Old running Next responses cannot populate the new namespace");
        upstreamBuild = "new-build";
        assert.deepEqual(await request(), {status: "MISS", body: "response from new-build"});
        assert.deepEqual(await request(), {status: "HIT", body: "response from new-build"}, "The newly started build fills only the new namespace");
    } finally {
        spawnSync("docker", ["rm", "--force", name], {encoding: "utf8", windowsHide: true, timeout: 20_000});
        await new Promise(resolve => upstream.close(resolve));
    }
}

try {
    verifyGenerationAndActivation();
    verifyBuildValidation();
    verifySafeSkipsAndSettings();
    verifyConfigurationGuardsAndRollback();
    verifyStaticPublicationKeepsActiveInclude();
    if (process.env.BUILD_CACHE_NGINX_TEST === "1") await verifyRealNginx();
    console.log(`Build cache: generation/header guards, activation, safe skips, rollback and static cleanup passed${process.env.BUILD_CACHE_NGINX_TEST === "1" ? "; real nginx MISS/HIT and old-origin isolation passed" : ""}`);
} finally {
    const cleanup = path.resolve(temporary);
    assert.equal(path.dirname(cleanup), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cleanup).startsWith("pacestats-build-cache-"));
    fs.rmSync(cleanup, {recursive: true, force: true});
}
