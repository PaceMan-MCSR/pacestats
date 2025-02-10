interface QtyStats {
    min: number;
    good: number;
}

export const minQtys = new Map<number, { [days: string]: QtyStats }>([
    [1, {
        nether: {min: 5, good: 30},
        bastion: {min: 3, good: 10},
        fortress: {min: 1, good: 5},
        first_structure: {min: 3, good: 10},
        second_structure: {min: 1, good: 5},
        first_portal: {min: 1, good: 5},
        stronghold: {min: 1, good: 3},
        end: {min: 1, good: 2},
        finish: {min: 1, good: 2}
    }],
    [7, {
        nether: {min: 30, good: 80},
        bastion: {min: 5, good: 20},
        fortress: {min: 3, good: 10},
        first_structure: {min: 5, good: 20},
        second_structure: {min: 3, good: 10},
        first_portal: {min: 1, good: 5},
        stronghold: {min: 2, good: 4},
        end: {min: 1, good: 2},
        finish: {min: 1, good: 2}
    }],
    [30, {
        nether: {min: 200, good: 700},
        bastion: {min: 50, good: 80},
        fortress: {min: 5, good: 20},
        first_structure: {min: 30, good: 80},
        second_structure: {min: 5, good: 20},
        first_portal: {min: 5, good: 15},
        stronghold: {min: 3, good: 5},
        end: {min: 1, good: 2},
        finish: {min: 1, good: 2}
    }],
    [9999, {
        nether: {min: 500, good: 2000},
        bastion: {min: 50, good: 600},
        fortress: {min: 30, good: 100},
        first_structure: {min: 50, good: 600},
        second_structure: {min: 30, good: 100},
        first_portal: {min: 10, good: 60},
        stronghold: {min: 5, good: 30},
        end: {min: 4, good: 8},
        finish: {min: 3, good: 5}
    }]
])

export const minAAQtys = new Map<number, { [days: string]: QtyStats }>([
    [1, {
        nether: {min: 1, good: 1},
        end: {min: 1, good: 1},
        elytra: {min: 1, good: 1},
        credits: {min: 1, good: 1},
        finish: {min: 1, good: 1}
    }],
    [7, {
        nether: {min: 5, good: 10},
        end: {min: 3, good: 5},
        elytra: {min: 1, good: 1},
        credits: {min: 1, good: 1},
        finish: {min: 1, good: 1}
    }],
    [30, {
        nether: {min: 20, good: 50},
        end: {min: 5, good: 20},
        elytra: {min: 1, good: 5},
        credits: {min: 1, good: 5},
        finish: {min: 1, good: 3}
    }],
    [9999, {
        nether: {min: 20, good: 50},
        end: {min: 5, good: 20},
        elytra: {min: 2, good: 5},
        credits: {min: 2, good: 5},
        finish: {min: 1, good: 3}
    }]
])

export function getMinQty(category: string, days: number) {
    return minQtys.get(days)?.[category]?.min || 0;
}

export function getGoodQty(category: string, days: number) {
    return minQtys.get(days)?.[category]?.good || 0;
}

export function getMinAAQty(category: string, days: number) {
    return minAAQtys.get(days)?.[category]?.min || 0;
}

export function getGoodAAQty(category: string, days: number) {
    return minAAQtys.get(days)?.[category]?.good || 0;
}

export const getFirstStructure = (bastion: number | null, fortress: number | null) : number | null => {
    if (bastion !== null && fortress == null) {
        return bastion
    } else if (bastion == null && fortress !== null) {
        return fortress
    }
    if (bastion !== null && fortress !== null) {
        if (bastion < fortress) {
            return bastion
        } else {
            return fortress
        }
    }
    return null
}

export const getSecondStructure = (bastion: number | null, fortress: number | null) : number | null => {
    if(bastion === null || fortress === null){
        return null;
    }
    if (bastion < fortress) {
        return fortress
    } else {
        return bastion
    }
}

export const getLastSplit = (data: any, short: boolean = false) => {
    const splits = {
        nether: ["Enter Nether", "Nether"],
        bastion: ["Enter Bastion", "Bastion"],
        fortress: ["Enter Fortress", "Fortress"],
        first_portal: ["First Portal", "First Portal"],
        stronghold: ["Enter Stronghold", "Stronghold"],
        end: ["End Enter", "End"],
        finish: ["Completion", "Finish"]
    }
    let lastSplit = "nether"
    for (const split in splits) {
        if (data[split] !== null) {
            lastSplit = split
        }
    }
    if(lastSplit === "fortress" && data.bastion !== null && data.bastion > data.fortress){
        lastSplit = "bastion"
    }

    // @ts-ignore
    const name = splits[lastSplit][short ? 1 : 0]
    return {split: lastSplit, name: name, full: `${formatTime(data[lastSplit])} ${name}`}
}

