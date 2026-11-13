import type {CSSProperties} from "react";

const paths = {
    menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
    close: "M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.41 4.29 19.71 2.88 18.29 9.17 12 2.88 5.71 4.29 4.29 10.59 10.59 16.89 4.29z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    delete: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zm2-10h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4z",
    info: "M11 17h2v-6h-2v6zm1-15C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-11h2V7h-2v2z",
    help: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.25-.9.92C13.45 13.4 13 14 13 15h-2v-.5c0-.8.45-1.55 1.17-2.27l1.24-1.26c.37-.36.59-.86.59-1.37a2 2 0 0 0-4 0H8a4 4 0 0 1 8 0c0 .88-.36 1.68-.93 2.15z",
} as const;

export default function MaterialIcon({icon, className, style}: {
    icon: keyof typeof paths,
    className?: string,
    style?: CSSProperties,
}) {
    return <svg className={className ? `materialIcon ${className}` : "materialIcon"} style={style} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={paths[icon]}/>
    </svg>;
}
