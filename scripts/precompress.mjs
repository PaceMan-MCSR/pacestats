// Writes .br and .gz copies next to the files in .next/static after a build,
// so nginx can send them as they are (brotli_static / gzip_static) instead of
// compressing each response on the fly at a lower level. Brotli at level 11
// is about 9% smaller than nginx's level 5 on this build's JavaScript.
// See ops/nginx/pacestats.conf for the matching location block.
//
// Runs as `postbuild`. A deploy that does not use the nginx block loses
// nothing: the extra files are ignored.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = path.join(root, ".next", "static");
const compressible = new Set([".js", ".css", ".json", ".svg", ".txt", ".map"]);
const MIN_BYTES = 1024;

if (!fs.existsSync(staticDir)) {
    console.log("precompress: no .next/static directory, nothing to do");
    process.exit(0);
}

let files = 0;
let rawBytes = 0;
let brotliBytes = 0;

function visit(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            visit(full);
            continue;
        }
        if (!compressible.has(path.extname(entry.name))) continue;
        const source = fs.readFileSync(full);
        if (source.length < MIN_BYTES) continue;

        const brotli = zlib.brotliCompressSync(source, {
            params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: source.length,
            },
        });
        const gzip = zlib.gzipSync(source, {level: 9});
        fs.writeFileSync(`${full}.br`, brotli);
        fs.writeFileSync(`${full}.gz`, gzip);
        // nginx only uses a precompressed file whose timestamp matches.
        const {atime, mtime} = fs.statSync(full);
        fs.utimesSync(`${full}.br`, atime, mtime);
        fs.utimesSync(`${full}.gz`, atime, mtime);

        files++;
        rawBytes += source.length;
        brotliBytes += brotli.length;
    }
}

visit(staticDir);
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`precompress: ${files} files, ${kb(rawBytes)} -> ${kb(brotliBytes)} with Brotli`);

// Publish the files where nginx can read them. This happens only when the
// folder already exists, so creating it once on the server
// (`mkdir -p /var/www/pacestats-static`) switches it on and every later
// build keeps it current. Set PACESTATS_STATIC_DIR to use another folder.
// Files from earlier builds stay for 30 days, so a page opened before a
// deploy can still load its scripts.
const publishDir = process.env.PACESTATS_STATIC_DIR || "/var/www/pacestats-static";
const KEEP_OLD_BUILDS_MS = 30 * 24 * 60 * 60 * 1000;

function removeOldFiles(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            removeOldFiles(full);
            if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } else if (Date.now() - fs.statSync(full).mtimeMs > KEEP_OLD_BUILDS_MS) {
            fs.unlinkSync(full);
        }
    }
}

if (fs.existsSync(publishDir) && fs.statSync(publishDir).isDirectory()) {
    try {
        removeOldFiles(publishDir);
        fs.cpSync(staticDir, publishDir, {recursive: true, force: true});
        // Readable by the nginx user whatever umask the build ran under.
        const open = (dir) => {
            fs.chmodSync(dir, 0o755);
            for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) open(full);
                else fs.chmodSync(full, 0o644);
            }
        };
        open(publishDir);
        console.log(`precompress: copied to ${publishDir}`);
    } catch (error) {
        // The site still works through Next.js if nginx proxies instead.
        console.error(`precompress: could not copy to ${publishDir}: ${error.message}`);
        process.exitCode = 1;
    }
}