export const getEventTime = (run: any, eventName: string, rta: boolean = false) => {
    const evt = run.eventList.find((e: any) => e.eventId === eventName)
    if(!evt){
        return null
    }
    return rta ? evt.rta : evt.igt
}

export enum CategoryType {
    COUNT,
    AVG,
    FASTEST,
    CONVERSION,
    COUNT_AVG
}

export function fixDisplayName(name: string){
    if(name === "COVlD19"){
        return "jojoe77777"
    }
    return name
}

export const formatTime = (ms: any, truncate: boolean = true) => {
    const formatted = new Date(Number.parseFloat(ms)).toISOString().slice(11, truncate ? 19 : 21)
    return formatted.replace(/^(?:00:)?0?/, '');
}

export const formatDecimals = (ms: any, dp: number = 0) => {
    const formatted = new Date(Number.parseFloat(ms)).toISOString().slice(14, 19 + (dp > 0 ? dp + 1 : 0))
    if (formatted.startsWith('0')) {
        return formatted.slice(1)
    }
    return formatted
}

export function formatIfNotNull(value: number | null) {
    return value !== null ? formatTime(value) : ""
}

export function formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    const minuteString = minutes > 0 ? `${minutes}m` : "";
    const secondString = remainingSeconds > 0 ? `${remainingSeconds}s` : "";

    return `${minuteString}${secondString}`;
}

export function formatVodLink(igt: number | null, rta: number | null, vodId: number, vodOffset: number) {
    if(igt === null || rta === null){
        return ""
    }
    let splitOffset = vodOffset + (rta / 1000) + 2
    let formatted = formatDuration(splitOffset)
    return <a className="vodLink" href={`https://www.twitch.tv/videos/${vodId}?t=${formatted}`} target="_blank">{formatTime(igt)}</a>
}

export function generateHexCode(value: number, min: number = 0, max: number = 100): string {
    if(min === 0){
        return "#00FF00"
    }
    if(value >= max){
        return "#00FF00"
    }

    // Clamp value to max
    value = Math.min(value, max);

    // Normalize value to 0-1 range
    let normalizedValue = (value - min) / (max - min);

    if(max <= 5) {
        // Clamp to red-orange not pure red
        normalizedValue = Math.max(0.32, normalizedValue)
    }

    // Calculate hue (0 for red, 120 for green)
    const hue = normalizedValue * 120;

    // Set saturation and lightness to ensure vibrant colors
    const saturation = 1.0;
    const lightness = 0.5;

    // Convert HSL to RGB values
    const hsl = [hue, saturation, lightness];
    // @ts-ignore
    const rgb = hslToRgb(hsl);

    // Convert RGB values to hex string
    const hex = rgbToHex(rgb);

    return hex;
}

function hslToRgb(hsl: [number, number, number]): [number, number, number] {
    const h = hsl[0];
    const s = hsl[1];
    const l = hsl[2];

    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = l - c / 2;

    let r, g, b;

    if (h >= 0 && h < 60) {
        r = c;
        g = x;
        b = 0;
    } else if (h >= 60 && h < 120) {
        r = x;
        g = c;
        b = 0;
    } else if (h >= 120 && h < 180) {
        r = 0;
        g = c;
        b = x;
    } else if (h >= 180 && h < 240) {
        r = 0;
        g = x;
        b = c;
    } else if (h >= 240 && h < 300) {
        r = x;
        g = 0;
        b = c;
    } else {
        r = c;
        g = 0;
        b = x;
    }

    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function rgbToHex(rgb: [number, number, number]): string {
    return `#${rgb.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function roundNumber(num: number, decimals: number = 2) {
    return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function numberWithCommas(x: number) {
    return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const defaultNameColor = "#e6e6e6"

export const getNameColor = (users: {
    uuid: string,
    displayName: string,
    color: string
}[], uuid: string) => {
    const user = users?.find(u => u.uuid === uuid)
    return user ? `#${user.color}` : defaultNameColor
}


export const getDisplayName = (users: {
    uuid: string,
    displayName: string,
    color: string
}[], uuid: string, fallback: string) => {
    const user = users?.find(u => u.uuid === uuid)
    return user ? user.displayName : fallback
}