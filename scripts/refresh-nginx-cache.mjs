// Rotate nginx's dynamic-response namespace after a successful Next build.
// Old running servers cannot populate it: nginx also checks their build header.
import fs from "node:fs";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import dotenv from "dotenv";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const includeName = "nginx-cache-version.conf";

export function renderCacheVersion(buildId) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(buildId)) throw new Error("Invalid Next build ID.");
    return `# Generated after next build; do not edit.\n` +
        `map $host $pacestats_cache_build {\n    default "${buildId}";\n}\n` +
        `map $upstream_http_x_pacestats_build $pacestats_cache_mismatch {\n    default 1;\n    "${buildId}" 0;\n}\n`;
}

function atomicWrite(filename, contents) {
    const temporary = path.join(path.dirname(filename), `.${path.basename(filename)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
    try {
        fs.writeFileSync(temporary, contents, {flag: "wx", mode: 0o644});
        fs.chmodSync(temporary, 0o644);
        fs.renameSync(temporary, filename);
    } finally {
        try {fs.unlinkSync(temporary);} catch (error) {if (error.code !== "ENOENT") throw error;}
    }
}

function stripComments(source) {
    let output = "", quoted = "", escaped = false, comment = false;
    for (const character of source) {
        if (comment) {
            if (character === "\n") {comment = false; output += character;}
            continue;
        }
        if (escaped) {output += character; escaped = false; continue;}
        if (character === "\\") {output += character; escaped = true; continue;}
        if (quoted) {
            output += character;
            if (character === quoted) quoted = "";
            continue;
        }
        if (character === '"' || character === "'") {quoted = character; output += character;}
        else if (character === "#") comment = true;
        else output += character;
    }
    return output;
}

function statsLocations(source) {
    const locations = [], expression = /\blocation\s+(?:\^~\s+)?(?:\/stats\/|"\/stats\/"|'\/stats\/')\s*\{/g;
    for (const match of source.matchAll(expression)) {
        let depth = 1, quoted = "", escaped = false;
        const start = match.index + match[0].length;
        for (let index = start; index < source.length; index++) {
            const character = source[index];
            if (escaped) {escaped = false; continue;}
            if (character === "\\") {escaped = true; continue;}
            if (quoted) {if (character === quoted) quoted = ""; continue;}
            if (character === '"' || character === "'") {quoted = character; continue;}
            if (character === "{") depth++;
            if (character === "}" && --depth === 0) {locations.push(source.slice(start, index)); break;}
        }
    }
    return locations;
}

const normalizedPath = filename => {
    const resolved = path.resolve(filename).replaceAll("\\", "/");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

export function inspectNginxConfig(source, publishedPath) {
    const included = [...source.matchAll(/^# configuration file (.+):\r?$/gm)]
        .some(match => normalizedPath(match[1]) === normalizedPath(publishedPath));
    if (!included) return {included: false, protected: false};
    const locations = statsLocations(stripComments(source));
    const cachedLocations = locations.filter(location => /\bproxy_cache\s+(?!off(?:\s|;))[^;]+;/.test(location));
    const protectedCache = cachedLocations.length > 0 && cachedLocations.every(location =>
        /\bproxy_cache_key\s+[^;]*\$pacestats_cache_build\b[^;]*;/.test(location) &&
        /\bproxy_no_cache\s+[^;]*\$pacestats_cache_mismatch\b[^;]*;/.test(location));
    return {included: true, protected: protectedCache};
}

/** runner/log/env injection keeps regression tests isolated from live nginx. */
export function refreshNginxCache(root = repoRoot, options = {}) {
    const env = options.env ?? process.env, runner = options.runner ?? spawnSync, log = options.log ?? console.log;
    // postbuild follows Next's production dotenv precedence. Existing environment
    // values win, and settings/secrets never appear in the build log.
    dotenv.config({path: [".env.production.local", ".env.local", ".env.production", ".env"].map(name => path.join(root, name)), processEnv: env, quiet: true});
    const reload = env.PACESTATS_NGINX_RELOAD ?? "auto";
    if (!["auto", "0", "1", ""].includes(reload)) throw new Error("PACESTATS_NGINX_RELOAD must be 0, 1, or auto.");
    let buildId, manifest;
    try {buildId = fs.readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim();}
    catch {throw new Error("Missing .next/BUILD_ID; complete next build first.");}
    const contents = renderCacheVersion(buildId);
    try {manifest = JSON.parse(fs.readFileSync(path.join(root, ".next", "routes-manifest.json"), "utf8"));}
    catch {throw new Error("Missing or invalid .next/routes-manifest.json; complete next build first.");}
    const buildHeaders = (manifest.headers ?? []).filter(route => ["/:path*", "/stats/:path*"].includes(route.source))
        .flatMap(route => route.headers ?? []).filter(header => header.key?.toLowerCase() === "x-pacestats-build");
    if (buildHeaders.length === 0 || buildHeaders.some(header => header.value !== buildId)) {
        throw new Error("The global X-PaceStats-Build response header must match .next/BUILD_ID.");
    }
    const artifactPath = path.join(root, ".next", includeName);
    atomicWrite(artifactPath, contents);
    const publishDir = path.resolve(root, env.PACESTATS_STATIC_DIR || "/var/www/pacestats-static");
    const result = {buildId, artifactPath, publishedPath: null, reloaded: false};
    let exists = false;
    try {exists = fs.statSync(publishDir).isDirectory();}
    catch (error) {if (error.code !== "ENOENT") throw error;}
    if (!exists) {
        if (reload === "1") throw new Error("The nginx static publishing directory does not exist.");
        log("[nginx-cache] Prepared build namespace; nginx publishing directory is absent.");
        return result;
    }
    const publishedPath = path.join(publishDir, includeName);
    let previous;
    try {previous = fs.readFileSync(publishedPath);}
    catch (error) {if (error.code !== "ENOENT") throw error;}
    atomicWrite(publishedPath, contents);
    result.publishedPath = publishedPath;
    try {
        if (reload === "0") {
            log("[nginx-cache] Published build namespace; automatic reload is disabled.");
            return result;
        }
        const candidates = env.PACESTATS_NGINX_BIN ? [env.PACESTATS_NGINX_BIN] : ["nginx", "/usr/sbin/nginx"];
        let binary, tested;
        const commandOptions = {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15_000};
        for (const candidate of candidates) {
            const response = runner(candidate, ["-T"], commandOptions);
            if (response.error?.code === "ENOENT") continue;
            binary = candidate;
            tested = response;
            break;
        }
        if (!binary) {
            if (reload === "1") throw new Error("nginx is unavailable; cannot activate the build namespace.");
            log("[nginx-cache] Published build namespace; nginx is unavailable. Complete the one-time nginx include setup on the server.");
            return result;
        }
        if (tested.error || tested.status !== 0) throw new Error("nginx configuration test failed; the previous namespace was restored. Check nginx permissions and configuration.");
        const configuration = inspectNginxConfig(String(tested.stdout ?? ""), publishedPath);
        if (!configuration.included) {
            if (reload === "1") throw new Error("nginx does not include the published cache version file.");
            log("[nginx-cache] Published build namespace; complete the one-time nginx include/cache-key setup. Unrelated nginx configuration was not reloaded.");
            return result;
        }
        if (!configuration.protected) throw new Error("The /stats/ nginx cache key and no-cache rule must use the build namespace and mismatch variables.");
        const activated = runner(binary, ["-s", "reload"], commandOptions);
        if (activated.error || activated.status !== 0) throw new Error("nginx reload failed; the previous namespace was restored. Check nginx reload permissions.");
        result.reloaded = true;
        log(`[nginx-cache] Activated build ${buildId}; earlier dynamic responses are no longer reused.`);
        return result;
    } catch (error) {
        try {
            if (previous !== undefined) atomicWrite(publishedPath, previous);
            else fs.unlinkSync(publishedPath);
        } catch {
            throw new Error(`${error.message} Could not restore the published cache version file.`);
        }
        throw error;
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {refreshNginxCache();}
    catch (error) {console.error(`[nginx-cache] ${error.message}`); process.exitCode = 1;}
}
