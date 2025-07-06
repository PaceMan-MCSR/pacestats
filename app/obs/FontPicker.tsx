'use client'

import {useEffect, useState} from "react";
import Select, {ActionMeta, GroupBase} from "react-select";

export default function FontPicker({output}: {output: any}) {
    const [fonts, setFonts] = useState([
        {value: "Inter", label: "Inter"},
        {value: "Minecraft", label: "Minecraft"},
    ]);
    const [selectedFont, setSelectedFont] = useState("Minecraft");
    const [hasPermission, setHasPermission] = useState(true);
    const [supported, setSupported] = useState(true);

    useEffect(() => {
        (async () => {
            reloadFonts();
        })();
        setSupported(typeof window !== "undefined" && 'queryLocalFonts' in window)
    }, [])

    const reloadFonts = async () => {
        if(typeof window === "undefined") {
            return
        }
        if (!supported) {
            return
        }
        try {
            // @ts-ignore
            const fonts = await window.queryLocalFonts();
            if(fonts.length === 0){
                setHasPermission(false)
                return
            }
            let fontList: string[] = ["Inter", "Minecraft"];
            for(let font of fonts) {
                if(!fontList.includes(font.family)){
                    fontList.push(font.family)
                }
            }
            let formatted = fontList.map((font: any) => {
                return {
                    value: font,
                    label: font
                };
            })
            setHasPermission(true)
            setFonts(formatted);
        } catch (e) {
            console.log("Font access was denied: " + e)
        }
    }

    const selectFont = (option: any, actionMeta: ActionMeta<any>) => {
        output(option.value);
        setSelectedFont(option.value);
    }

    return (<div className="font-wrapper" suppressHydrationWarning>
        <p className="fontExample" style={{fontFamily: selectedFont}}>Font: {selectedFont}</p>
        <Select placeholder="Select font" maxMenuHeight={225}
                options={fonts as unknown as GroupBase<string>[]} styles={{
                    option: (baseStyles: any, state: any) => ({
                        ...baseStyles,
                        color: 'rgb(230, 230, 230)',
                        backgroundColor: state.isFocused ? 'rgb(8, 8, 11)' : 'rgb(18, 18, 21)',
                    }),
                    control: (baseStyles: any, state: any) => ({
                        ...baseStyles,
                        backgroundColor: 'rgb(18, 18, 21)',
                        color: 'white',
                        border: '1px solid rgb(10, 10, 10)',
                    }),
                    menu: (baseStyles: any, state: any) => ({
                        ...baseStyles,
                        backgroundColor: 'rgb(18, 18, 21)',
                        border: '1px solid rgb(10, 10, 10)',
                    }),
                    singleValue: (baseStyles: any, state: any) => ({
                        ...baseStyles,
                        color: 'rgb(230, 230, 230)',
                    }),
                    indicatorSeparator: (baseStyles: any, state: any) => ({
                        ...baseStyles,
                        backgroundColor: 'rgb(10, 10, 10)',
                    }),
                    input: (baseStyles: any, state: any) => ({
                        ...baseStyles,
                        color: 'rgb(230, 230, 230)',
                    })
                }}
                theme={(theme: any) => ({
                    ...theme,
                    colors: {
                        ...theme.colors,
                        primary50: 'rgb(8, 8, 11)',
                    },
                })}
                onChange={selectFont} onFocus={reloadFonts}/>
        <p style={{display: supported && !hasPermission ? "block" : "none"}} className="fontWarning">
            Font access was denied. Please enable it by clicking on the <span className="material-symbols-outlined info-icon">info</span> icon next to the address bar.</p>
        <p style={{display: !supported ? "block" : "none"}} className="fontWarning">
            Local font access is not supported in this browser, please use Chrome or Edge.</p>
    </div>)
}