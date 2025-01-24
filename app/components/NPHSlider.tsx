import * as React from 'react';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';

const marks = [
    {
        value: 1,
        label: '1',
    },
    {
        value: 4,
        label: '4',
    },
    {
        value: 8,
        label: '8',
    },
    {
        value: 12,
        label: '12',
    },
    {
        value: 16,
        label: '16',
    },
];

export default function NPHSlider({def, setVal}: {def: number, setVal: any}) {
    return (
        <Box sx={{ width: 280, margin: "auto" }}>
            <Slider
                aria-label="Min NPH picker"
                defaultValue={def}
                min={1}
                max={16}
                step={1}
                valueLabelDisplay="auto"
                marks={marks}
                onChange={(e, v) => setVal(v)}
            />
        </Box>
    );
}
