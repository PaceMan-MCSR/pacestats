import localFont from "next/font/local";

export const inter = localFont({
    src: "../../public/fonts/inter-latin-v1.woff2",
    // Variable font: one file covers every weight. Without the range the
    // browser treats this face as weight 400 only and fakes bold text.
    weight: "100 900",
    display: "optional",
    adjustFontFallback: "Arial",
    fallback: ["Arial", "sans-serif"],
    preload: true,
});
