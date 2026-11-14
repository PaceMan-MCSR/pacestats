'use client';

import {useCallback, useEffect, useRef, useState, useSyncExternalStore} from "react";
import MaterialIcon from "@/app/components/MaterialIcon";
import {loadFontFamilies} from "@/app/obs/fontCatalog";
import "./fontPicker.css";

export default function FontPicker({output}: {output: (font: string) => void}) {
    const [fonts, setFonts] = useState(["Inter", "Minecraft"]);
    const [selectedFont, setSelectedFont] = useState("Minecraft");
    const [hasPermission, setHasPermission] = useState(true);
    const mounted = useRef(false);
    const supported = useSyncExternalStore(
        () => () => {},
        () => typeof window !== "undefined" && "queryLocalFonts" in window,
        () => false,
    );
    const reloadFonts = useCallback(async () => {
        if (!supported) return;
        try {
            const nextFonts = await loadFontFamilies(() => (window as unknown as {
                queryLocalFonts: () => Promise<Array<{family: string}>>,
            }).queryLocalFonts());
            if (!mounted.current) return;
            setHasPermission(nextFonts.length > 0);
            if (nextFonts.length > 0) setFonts(nextFonts);
        } catch {
            if (mounted.current) setHasPermission(false);
        }
    }, [supported]);
    useEffect(() => {
        mounted.current = true;
        const timer = setTimeout(() => void reloadFonts(), 0);
        return () => { mounted.current = false; clearTimeout(timer); };
    }, [reloadFonts]);

    return <div className="font-wrapper">
        <p className="fontExample" style={{fontFamily: selectedFont}}>Font: {selectedFont}</p>
        <select className="fontSelect" aria-label="Font" value={selectedFont} onFocus={() => void reloadFonts()}
            onChange={event => { setSelectedFont(event.target.value); output(event.target.value); }}>
            {fonts.map(font => <option key={font} value={font}>{font}</option>)}
        </select>
        <p hidden={!supported || hasPermission} className="fontWarning">
            Font access was denied. Please enable it by clicking on the <MaterialIcon icon="info" className="info-icon"/> icon next to the address bar.
        </p>
        <p hidden={supported} className="fontWarning">
            Local font access is not supported in this browser, please use Chrome or Edge.
        </p>
    </div>;
}
