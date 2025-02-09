'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import { formatIfNotNull } from "@/app/utils";
import { useRouter } from "next/navigation";
import {
    DataGrid,
    DataGridProps,
    GridColDef,
    GridFilterInputValueProps,
    GridFilterOperator,
    useGridApiRef
} from '@mui/x-data-grid';
import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import useDebouncedCallback from "@restart/hooks/useDebouncedCallback";
import { useMediaQuery } from "@mui/system";
import { CircularProgress, TextField } from "@mui/material";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import Box from "@mui/material/Box";
import BastionFort from "@/app/components/BastionFort";

function MinutesSecondsInputValue(props: GridFilterInputValueProps) {
    const { item, applyValue, focusElementRef } = props;

    const inputRef: React.Ref<any> = useRef(null);
    useImperativeHandle(focusElementRef, () => ({
        focus: () => {
            inputRef.current.focus();
        },
    }));

    const handleFilterChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        if (/^[\d:]*$/.test(value)) {
            applyValue({ ...item, value: value });
        }
    };

    return (
        <Box
            sx={{
                display: 'inline-flex',
                flexDirection: 'row',
                alignItems: 'center',
                height: 48,
                pl: '20px',
            }}
        >
            <TextField
                value={item.value || ''}
                onChange={handleFilterChange}
                inputRef={inputRef}
                placeholder="mm:ss"
            />
        </Box>
    );
}

const minutesSecondsOperators: GridFilterOperator<any, string>[] = [
    {
        label: 'Less than',
        value: 'lessThan',
        getApplyFilterFn: (filterItem: any) => {
            if (!filterItem.field || !filterItem.value || !filterItem.operator) {
                return null;
            }

            const parseTime = (timeString: string): number => {
                const parts = timeString.split(':');
                if (parts.length !== 2) return NaN; // Invalid format
                const minutes = parseInt(parts[0], 10);
                const seconds = parseInt(parts[1], 10);
                if (isNaN(minutes) || isNaN(seconds) || minutes < 0 || seconds < 0 || seconds >= 60) return NaN; //More validation
                return minutes * 60 + seconds;
            };

            const filterTime = parseTime(filterItem.value);
            if (isNaN(filterTime)) return null;

            return (value: any) => {
                const time = value / 1000;
                return value !== null && time < filterTime;
            };
        },
        InputComponent: MinutesSecondsInputValue,
        InputComponentProps: { type: 'string' },
        getValueAsString: (value: string) => value,
    },
    {
        label: 'Greater than',
        value: 'greaterThan',
        getApplyFilterFn: (filterItem: any) => {
            if (!filterItem.field || !filterItem.value || !filterItem.operator) {
                return null;
            }

            const parseTime = (timeString: string): number => {
                const parts = timeString.split(':');
                if (parts.length !== 2) return NaN; // Invalid format
                const minutes = parseInt(parts[0], 10);
                const seconds = parseInt(parts[1], 10);
                if (isNaN(minutes) || isNaN(seconds) || minutes < 0 || seconds < 0 || seconds >= 60) return NaN; //More validation
                return minutes * 60 + seconds;
            };

            const filterTime = parseTime(filterItem.value);
            if (isNaN(filterTime)) return null;


            return (value: any) => {
                const time = value / 1000;
                return time > filterTime;
            };
        },
        InputComponent: MinutesSecondsInputValue,
        InputComponentProps: { type: 'string' },
        getValueAsString: (value: string) => value, // Just return the string
    },
    {
        value: "isNotEmpty",
        requiresFilterValue: false,
        label: "Is not empty",
        getApplyFilterFn: () => (value: any) => value !== null,
    },
    {
        value: "isEmpty",
        requiresFilterValue: false,
        label: "Is empty",
        getApplyFilterFn: () => (value: any) => value === null,
    }
];

