/** Load private producer helpers for read-only verification without running main. */
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function loadProducerModule(sourcePath, names, root = process.cwd(), {hasMain = true} = {}) {
    const source = await readFile(sourcePath, 'utf8');
    const main = source.lastIndexOf('\nmain().catch');
    if (hasMain && main < 0) throw new Error('Producer main entry point changed; refusing to import a live cache job.');
    if (!names.every((name) => /^[A-Za-z][A-Za-z0-9]*$/.test(name))) throw new Error('Invalid helper export.');
    const rewritten = (hasMain ? source.slice(0, main) : source)
        .replace(/from "(\.\/[^"]+)"/g,
            (_match, relative) => `from ${JSON.stringify(resolve(root, 'scripts', `${relative}.ts`))}`)
        .replace(/from "@\/([^"]+)"/g,
            (_match, relative) => `from ${JSON.stringify(resolve(root, `${relative}.ts`))}`);
    const directory = resolve(process.cwd(), 'node_modules/.cache');
    await mkdir(directory, {recursive: true});
    const temporary = await mkdtemp(resolve(directory, 'pacestats-producer-'));
    const modulePath = resolve(temporary, 'producer.ts');
    const dispose = () => rm(temporary, {recursive: true, force: true});
    try {
        await writeFile(modulePath, `${rewritten}\nexport {${names.join(',')}};\n`);
        return {producer: await import(pathToFileURL(modulePath).href), dispose};
    } catch (error) {
        await dispose();
        throw error;
    }
}
