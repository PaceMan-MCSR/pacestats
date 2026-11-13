'use client';

// A native date input. The MUI date picker this replaced came with moment.js
// and every one of its locales: a 500 KB chunk for one field.

const pad = (value: number) => String(value).padStart(2, "0");

const toInputValue = (value: unknown): string => {
    if (value === null || value === undefined || value === "") return "";
    const date = new Date(value as string | number | Date);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export default function RunDateFilter({value, onChange}: {
    value: unknown,
    onChange: (date: Date | null) => void,
}) {
    return <label className="runDateFilter">
        <span className="runDateFilterLabel">Date</span>
        <input
            type="date"
            value={toInputValue(value)}
            onChange={(event) => {
                const [year, month, day] = event.target.value.split("-").map(Number);
                // Local midnight, like the old picker.
                onChange(event.target.value ? new Date(year, month - 1, day) : null);
            }}
        />
    </label>;
}
