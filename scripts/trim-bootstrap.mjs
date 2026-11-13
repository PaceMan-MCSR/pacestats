// Writes app/styles/bootstrap.trimmed.css: Bootstrap's stylesheet without the
// rules for classes this app never mentions. The full file is about 230 KB and
// blocks rendering; most of it styles components the site does not use.
//
// A rule stays when every class in one of its selectors appears somewhere in
// the app's source as a whole word, so class names built by concatenation
// ("btn " + variant) are still found. Runs before `npm run dev` and
// `npm run build`; run `npm run css:bootstrap` after adding a Bootstrap class
// if a dev server is already running.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFile = path.join(root, "node_modules/bootstrap/dist/css/bootstrap.min.css");
const outputFile = path.join(root, "app/styles/bootstrap.trimmed.css");
const scanDirs = ["app"];
const scanExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

// Classes the scan cannot see because code outside this repository's source
// adds them, plus state classes Bootstrap toggles on kept components.
const alwaysKeep = ["show", "active", "disabled", "fade", "collapse", "collapsing"];

function collectWords(dir, words) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            collectWords(full, words);
        } else if (scanExtensions.has(path.extname(entry.name))) {
            for (const word of fs.readFileSync(full, "utf8").match(/[A-Za-z][\w-]*/g) ?? []) words.add(word);
        }
    }
}

const used = new Set(alwaysKeep);
for (const dir of scanDirs) collectWords(path.join(root, dir), used);

// Index of the brace that closes the block opened at `open`.
function closingBrace(css, open) {
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}" && --depth === 0) return i;
    }
    throw new Error("Unbalanced braces in the Bootstrap stylesheet");
}

function splitSelectors(list) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        if (list[i] === "(" || list[i] === "[") depth++;
        else if (list[i] === ")" || list[i] === "]") depth--;
        else if (list[i] === "," && depth === 0) {
            parts.push(list.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(list.slice(start));
    return parts;
}

function selectorIsUsed(selector) {
    // A class inside :not() names what the element must lack, and attribute
    // values are not classes, so neither decides whether the rule is needed.
    const required = selector
        .replace(/:not\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "")
        .replace(/\[[^\]]*\]/g, "");
    const classes = required.match(/\.-?[_a-zA-Z][\w-]*/g) ?? [];
    return classes.every((name) => used.has(name.slice(1)));
}

function trim(css) {
    let out = "";
    let i = 0;
    while (i < css.length) {
        const open = css.indexOf("{", i);
        if (open === -1) {
            out += css.slice(i);
            break;
        }
        const close = closingBrace(css, open);
        const prelude = css.slice(i, open);
        const inner = css.slice(open + 1, close);
        const name = prelude.trimStart();
        if (name.startsWith("@media") || name.startsWith("@supports")) {
            const kept = trim(inner);
            if (kept) out += `${prelude}{${kept}}`;
        } else if (name.startsWith("@")) {
            // @keyframes, @font-face and the like: small, keep as they are.
            out += css.slice(i, close + 1);
        } else {
            const selectors = splitSelectors(prelude).filter(selectorIsUsed);
            if (selectors.length > 0) out += `${selectors.join(",")}{${inner}}`;
        }
        i = close + 1;
    }
    return out;
}

const original = fs.readFileSync(sourceFile, "utf8");
const banner = original.match(/^\s*(?:@charset "[^"]*";)?\s*\/\*![\s\S]*?\*\//)?.[0] ?? "";
const body = original.slice(banner.length).replace(/\/\*# sourceMappingURL=.*?\*\//, "");
const result = `${banner}\n/* Trimmed by scripts/trim-bootstrap.mjs. Do not edit; run "npm run css:bootstrap". */\n${trim(body)}\n`;

const previous = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, "utf8") : null;
if (previous !== result) fs.writeFileSync(outputFile, result);

const kb = (text) => `${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`;
console.log(`bootstrap.trimmed.css: ${kb(original)} -> ${kb(result)}${previous === result ? " (unchanged)" : ""}`);
