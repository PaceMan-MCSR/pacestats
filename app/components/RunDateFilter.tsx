'use client';

// Loaded on demand by RunFilters: the date picker and moment.js add about
// 600 KB of JavaScript, and most visits to the runs page never filter by date.
import { DatePicker, LocalizationProvider } from "@mui/x-date-pickers";
import { AdapterMoment } from "@mui/x-date-pickers/AdapterMoment";
import moment from "moment";
import type { ComponentProps } from "react";

export default function RunDateFilter({value, onChange, sx}: {
    value: unknown,
    onChange: (date: Date | null) => void,
    sx: ComponentProps<typeof DatePicker>["sx"],
}) {
    return <LocalizationProvider dateAdapter={AdapterMoment}>
        <DatePicker
            value={value ? moment(value as moment.MomentInput) : null}
            onChange={(date) => onChange(date && date.isValid() ? date.toDate() : null)}
            label={"Date"}
            sx={sx}
        />
    </LocalizationProvider>
}
