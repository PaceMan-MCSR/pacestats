'use client'

import RelativeTimer from "@/app/components/profile/RelativeTimer";
import { formatIfNotNull } from "@/app/utils";
import { useRouter } from "next/navigation";
import type {GridPaginationModel} from '@mui/x-data-grid';
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@mui/system";
import BastionFort from "@/app/components/BastionFort";
import RunFilters from "@/app/components/RunFilters";
import {formatExactTime, fromNow} from "@/app/components/profile/relativeTime";
import Link from "next/link";
import {IconButton, LinearProgress, TablePagination} from "@mui/material";

type RunFilter = {
    column: string;
    operatorValue: string;
    value: any;
    inMs: number;
};

type RunSort = {
    column: string;
    direction: 'asc' | 'desc';
};

type RunsPage = {
    rows: any[];
    rowCount: number;
    fetchedAt: number;
};

const PAGE_CACHE_TTL_MS = 30_000;
const MAX_CACHED_PAGES = 12;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

function FastPaginationActions({count, page, rowsPerPage, onPageChange, getItemAriaLabel}: any) {
    const lastPage = Math.max(0, Math.ceil(count / rowsPerPage) - 1);
    const changePage = (event: React.PointerEvent<HTMLButtonElement>, targetPage: number) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        onPageChange(event, targetPage);
    };

    return <div className="fastRunsPaginationActions">
        <IconButton
            aria-label={getItemAriaLabel('previous')}
            disabled={page === 0}
            onPointerDown={(event) => changePage(event, page - 1)}
            onClick={(event) => {
                if (event.detail === 0) onPageChange(event, page - 1);
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPageChange(event, page - 1);
                }
            }}
        >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
            </svg>
        </IconButton>
        <IconButton
            aria-label={getItemAriaLabel('next')}
            disabled={page >= lastPage}
            onPointerDown={(event) => changePage(event, page + 1)}
            onClick={(event) => {
                if (event.detail === 0) onPageChange(event, page + 1);
            }}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onPageChange(event, page + 1);
                }
            }}
        >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
            </svg>
        </IconButton>
    </div>;
}
const RUN_TIME_FIELDS = [
    'nether', 'bastion', 'fortress', 'first_structure', 'second_structure',
    'first_portal', 'stronghold', 'end', 'finish',
] as const;

const prepareRunForDisplay = (run: any, gridIndex: number) => {
    const lastUpdated = typeof run.lastUpdated === 'string' ? new Date(run.lastUpdated) : run.lastUpdated;
    const start = Number(lastUpdated) / 1000;
    return {
        ...run,
        _gridId: gridIndex,
        lastUpdated,
        _relativeDate: fromNow(start)
            .replace("minutes", "mins")
            .replace("seconds", "secs"),
        _dateTitle: formatExactTime(start),
        _formattedTimes: Object.fromEntries(
            RUN_TIME_FIELDS.map((field) => [field, formatIfNotNull(run[field])])
        ),
    };
};

