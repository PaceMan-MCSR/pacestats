'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import { formatIfNotNull } from "@/app/utils";
import { useRouter } from "next/navigation";
import { DataGrid, DataGridProps, GridColDef, useGridApiRef } from '@mui/x-data-grid';
import { useEffect, useState } from "react";
import useDebouncedCallback from "@restart/hooks/useDebouncedCallback";
import { useMediaQuery } from "@mui/system";
import { CircularProgress } from "@mui/material";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";

export default function RecentRuns({runs}: { runs: {}[] }) {
    const ref = useGridApiRef();
    const router = useRouter()
    const rows = runs;
    const small = useMediaQuery('(max-width: 768px)');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        setIsLoading(false);
    }, []);

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
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.nether);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/nether.webp" alt="Nether" className="icon"/>
                }
                return <span>Nether</span>
            },
            disableColumnMenu: small
        },
        {
            field: 'bastion',
            headerName: 'Bastion',
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.bastion);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/bastion.webp" alt="Bastion" className="icon"/>
                }
                return <span>Bastion</span>
            },
            disableColumnMenu: small
        },
        {
            field: 'fortress',
            headerName: 'Fortress',
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.fortress);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/fortress.webp" alt="Fortress" className="icon"/>
                }
                return <span>Fortress</span>
            },
            disableColumnMenu: small
        },
        {
            field: 'first_portal',
            headerName: 'First Portal',
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.first_portal);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/first_portal.webp" alt="First Portal" className="icon"/>
                }
                return <span>First Portal</span>
            },
            disableColumnMenu: small
        },
        {
            field: 'stronghold',
            headerName: 'Stronghold',
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.stronghold);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/stronghold.webp" alt="Stronghold" className="icon"/>
                }
                return <span>Stronghold</span>
            },
            disableColumnMenu: small
        },
        {
            field: 'end',
            headerName: 'End',
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.end);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/end.webp" alt="End" className="icon"/>
                }
                return <span>End</span>
            },
            disableColumnMenu: small
        },
        {
            field: 'finish',
            headerName: 'Finish',
            type: 'number',
            renderCell: (params) => {
                return formatIfNotNull(params.row.finish);
            },
            renderHeader: (params) => {
                if(small){
                    return <img src="/stats/finish.webp" alt="Finish" className="icon"/>
                }
                return <span>Finish</span>
            },
            disableColumnMenu: small
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
                    paginationModel: { pageSize: 10, page: 0 },
                },
            }}
            {...props}
        />
    </div>
}