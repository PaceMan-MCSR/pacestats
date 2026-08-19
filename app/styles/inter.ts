import localFont from "next/font/local";

export const inter = localFont({
    src: "../../public/fonts/inter-latin-v1.woff2",
    display: "optional",
    adjustFontFallback: "Arial",
    fallback: ["Arial", "sans-serif"],
    preload: true,
});
