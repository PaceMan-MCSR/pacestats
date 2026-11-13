import type {CSSProperties} from "react";
import {getDarkerColor} from "@/app/utils";

type Colours = {
    isCustom: boolean,
    fg?: string,
    bg?: string,
    name?: string,
    fgText?: {color?: string, filter?: string},
    bgText?: {color?: string, filter?: string},
};

/**
 * A player's custom colours as CSS variables, for the `cc*` rules in
 * styles/customColours.css. Put the result in `style` and add the matching
 * class from `customClass` on the same element.
 */
export function colourVars(colours: Colours | undefined): CSSProperties | undefined {
    if (!colours?.isCustom || !colours.fg) return undefined;
    const fg = colours.fg;
    return {
        "--cc-fg": `#${fg}`,
        "--cc-fg-90": `#${getDarkerColor(fg, 0.9)}`,
        "--cc-fg-80": `#${getDarkerColor(fg, 0.8)}`,
        "--cc-fg-70": `#${getDarkerColor(fg, 0.7)}`,
        "--cc-fg-60": `#${getDarkerColor(fg, 0.6)}`,
        "--cc-bg": `#${colours.bg}`,
        "--cc-name": `#${colours.name}`,
        "--cc-fg-text": colours.fgText?.color,
        "--cc-fg-text-filter": colours.fgText?.filter,
        "--cc-bg-text": colours.bgText?.color,
        "--cc-bg-text-filter": colours.bgText?.filter,
    } as CSSProperties;
}

/** `base` plus `custom` when the player has custom colours. */
export function customClass(colours: Colours | undefined, custom: string, base = ""): string | undefined {
    const value = colours?.isCustom ? `${base} ${custom}`.trim() : base;
    return value || undefined;
}
