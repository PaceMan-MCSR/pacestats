'use client'

// Loaded after the OBS page renders (see ObsWrapper), which keeps
// react-colorful out of the page's first JavaScript.
import {HexColorInput, HexColorPicker} from "react-colorful";

export function ColorPicker({color, onChange}: {color: string, onChange: (color: string) => void}) {
    return <HexColorPicker color={color} onChange={onChange}/>;
}

export function ColorInput({color, onChange}: {color: string, onChange: (color: string) => void}) {
    return <HexColorInput color={color} onChange={onChange}/>;
}