export default function RecentRuns({runs, bf}: { runs: {}[], bf: boolean }) {
    const [bastionFort, setBastionFort] = useState(bf)
    const ref = useGridApiRef();
    const router = useRouter()
    const rows = runs;
    const small = useMediaQuery('(max-width: 768px)');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(false);
    }, []);

    useEffect(() => {
        resize();
    }, [bastionFort])

    const sharedProps: Partial<GridColDef> = {
        type: 'custom',
        disableColumnMenu: small,
        filterOperators: minutesSecondsOperators,
        align: 'right',
        renderCell: (params) => {
            return formatIfNotNull(params.row[params.field]);
        },
    }

    const bastionFortColumns: GridColDef[] = [
        {
            field: 'bastion',
            headerName: 'Bastion',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/bastion.webp" alt="Bastion" className="icon"/>
                }
                return <span>Bastion</span>
            },
            ...sharedProps,
        },
        {
            field: 'fortress',
            headerName: 'Fortress',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/fortress.webp" alt="Fortress" className="icon"/>
                }
                return <span>Fortress</span>
            },
            ...sharedProps
        }
    ]

    const firstSecondColumns: GridColDef[] = [
        {
            field: 'first_structure',
            headerName: 'First Struct',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/bastion.webp" alt="Bastion" className="icon"/>
                }
                return <span>Struct 1</span>
            },
            ...sharedProps,
            renderCell: (params) => {
                const bastion = params.row.bastion;
                const fortress = params.row.fortress;
                if(bastion === null && fortress === null){
                    return null;
                }
                return formatIfNotNull(Math.min(bastion === null ? Infinity : bastion, fortress === null ? Infinity : fortress));
            },
        },
        {
            field: 'second_structure',
            headerName: 'Second Structure',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/fortress.webp" alt="Fortress" className="icon"/>
                }
                return <span>Struct 2</span>
            },
            ...sharedProps,
            renderCell: (params) => {
                const bastion = params.row.bastion;
                const fortress = params.row.fortress;
                if(bastion === null || fortress === null){
                    return null;
                }
                return formatIfNotNull(Math.max(bastion, fortress));
            }
        }
    ]

    const columns: GridColDef[] = [
        {
            field: 'time',
            filterable: false,
            headerName: 'Time',
            renderCell: (params) => {
                if(params.row.vodId !== null){
                    return <>
                        <span className="liveIndicator"/>
                        <RelativeTimer start={params.row.lastUpdated / 1000} small={false}/>
                    </>
                }
                return <RelativeTimer start={params.row.lastUpdated / 1000} small={false}/>
            },
            disableColumnMenu: small
        },
        {
            field: 'nether',
            headerName: 'Nether',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/nether.webp" alt="Nether" className="icon"/>
                }
                return <span>Nether</span>
            },
            ...sharedProps
        },
        bastionFort ? bastionFortColumns[0] : firstSecondColumns[0],
        bastionFort ? bastionFortColumns[1] : firstSecondColumns[1],
        {
            field: 'first_portal',
            headerName: 'First Portal',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/first_portal.webp" alt="First Portal" className="icon"/>
                }
                return <span>First Portal</span>
            },
            ...sharedProps
        },
        {
            field: 'stronghold',
            headerName: 'Stronghold',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/stronghold.webp" alt="Stronghold" className="icon"/>
                }
                return <span>Stronghold</span>
            },
            ...sharedProps
        },
        {
            field: 'end',
            headerName: 'End',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/end.webp" alt="End" className="icon"/>
                }
                return <span>End</span>
            },
            ...sharedProps
        },
        {
            field: 'finish',
            headerName: 'Finish',
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/finish.webp" alt="Finish" className="icon"/>
                }
                return <span>Finish</span>
            },
            ...sharedProps
        }
    ];

    const styles = {
        '& .MuiDataGrid-row': {
            backgroundColor: '#212529',
        },
        '& .MuiDataGrid-footerContainer': {
            borderTop: '1px solid #16161a',
        },
        '& .MuiToolbar-root': {
            color: 'rgb(230, 230, 230)',
        },
        '& .MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
            marginBottom: '0',
        },
        '& .MuiDataGrid-row--borderBottom': {
            backgroundColor: '#1d1d1d !important',
        },
        '& .MuiDataGrid-columnSeparator': {
            color: '#444455 !important',
            right: "-5.5px"
        },
        '& .MuiDataGrid-columnHeader, .MuiDataGrid-filler': {
            backgroundColor: '#181819 !important',
            borderBottom: '0 !important'
        },
        '& .MuiDataGrid-iconButtonContainer': {
            display: 'none',
        },
        '& .MuiDataGrid-cell': {
            borderRight: "0 !important",
            paddingLeft: "3px"
        },
        '& .MuiDataGrid-cell:focus': {
            outline: 'none',
        },
        '& .MuiDataGrid-columnHeader, .MuiDataGrid-cell--textLeft, .MuiDataGrid-cell--textRight': {
            borderRight: '1px solid #16161a !important',
        },
        fontFamily: 'Inter, sans-serif',
        fontWeight: 500,
        fontSize: '15px',
        color: 'rgba(230, 230, 230)',
        '& .MuiDataGrid-columnsContainer': {
            backgroundColor: '#1d1d1d',
        },
        '& .MuiDataGrid-columnsContainer, .MuiDataGrid-cell': {
            borderTop: '1px solid #16161a !important',
        },
        border: '2px solid #26262a',
        '& .MuiDataGrid-scrollbar, .MuiDataGrid-filler': {
            display: 'none'
        },
        '& .MuiDataGrid-menuIcon .MuiSvgIcon-root': {
            color: '#AAAABB',
        }
    }

    const props: Partial<DataGridProps> = {
        columnHeaderHeight: 40,
        rowHeight: 32,
        rowSelection: false,
        pageSizeOptions: [{ value: 10, label: '10' }, { value: 25, label: '25' }, { value: 50, label: '50' }, { value: 100, label: '100' }],
    }

    const actuallyResize = () => {
        ref.current?.autosizeColumns({
            includeHeaders: true,
            includeOutliers: true,
            expand: true,
        });
    }

    const resize = useDebouncedCallback(() => {
        actuallyResize()
        setTimeout(() => {
            actuallyResize()
        }, 200);
    }, 200);

    useEffect(() => {
        const resizeHandler = () => {
            resize();
        }
        const hoverHandler = (row: any) => {
            router.prefetch(`/run/${row.id}/`, {
                kind: PrefetchKind.FULL
            })
        }
        ref.current.subscribeEvent('renderedRowsIntervalChange', resizeHandler);
        ref.current.subscribeEvent('rowMouseOver', hoverHandler);
        window.addEventListener('resize', resize);
        return () => {
            window.removeEventListener('resize', resize);
        }
    }, []);

    return <div className="recentRunsFull paceHeader">
        <div className="row justify-content-center align-content-center">
            <div className="col-10 col-sm-9 col-md-6 col-lg-5 col-xl-4 col-xxl-4">
                <div className="topRow">
                    <BastionFort bastionFort={bastionFort} setBastionFort={setBastionFort}/>
                </div>
            </div>
        </div>
        <div style={{textAlign: "center"}}>
            <h6>Click on a row to view run info</h6>
        </div>
        <div className="liveDescription">
            <span className="liveIndicator"/>= Live
        </div>
        {isLoading && <div className="loading" style={{marginTop: "10px", display: "flex", justifyContent: "center"}}>
            <CircularProgress sx={{margin: "auto"}}/>
        </div>}
        <DataGrid
            columns={columns}
            rows={rows}
            apiRef={ref}
            onRowClick={(params, e) => {
                router.push("/run/" + params.row.id)
            }}
            sx={styles}
            initialState={{
                pagination: {
                    paginationModel: { pageSize: 25, page: 0 },
                },
            }}
            {...props}
        />
    </div>
}