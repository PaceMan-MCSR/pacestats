import { Button, MenuItem, TextField } from "@mui/material";
import React, { useState } from "react";
import { Collapse } from "react-bootstrap";
import Tooltip from "react-bootstrap/Tooltip";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";

const parseTime = (timeString: string): number => {
    const parts = timeString.split(':');
    if (parts.length !== 2) return NaN; // Invalid format
    const minutes = parseInt(parts[0], 10);
    const seconds = parseInt(parts[1], 10);
    if (isNaN(minutes) || isNaN(seconds) || minutes < 0 || seconds < 0 || seconds >= 60) return NaN; //More validation
    return minutes * 60 + seconds;
};

export default function RunFilters({bf, filters, setFilters}: {bf: boolean, filters: any[], setFilters: (filters: any[]) => void}) {
    const [toggled, setToggled] = useState(false);
    const sharedProps = {
        select: true,
        sx: {
            color: 'white',
            backgroundColor: 'rgb(18, 18, 21)',
            '& .MuiFormLabel-root': {
                color: 'rgb(170, 170, 180)',
            },
            '& .MuiOutlinedInput-input': {
                color: 'rgb(230, 230, 230)',
            },
            ' & .MuiPaper-root': {
                backgroundColor: 'rgb(29,29,33)',
                color: 'white',
            },
            '& .MuiSelect-select': {
                paddingY: '12px',
            },
            '& .MuiSelect-icon': {
                color: 'rgb(180, 180, 180)',
            },
            borderRadius: '3px',
            marginRight: "10px"
        },
        inputProps: {
            MenuProps: {
                PaperProps: {
                    sx: {
                        backgroundColor: '#212529',
                        color: 'rgb(230, 230, 230)',
                        border: '1px solid rgb(7,7,9)',
                    }
                }
            }
        }
    }

    const sharedInputProps = {
        sx: {
            '&:hover': {
                backgroundColor: 'rgb(60,60,70)',
            }
        }
    }

    return (
        <div className="filterGroup" style={{
            marginTop: "-5px",
            marginBottom: "30px"
        }}>
            <button
                className={"btn btn-dark filterToggle" + (toggled ? " active" : "")}
                type="button"
                onClick={() => {
                    setToggled(!toggled)
                }}
            >Filters
            </button>
            <Collapse in={toggled}>
                <div>
                    <div style={{
                        backgroundColor: "rgb(29,29,33)",
                        padding: "25px 15px 10px 15px",
                        borderRadius: "5px",
                        border: "1px solid rgb(9,9,11)",
                        textAlign: "left"
                    }}>
                        <div style={{
                            marginBottom: "10px"
                        }}>
                            <p style={{lineHeight: 0.1}}>Presets</p>
                            {
                                [
                                    {
                                        label: "Sub 2 Enter",
                                        filters: [
                                            {
                                                column: "nether",
                                                operatorValue: "lessThan",
                                                value: "2:00",
                                                inMs: 120000
                                            }
                                        ]
                                    },
                                    {
                                        label: "Sub 10",
                                        filters: [
                                            {
                                                column: "finish",
                                                operatorValue: "lessThan",
                                                value: "10:00",
                                                inMs: 600000
                                            }
                                        ]
                                    },
                                    {
                                        label: "All Completions",
                                        filters: [
                                            {
                                                column: "finish",
                                                operatorValue: "isNotEmpty",
                                                value: "",
                                                inMs: 0
                                            }
                                        ]
                                    },
                                ].map((preset) => (
                                    <Button
                                        color={"primary"}
                                        variant={"contained"}
                                        onClick={() => {
                                            setFilters(preset.filters);
                                        }}
                                        sx={{
                                            marginRight: 1
                                        }}
                                    >{preset.label}</Button>
                                ))}
                        </div>
                        <p style={{marginTop: "20px", marginBottom: "12px"}}>Filters</p>
                        {filters.map((filter, index) => (
                            <div key={index} style={{
                                marginBottom: "15px"
                            }}>
                                <TextField
                                    value={filter.column}
                                    label={"Split"}
                                    onChange={(e) => {
                                        const newFilters = [...filters];
                                        newFilters[index].column = e.target.value;
                                        setFilters(newFilters);
                                    }}
                                    {...sharedProps}
                                    sx={{
                                        ...sharedProps.sx,
                                        width: "175px"
                                    }}
                                >
                                    {[
                                        {value: "nether", label: "Nether"},
                                        bf ? {value: "bastion", label: "Bastion"} : {value: "first_structure", label: "First Structure"},
                                        bf ? {value: "fortress", label: "Fortress"} : {value: "second_structure", label: "Second Structure"},
                                        {value: "first_portal", label: "First Portal"},
                                        {value: "stronghold", label: "Stronghold"},
                                        {value: "end", label: "End Enter"},
                                        {value: "finish", label: "Finish"}
                                    ].map((option) => (
                                        <MenuItem
                                            key={option.value}
                                            value={option.value}
                                            {...sharedInputProps}
                                        >{option.label}</MenuItem>
                                    ))}
                                </TextField>
                                <TextField
                                    value={filter.operatorValue || ''}
                                    label="Operator"
                                    onChange={(e) => {
                                        const newFilters = [...filters];
                                        newFilters[index].operatorValue = e.target.value;
                                        setFilters(newFilters);
                                    }}
                                    {...sharedProps}
                                    sx={{
                                        ...sharedProps.sx,
                                        width: "100px"
                                    }}
                                >
                                    {[
                                        {value: "lessThan", label: "Under"},
                                        {value: "greaterThan", label: "Over"},
                                        {value: "isNotEmpty", label: "Exists"},
                                        {value: "isEmpty", label: "Doesn't Exist"}
                                    ].map((option) => (
                                        <MenuItem
                                            key={option.value}
                                            value={option.value}
                                            {...sharedInputProps}
                                        >{option.label}</MenuItem>
                                    ))}
                                </TextField>
                                {filter.operatorValue !== "isEmpty" && filter.operatorValue !== "isNotEmpty" && (
                                    <TextField
                                        value={filter.value || ''}
                                        label={"Time"}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            if (/^[\d:]*$/.test(value)) {
                                                const newFilters = [...filters];
                                                newFilters[index].value = value;
                                                newFilters[index].inMs = parseTime(value) * 1000;
                                                setFilters(newFilters);
                                            }
                                        }}
                                        placeholder="mm:ss"
                                        sx={{
                                            width: 80,
                                            backgroundColor: 'rgb(18, 18, 21)',
                                            '& input': {
                                                paddingY: 1.5,
                                                color: 'rgb(230, 230, 230)',
                                            },
                                            '& .MuiFormLabel-root': {
                                                color: 'rgb(170, 170, 180)',
                                            },
                                            '& .MuiOutlinedInput-input': {
                                                color: 'rgb(230, 230, 230)',
                                            },
                                            borderRadius: '3px',
                                        }}
                                    />
                                )}
                                <OverlayTrigger overlay={
                                    <Tooltip className="colorTooltip">
                                        <p className="colorHint" style={{
                                            width: "120px",
                                            padding: 5
                                        }}>Remove filter</p>
                                    </Tooltip>
                                } delay={{ show: 300, hide: 300 }}>
                                    <Button
                                        color={"error"}
                                        sx={{
                                            minWidth: "40px",
                                            maxWidth: "40px",
                                            marginLeft: "5px",
                                            marginTop: "5px"
                                        }}
                                        onClick={() => {
                                            const newFilters = [...filters];
                                            newFilters.splice(index, 1);
                                            setFilters(newFilters);
                                        }}
                                    >
                                        <span className="material-symbols-outlined">close</span>
                                    </Button>
                                </OverlayTrigger>
                            </div>
                        ))}
                        <OverlayTrigger overlay={
                            <Tooltip className="colorTooltip">
                                <p className="colorHint" style={{
                                    width: "100px",
                                    padding: 5
                                }}>Add filter</p>
                            </Tooltip>
                        } delay={{ show: 300, hide: 300 }}>
                            <Button
                                color={"primary"}
                                sx={{
                                    minWidth: "40px",
                                    maxWidth: "40px",
                                }}
                                onClick={() => {
                                    setFilters([...filters, {
                                        column: 'nether',
                                        operatorValue: 'lessThan',
                                        value: '1:30',
                                        inMs: 90000,
                                    }])
                                }}>
                                <span className="material-symbols-outlined">add</span>
                            </Button>
                        </OverlayTrigger>
                        <OverlayTrigger overlay={
                            <Tooltip className="colorTooltip">
                                <p className="colorHint" style={{
                                    width: "130px",
                                    padding: 5
                                }}>Reset all filters</p>
                            </Tooltip>
                        } delay={{ show: 300, hide: 300 }}>
                            <Button
                                color={"error"}
                                sx={{
                                    minWidth: "40px",
                                    maxWidth: "40px",
                                }}
                                onClick={() => {
                                    setFilters([])
                                }}>
                                <span className="material-symbols-outlined">delete</span>
                            </Button>
                        </OverlayTrigger>
                    </div>
                </div>
            </Collapse>
        </div>
    )
}