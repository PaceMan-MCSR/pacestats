import * as React from 'react';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import {formatTime} from "@/app/utils";

const marks = [
    {
        value: 60,
        label: '⠀⠀1:00',
    },
    {
        value: 75,
        label: '1:15',
    },
    {
        value: 90,
        label: '1:30',
    },
    {
        value: 105,
        label: '1:45',
    },
    {
        value: 120,
        label: '2:00⠀⠀',
    },
];

function format(value: number) {
    return formatTime(value * 1000, true)
}

export default function TimeSlider({def, setVal}: {def: number, setVal: any}) {
    return (
        <Box sx={{ width: 280, margin: "auto" }}>
            <Slider
                aria-label="Max average picker"
                defaultValue={def}
                getAriaValueText={format}
                min={60}
                max={120}
                step={1}
                valueLabelDisplay="auto"
                valueLabelFormat={format}
                marks={marks}
                onChange={(e, v) => setVal(v)}
            />
        </Box>
    );
}