export default function RecentRuns({uuid, bf, initialPaginationModel, initialSort}: {
    uuid: string,
    bf: boolean,
    initialPaginationModel: GridPaginationModel,
    initialSort: RunSort,
}) {

    const router = useRouter();
    const [paginationModel, setPaginationModel] = useState<GridPaginationModel>(initialPaginationModel);

    useEffect(() => {
        const updateUrl = () => {
            const currentParams = new URLSearchParams(window.location.search);
            if (paginationModel.page !== Number(currentParams.get('page') ?? '0') ||
                paginationModel.pageSize !== Number(currentParams.get('pageSize') ?? '25')) {
                currentParams.set('page', String(paginationModel.page));
                currentParams.set('pageSize', String(paginationModel.pageSize));
                window.history.replaceState({}, '', `?${currentParams.toString()}`)
            }
        };
        if ('requestIdleCallback' in window) {
            const idleId = window.requestIdleCallback(updateUrl, {timeout: 1_000});
            return () => window.cancelIdleCallback(idleId);
        }
        const timeoutId = setTimeout(updateUrl, 0);
        return () => clearTimeout(timeoutId);
    }, [paginationModel]);

    const [filters, setFilters] = useState<RunFilter[]>([])
    const [sort, setSort] = useState<RunSort>(initialSort);
    const [rows, setRows] = useState<any[]>([]);
    const [rowCount, setRowCount] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [bastionFort, setBastionFort] = useState(bf)
    const pageCache = useRef(new Map<string, RunsPage>());
    const pendingPages = useRef(new Map<string, Promise<RunsPage>>());

    const serializedFilters = JSON.stringify(filters.flatMap((filter) => {
        if (filter.column === 'date') {
            if (filter.value === null || filter.value === undefined || filter.value === '') return [];
            const date = new Date(filter.value);
            if (Number.isNaN(date.getTime())) return [];
            if (filter.operatorValue === 'during') {
                return [{
                    column: filter.column,
                    operatorValue: filter.operatorValue,
                    value: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
                    endValue: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime(),
                }];
            }
            return [{column: filter.column, operatorValue: filter.operatorValue, value: date.valueOf()}];
        }
        if (["lessThan", "greaterThan"].includes(filter.operatorValue) && !Number.isFinite(filter.inMs)) return [];
        return [{
            column: filter.column,
            operatorValue: filter.operatorValue,
            ...(["isNotEmpty", "isEmpty"].includes(filter.operatorValue) ? {} : {value: filter.inMs}),
        }];
    }));

    const serializedSort = `${sort.column}:${sort.direction}`;

    const pageKey = useCallback((page: number, pageSize: number, pageFilters: string, pageSort: string) =>
        `${uuid}:${pageSize}:${page}:${pageFilters}:${pageSort}`, [uuid]);

    const cachedPage = useCallback((key: string) => {
        const cached = pageCache.current.get(key);
        if (!cached) return null;
        if (Date.now() - cached.fetchedAt > PAGE_CACHE_TTL_MS) {
            pageCache.current.delete(key);
            return null;
        }
        // Refresh insertion order so the map also acts as a small LRU cache.
        pageCache.current.delete(key);
        pageCache.current.set(key, cached);
        return cached;
    }, []);

    const loadPage = useCallback((page: number, pageSize: number, pageFilters: string, pageSort: RunSort) => {
        const serializedPageSort = `${pageSort.column}:${pageSort.direction}`;
        const key = pageKey(page, pageSize, pageFilters, serializedPageSort);
        const cached = cachedPage(key);
        if (cached) return Promise.resolve(cached);

        const pending = pendingPages.current.get(key);
        if (pending) return pending;

        const params = new URLSearchParams({
            uuid,
            page: String(page),
            pageSize: String(pageSize),
            filters: pageFilters,
            sort: pageSort.column,
            direction: pageSort.direction,
        });
        const request = fetch(`/stats/api/getPlayerRuns/?${params}`)
            .then(async (response) => {
                if (!response.ok) throw new Error(`Run history request failed with ${response.status}`);
                const result = await response.json();
                const loadedPage: RunsPage = {
                    rows: result.rows.map(prepareRunForDisplay),
                    rowCount: result.rowCount,
                    fetchedAt: Date.now(),
                };
                pageCache.current.set(key, loadedPage);
                while (pageCache.current.size > MAX_CACHED_PAGES) {
                    const oldestKey = pageCache.current.keys().next().value;
                    if (oldestKey === undefined) break;
                    pageCache.current.delete(oldestKey);
                }
                return loadedPage;
            })
            .finally(() => pendingPages.current.delete(key));
        pendingPages.current.set(key, request);
        return request;
    }, [cachedPage, pageKey, uuid]);

    const handlePaginationModelChange = useCallback((newModel: GridPaginationModel) => {
        if (newModel.page === paginationModel.page && newModel.pageSize === paginationModel.pageSize) return;

        const cached = cachedPage(pageKey(newModel.page, newModel.pageSize, serializedFilters, serializedSort));
        if (cached) {
            // Apply cached rows in the same React batch as the page model.
            setRows(cached.rows);
            setRowCount(cached.rowCount);
            setIsLoading(false);
        } else {
            setIsLoading(true);
        }
        setPaginationModel(newModel);
    }, [cachedPage, pageKey, paginationModel, serializedFilters, serializedSort]);

    useEffect(() => {
        let active = true;
        const {page, pageSize} = paginationModel;
        loadPage(page, pageSize, serializedFilters, sort)
            .then((loadedPage) => {
                if (!active) return;
                setRows(loadedPage.rows);
                setRowCount(loadedPage.rowCount);
                setIsLoading(false);

                if ((page + 1) * pageSize < loadedPage.rowCount) {
                    void loadPage(page + 1, pageSize, serializedFilters, sort).catch(() => {
                        // Prefetch failures are retried normally if the user visits the page.
                    });
                }
            })
            .catch((error) => {
                if (!active) return;
                console.error(error);
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [loadPage, paginationModel, serializedFilters, sort]);

    useEffect(() => {
        const currentParams = new URLSearchParams(window.location.search);
        currentParams.set('sort', sort.column);
        currentParams.set('direction', sort.direction);
        window.history.replaceState({}, '', `?${currentParams.toString()}`);
    }, [sort]);

    const changeSort = useCallback((column: string) => {
        setIsLoading(true);
        setPaginationModel((current) => current.page === 0 ? current : {...current, page: 0});
        setSort((current) => current.column === column
            ? {...current, direction: current.direction === 'asc' ? 'desc' : 'asc'}
            : {column, direction: column === 'date' ? 'desc' : 'asc'});
    }, []);

    const changeBastionFort = useCallback((nextBastionFort: boolean) => {
        setBastionFort(nextBastionFort);
        const hiddenColumns = nextBastionFort
            ? ['first_structure', 'second_structure']
            : ['bastion', 'fortress'];
        if (!hiddenColumns.includes(sort.column)) return;
        setIsLoading(true);
        setPaginationModel((current) => current.page === 0 ? current : {...current, page: 0});
        setSort({column: 'date', direction: 'desc'});
    }, [sort.column]);

    const small = useMediaQuery('(max-width: 768px)');
    const fastColumns = React.useMemo(() => [
        {field: 'date', label: 'Date', icon: null},
        {field: 'nether', label: 'Nether', icon: '/stats/nether.webp'},
        bastionFort
            ? {field: 'bastion', label: 'Bastion', icon: '/stats/bastion.webp'}
            : {field: 'first_structure', label: 'Struct 1', icon: '/stats/struct1.png'},
        bastionFort
            ? {field: 'fortress', label: 'Fortress', icon: '/stats/fortress.webp'}
            : {field: 'second_structure', label: 'Struct 2', icon: '/stats/struct2.png'},
        {field: 'first_portal', label: 'First Portal', icon: '/stats/first_portal.webp'},
        {field: 'stronghold', label: 'Stronghold', icon: '/stats/stronghold.webp'},
        {field: 'end', label: 'End', icon: '/stats/end.webp'},
        {field: 'finish', label: 'Finish', icon: '/stats/finish.webp'},
    ], [bastionFort]);


    return <div className="recentRunsFull paceHeader">
        <div className="row justify-content-center align-content-center">
            <div className="col-10 col-sm-9 col-md-6 col-lg-12 col-xl-12 col-xxl-12">
                <div className="topRow">
                    <BastionFort bastionFort={bastionFort} setBastionFort={changeBastionFort}/>
                </div>
            </div>
        </div>
        <div className="row justify-content-center align-content-center">
            <div className="col-12">
                <RunFilters bf={bastionFort} filters={filters} setFilters={(newFilters) => {
                    setFilters(newFilters);
                    setIsLoading(true);
                    setPaginationModel((current) => current.page === 0 ? current : {...current, page: 0});
                }}/>
            </div>
        </div>
        <div className="liveDescription" style={{
            marginBottom: "-14px"
        }}>
            <span className="liveIndicator"/>= Live
        </div>
        <div style={{textAlign: "right", marginRight: "2px"}}>
            <p style={{lineHeight: 0}}>{rowCount} results</p>
        </div>
        <div style={{height: "3px"}}>
            {isLoading && rows.length > 0 && <LinearProgress aria-label="Loading run history"/>}
        </div>
        <div className="fastRunsGrid" role="grid" aria-busy={isLoading}>
            <div className="fastRunsGridHeader" role="row">
                {fastColumns.map((column) => (
                    <div
                        className="fastRunsGridCell"
                        role="columnheader"
                        aria-sort={sort.column === column.field
                            ? (sort.direction === 'asc' ? 'ascending' : 'descending')
                            : 'none'}
                        key={column.field}
                    >
                        <button
                            type="button"
                            className="fastRunsSortButton"
                            aria-label={`Sort by ${column.label}${sort.column === column.field
                                ? `, currently ${sort.direction === 'asc' ? 'ascending' : 'descending'}`
                                : ''}`}
                            onClick={() => changeSort(column.field)}
                        >
                            {small && column.icon
                                ? <img src={column.icon} alt={column.label} className="icon"/>
                                : <span>{column.label}</span>}
                            <span
                                className={`fastRunsSortIndicator${sort.column === column.field ? ' active' : ''}`}
                                aria-hidden="true"
                            >{sort.column === column.field && sort.direction === 'desc' ? '▼' : '▲'}</span>
                        </button>
                    </div>
                ))}
            </div>
            <div role="rowgroup">
                {rows.map((run) => (
                    <Link
                        className="fastRunsGridRow"
                        role="row"
                        href={`/run/${run.id}`}
                        prefetch={false}
                        key={run._gridId}
                        onMouseEnter={() => router.prefetch(`/run/${run.id}`)}
                    >
                        {fastColumns.map((column) => {
                            if (column.field === 'date') {
                                const start = Number(run.lastUpdated) / 1000;
                                return <div className="fastRunsGridCell fastRunsGridDate" role="gridcell" key={column.field}>
                                    {run.twitch !== null && <span className="liveIndicator"/>}
                                    {Date.now() / 1000 - start < 60
                                        ? <RelativeTimer start={start}/>
                                        : <span title={run._dateTitle}>{run._relativeDate}</span>}
                                </div>;
                            }
                            return <div className="fastRunsGridCell" role="gridcell" key={column.field}>
                                {run._formattedTimes[column.field]}
                            </div>;
                        })}
                    </Link>
                ))}
                {!isLoading && rows.length === 0 && <div className="fastRunsGridEmpty">No rows</div>}
            </div>
            <TablePagination
                component="div"
                className="fastRunsGridPagination"
                count={rowCount}
                page={paginationModel.page}
                rowsPerPage={paginationModel.pageSize}
                rowsPerPageOptions={PAGE_SIZE_OPTIONS}
                ActionsComponent={FastPaginationActions}
                onPageChange={(_, page) => handlePaginationModelChange({...paginationModel, page})}
                onRowsPerPageChange={(event) => handlePaginationModelChange({
                    page: 0,
                    pageSize: Number(event.target.value),
                })}
            />
        </div>
    </div>
}
