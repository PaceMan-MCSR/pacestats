let availableFonts: string[] | undefined;
let pendingFonts: Promise<string[]> | undefined;

/** Successful enumeration is shared; denied/empty requests may be retried. */
export function loadFontFamilies(query: () => Promise<Array<{family: string}>>): Promise<string[]> {
    if (availableFonts) return Promise.resolve(availableFonts);
    pendingFonts ??= query().then(fonts => {
        if (fonts.length === 0) return [];
        availableFonts = [...new Set(["Inter", "Minecraft", ...fonts.map(font => font.family)])];
        return availableFonts;
    }).finally(() => { pendingFonts = undefined; });
    return pendingFonts;
}
