'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import { formatIfNotNull } from "@/app/utils";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
    DataGrid,
    DataGridProps,
    GridColDef,
    useGridApiRef,
    GridPaginationModel, GridRowProps, GridRow
} from '@mui/x-data-grid';
import React, { useEffect, useState } from "react";
import useDebouncedCallback from "@restart/hooks/useDebouncedCallback";
import { useMediaQuery } from "@mui/system";
import { CircularProgress } from "@mui/material";
import BastionFort from "@/app/components/BastionFort";
import RunFilters from "@/app/components/RunFilters";
import moment from 'moment';
import Link from "next/link";

export default function RecentRuns({runs, bf}: { runs: any, bf: boolean }) {

    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [paginationModel, setPaginationModel] = useState<GridPaginationModel>(() => {
        return {
            page: Number(searchParams.get('page') ?? '0'),
            pageSize: Number(searchParams.get('pageSize') ?? '25'),
        };
    });

    const updateUrl = useDebouncedCallback((model: GridPaginationModel) => {
        const currentParams = new URLSearchParams(Array.from(searchParams.entries()));
        currentParams.set('page', String(model.page));
        currentParams.set('pageSize', String(model.pageSize));
        router.replace(`${pathname}?${currentParams.toString()}`, {scroll: false});
    }, 20); // 300ms debounce delay

    useEffect(() => {
        if (paginationModel.page !== Number(searchParams.get('page') ?? '0') ||
            paginationModel.pageSize !== Number(searchParams.get('pageSize') ?? '25')) {
            updateUrl(paginationModel);
        }
    }, [paginationModel, searchParams, updateUrl]);

    const handlePaginationModelChange = (newModel: GridPaginationModel) => {
        setPaginationModel(newModel);
    };

    const [filters, setFilters] = useState([] as {
        column: string,
        operatorValue: string,
        value: string,
        inMs: number,
    }[])
    const [bastionFort, setBastionFort] = useState(bf)
    const ref = useGridApiRef();

    const rows = runs.filter((run: any) => {
        for (const filter of filters) {
            if (filter.column === 'date') {
                // @ts-ignore
                let date = run.lastUpdated
                if (typeof date === 'string') {
                    date = new Date(date);
                }
                const filterDate = new Date(filter.value);
                if (filter.operatorValue === 'before' && date > filterDate) {
                    return false;
                }
                if (filter.operatorValue === 'after' && date < filterDate) {
                    return false;
                }
                if (filter.operatorValue === 'during' && moment(date).toDate().toDateString() !== moment(filterDate).toDate().toDateString()) {
                    return false;
                }
                continue;
            }
            if (!run.hasOwnProperty(filter.column)) {
                return false;
            }
            // @ts-ignore
            const time = run[filter.column];
            const filterTime = filter.inMs;
            if (filter.operatorValue === 'lessThan' && (time == null || time >= filterTime)) {
                return false;
            }
            if (filter.operatorValue === 'greaterThan' && time <= filterTime) {
                return false;
            }
            if (filter.operatorValue === 'isNotEmpty' && time == null) {
                return false;
            }
            if (filter.operatorValue === 'isEmpty' && time != null) {
                return false;
            }
        }
        return true;
    }).map((run: any) => {
        return {
            ...run,
            lastUpdated: typeof run.lastUpdated === 'string' ? new Date(run.lastUpdated) : run.lastUpdated,
        }
    });

    const small = useMediaQuery('(max-width: 768px)');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(false);
    }, []);

    useEffect(() => {
        actuallyResize()
    }, [bastionFort, filters])

    const sharedProps: Partial<GridColDef> = {
        type: 'custom',
        disableColumnMenu: small,
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
                if (small) {
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
                if (small) {
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
                if (small) {
                    return <img src="/stats/struct1.png" alt="Structure 1" className="icon"/>
                }
                return <span>Struct 1</span>
            },
            ...sharedProps,
            renderCell: (params) => {
                const bastion = params.row.bastion;
                const fortress = params.row.fortress;
                if (bastion === null && fortress === null) {
                    return null;
                }
                return formatIfNotNull(Math.min(bastion === null ? Infinity : bastion, fortress === null ? Infinity : fortress));
            },
        },
        {
            field: 'second_structure',
            headerName: 'Second Structure',
            renderHeader: (params) => {
                if (small) {
                    return <img src="/stats/struct2.png" alt="Structure 2" className="icon"/>
                }
                return <span>Struct 2</span>
            },
            ...sharedProps,
            renderCell: (params) => {
                const bastion = params.row.bastion;
                const fortress = params.row.fortress;
                if (bastion === null || fortress === null) {
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
            headerName: 'Date',
            minWidth: 130,
            renderCell: (params) => {
                if (params.row.twitch !== null) {
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
                if (small) {
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
                if (small) {
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
                if (small) {
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
                if (small) {
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
                if (small) {
                    return <img src="/stats/finish.webp" alt="Finish" className="icon"/>
                }
                return <span>Finish</span>
            },
            ...sharedProps
        }
    ];

    const styles = {
        backgroundColor: "#181819",
        '& .MuiDataGrid-row': {
            backgroundColor: '#212529',
            cursor: 'pointer',
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
            paddingLeft: "3px",
            color: "white !important",
            textDecoration: "none !important",
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
        },
        '& .MuiDataGrid-columnHeaderTitleContainerContent span': {
            userSelect: 'none',
        },
        '& .MuiDataGrid-row:hover': {
            backgroundColor: '#181819',
        },
    }

    const props: Partial<DataGridProps> = {
        columnHeaderHeight: 40,
        rowHeight: 32,
        rowSelection: false,
        pageSizeOptions: [{value: 10, label: '10'}, {value: 25, label: '25'}, {value: 50, label: '50'}, {
            value: 100,
            label: '100'
        }],
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
        const api = ref.current;
        if (!api) {
            return;
        }

        const resizeHandler = () => {
            resize();
        };
        // @ts-ignore
        const unsubscribe = api.subscribeEvent('renderedRowsIntervalChange', resizeHandler);
        window.addEventListener('resize', resize);

        return () => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
            window.removeEventListener('resize', resize);
        };
    }, [ref, resize]);


    return <div className="recentRunsFull paceHeader">
        <div className="row justify-content-center align-content-center">
            <div className="col-10 col-sm-9 col-md-6 col-lg-12 col-xl-12 col-xxl-12">
                <div className="topRow">
                    <BastionFort bastionFort={bastionFort} setBastionFort={setBastionFort}/>
                </div>
            </div>
        </div>
        <div className="row justify-content-center align-content-center">
            <div className="col-12">
                <RunFilters bf={bastionFort} filters={filters} setFilters={setFilters}/>
            </div>
        </div>
        <div className="liveDescription" style={{
            marginBottom: "-14px"
        }}>
            <span className="liveIndicator"/>= Live
        </div>
        {isLoading && <div className="loading" style={{marginTop: "10px", display: "flex", justifyContent: "center"}}>
            <CircularProgress sx={{margin: "auto"}}/>
        </div>}
        <div style={{textAlign: "right", marginRight: "2px"}}>
            <p style={{lineHeight: 0}}>{rows.length} results</p>
        </div>
        <DataGrid
            columns={columns}
            rows={rows}
            apiRef={ref}
            onRowClick={(params) => {
                router.push("/run/" + params.row.id)
            }}
            disableColumnFilter={true}
            sx={styles}
            paginationModel={paginationModel}
            onPaginationModelChange={handlePaginationModelChange}
            slots={{
                row: CustomRow
            }}
            {...props}
        />
    </div>
}

const CustomRow = React.forwardRef<HTMLDivElement, GridRowProps>((props, ref) => {
    const router = useRouter();
    return (
        <Link
            href={`/run/${props.row.id}`}
            style={{
                textDecoration: 'none',
            }}
            prefetch={false}
        >
            <GridRow
                ref={ref}
                {...props}
                onMouseDownCapture={(event) => {
                    if (event.button !== 0) {
                        return;
                    }
                    event.preventDefault();
                    if (event.currentTarget.dataset.id) {
                        router.push("/run/" + event.currentTarget.dataset.id);
                    }
                }}
                onMouseEnter={(event) => {
                    if (event.currentTarget.dataset.id) {
                        router.prefetch("/run/" + event.currentTarget.dataset.id);
                    }
                }}
            />
        </Link>
    );
});
CustomRow.displayName = 'CustomRow';