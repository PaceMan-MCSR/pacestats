'use client'

// Shared controls are part of the OBS editor's first render.
import {HexColorInput, HexColorPicker} from "react-colorful";

export function ColorPicker({color, onChange}: {color: string, onChange: (color: string) => void}) {
    return <HexColorPicker color={color} onChange={onChange}/>;
}

export function ColorInput({color, onChange}: {color: string, onChange: (color: string) => void}) {
    return <HexColorInput color={color} onChange={onChange}/>;
}
