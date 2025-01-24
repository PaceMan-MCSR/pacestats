import * as React from 'react';
import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';

let marks = [
    {
        value: 0,
        label: '0',
    },

];
// generate mark
for (let i = 400; i <= 2000; i += 400) {
    marks.push({value: i, label: i.toString()});
}

export default function QtySlider({def, setVal}: {def: number, setVal: any}) {
    return (
        <Box sx={{ width: 280, margin: "auto" }}>
            <Slider
                aria-label="Min QTY picker"
                defaultValue={def}
                min={0}
                max={2000}
                step={50}
                valueLabelDisplay="auto"
                marks={marks}
                onChange={(e, v) => setVal(v)}
            />
        </Box>
    );
}
