export const MAX_OVERLAY_HOURS = 9_999_999;
export const MAX_OVERLAY_AVERAGE_DECIMALS = 3;
// Preserve every precision supported by Number.toFixed while bounding repeat().
export const MAX_OVERLAY_NPH_DECIMALS = 100;

export const overlayInteger = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
    if (value === null || value === undefined || value === "") return fallback;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, Math.trunc(numeric))) : fallback;
};
