// Small replacements for the two moment.js calls the timers need. Importing
// moment for them pulled every locale into the player pages (about 300 KB).
// The wording and thresholds match moment's defaults.

const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

const plural = (count: number, one: string, many: string) => count <= 1 ? one : `${count} ${many}`;

const DAY_MS = 86_400_000;
// moment's calendar approximation: 4800 months per 146097 days.
const daysToMonths = (days: number) => days * 4_800 / 146_097;
const monthsToDays = (months: number) => months * 146_097 / 4_800;

const addMonths = (date: Date, months: number) => {
    const result = new Date(date.getTime());
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + months);
    const daysInMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, daysInMonth));
    return result;
};

/**
 * Equivalent of `moment.unix(start).fromNow()` for a time in the past. Like
 * moment, it counts whole calendar months first and measures the remainder
 * in milliseconds, so month boundaries round the same way.
 */
export const fromNow = (startSeconds: number, nowMs: number = Date.now()): string => {
    const from = new Date(Math.min(startSeconds * 1_000, nowMs));
    const to = new Date(nowMs);
    let wholeMonths = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    if (addMonths(from, wholeMonths).getTime() > to.getTime()) wholeMonths -= 1;
    const remainderMs = to.getTime() - addMonths(from, wholeMonths).getTime();

    let wholeDays = Math.floor(remainderMs / DAY_MS);
    const dayRemainderMs = remainderMs % DAY_MS;
    const monthsFromDays = Math.floor(daysToMonths(wholeDays));
    wholeMonths += monthsFromDays;
    wholeDays -= Math.ceil(monthsToDays(monthsFromDays));

    // Work in whole milliseconds so exact half-units round the way moment does.
    const totalMs = (wholeDays + Math.round(monthsToDays(wholeMonths))) * DAY_MS + dayRemainderMs;
    const exactMonths = wholeMonths + daysToMonths(wholeDays + dayRemainderMs / DAY_MS);
    const seconds = Math.round(totalMs / 1_000);
    const minutes = Math.round(totalMs / 60_000);
    const hours = Math.round(totalMs / 3_600_000);
    const days = Math.round(totalMs / DAY_MS);
    const months = Math.round(exactMonths);
    const years = Math.round(exactMonths / 12);

    let text: string;
    if (seconds <= 44) text = "a few seconds";
    else if (minutes < 45) text = plural(minutes, "a minute", "minutes");
    else if (hours < 22) text = plural(hours, "an hour", "hours");
    else if (days < 26) text = plural(days, "a day", "days");
    else if (months < 11) text = plural(months, "a month", "months");
    else text = plural(years, "a year", "years");
    return `${text} ago`;
};

const ordinal = (day: number) => {
    const lastTwo = day % 100;
    if (lastTwo >= 11 && lastTwo <= 13) return `${day}th`;
    switch (day % 10) {
        case 1: return `${day}st`;
        case 2: return `${day}nd`;
        case 3: return `${day}rd`;
        default: return `${day}th`;
    }
};

const twoDigits = (value: number) => String(value).padStart(2, "0");

/** Equivalent of `moment.unix(start).format("MMMM Do YYYY, h:mm:ss a")`. */
export const formatExactTime = (startSeconds: number): string => {
    const date = new Date(startSeconds * 1_000);
    const hours = date.getHours();
    return `${MONTH_NAMES[date.getMonth()]} ${ordinal(date.getDate())} ${date.getFullYear()}, `
        + `${hours % 12 || 12}:${twoDigits(date.getMinutes())}:${twoDigits(date.getSeconds())} `
        + (hours < 12 ? "am" : "pm");
};
