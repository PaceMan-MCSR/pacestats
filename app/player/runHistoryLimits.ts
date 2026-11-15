/** Shared by the history controls, server page and public API. */
export const RUN_HISTORY_MAX_PAGE = 1_000_000;
export const RUN_HISTORY_PAGE_SIZES: readonly number[] = [10, 25, 50, 100];
export const RUN_HISTORY_MAX_FILTERS = 10;

export type RunHistoryPaginationModel = {page: number; pageSize: number};

export const normalizeRunHistoryPagination = ({page, pageSize}: RunHistoryPaginationModel): RunHistoryPaginationModel => ({
    page: Number.isSafeInteger(page) && page >= 0 && page <= RUN_HISTORY_MAX_PAGE ? page : 0,
    pageSize: RUN_HISTORY_PAGE_SIZES.includes(pageSize) ? pageSize : 25,
});

export const lastRunHistoryPage = (count: number, pageSize: number) =>
    Math.min(RUN_HISTORY_MAX_PAGE, Math.max(0, Math.ceil(count / pageSize) - 1));
