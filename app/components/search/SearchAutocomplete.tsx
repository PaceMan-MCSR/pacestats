'use client';

/*
 * In-repo port of react-search-autocomplete 8.5.2
 * (https://github.com/sickdyd/react-search-autocomplete), which only declares
 * support for React <= 18. Behaviour and markup match the package; the
 * styled-components theme became plain CSS in searchAutocomplete.css.
 *
 * MIT License
 *
 * Copyright (c) 2019 Reale Roberto Josef Antonio
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import Fuse from "fuse.js";
import {
    ChangeEvent,
    FocusEvent,
    FocusEventHandler,
    KeyboardEvent,
    MouseEvent,
    ReactNode,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import "./searchAutocomplete.css";

export const DEFAULT_INPUT_DEBOUNCE = 200;
export const MAX_RESULTS = 10;

const defaultFuseOptions = {
    shouldSort: true,
    threshold: 0.6,
    location: 0,
    distance: 100,
    minMatchCharLength: 1,
    keys: ["name"],
};

type Item = Record<string, any>;
type SearchStringEvent = ChangeEvent<HTMLInputElement> | { target: { value: string } };
type HighlightRequest = { index?: number; event?: KeyboardEvent<HTMLInputElement> };

export interface SearchAutocompleteProps<T extends Item> {
    items: T[];
    fuseOptions?: Fuse.IFuseOptions<T>;
    inputDebounce?: number;
    onSearch?: (keyword: string, results: T[]) => void;
    onHover?: (result: T) => void;
    onSelect?: (result: T) => void;
    onFocus?: FocusEventHandler<HTMLInputElement>;
    onClear?: () => void;
    showIcon?: boolean;
    showClear?: boolean;
    maxResults?: number;
    placeholder?: string;
    autoFocus?: boolean;
    resultStringKeyName?: string;
    inputSearchString?: string;
    formatResult?: (item: T) => ReactNode;
    showNoResults?: boolean;
    showNoResultsText?: string;
    showItemsOnFocus?: boolean;
    maxLength?: number;
    className?: string;
}

function debounce<A extends unknown[]>(func: (...args: A) => void, wait: number) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return (...args: A) => {
        if (timeout) clearTimeout(timeout);
        timeout = setTimeout(() => {
            timeout = null;
            func(...args);
        }, wait);
    };
}

function SearchIcon({ showIcon }: { showIcon: boolean }) {
    if (!showIcon) return null;
    return (
        <svg
            className="rsa-search-icon search-icon"
            width={20}
            height={20}
            focusable="false"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
        >
            <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
    );
}

function ClearIcon({ showClear, searchString, setSearchString, setFocus, onClear }: {
    showClear: boolean;
    searchString: string;
    setSearchString: (event: SearchStringEvent) => void;
    setFocus: () => void;
    onClear: () => void;
}) {
    if (!showClear || !searchString || searchString.length <= 0) return null;

    const handleClearSearchString = () => {
        setSearchString({ target: { value: "" } });
        setFocus();
        onClear();
    };

    return (
        <div className="rsa-clear-icon clear-icon" onClick={handleClearSearchString}>
            <svg width={20} height={20} focusable="false" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.58 12 5 17.58 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
        </div>
    );
}

function SearchInput({
    searchString,
    setSearchString,
    setHighlightedItem,
    eraseResults,
    autoFocus,
    onFocus,
    onClear,
    placeholder,
    showIcon,
    showClear,
    maxLength,
}: {
    searchString: string;
    setSearchString: (event: SearchStringEvent) => void;
    setHighlightedItem: (request: HighlightRequest) => void;
    eraseResults: () => void;
    autoFocus: boolean;
    onFocus: FocusEventHandler<HTMLInputElement>;
    onClear: () => void;
    placeholder: string;
    showIcon: boolean;
    showClear: boolean;
    maxLength: number;
}) {
    const ref = useRef<HTMLInputElement>(null);
    // Refocusing after a clear must not report a second, user-initiated focus.
    const manualFocus = useRef(true);

    const setFocus = () => {
        manualFocus.current = false;
        ref.current?.focus();
        manualFocus.current = true;
    };

    const handleOnFocus = (event: FocusEvent<HTMLInputElement>) => {
        if (manualFocus.current) onFocus(event);
    };

    return (
        <div className="rsa-input">
            <SearchIcon showIcon={showIcon} />
            <input
                type="text"
                ref={ref}
                spellCheck={false}
                value={searchString}
                onChange={setSearchString}
                onFocus={handleOnFocus}
                placeholder={placeholder}
                autoFocus={autoFocus}
                onBlur={() => eraseResults()}
                onKeyDown={(event) => setHighlightedItem({ event })}
                data-test="search-input"
                {...(maxLength ? { maxLength } : {})}
            />
            <ClearIcon
                showClear={showClear}
                setSearchString={setSearchString}
                searchString={searchString}
                onClear={onClear}
                setFocus={setFocus}
            />
        </div>
    );
}

function ResultsWrapper({ children }: { children: ReactNode }) {
    return (
        <div className="rsa-results">
            <div className="line" />
            <ul>{children}</ul>
        </div>
    );
}

function Results<T extends Item>({
    results,
    onClick,
    setSearchString,
    showIcon,
    maxResults,
    resultStringKeyName,
    highlightedItem,
    setHighlightedItem,
    formatResult,
    showNoResultsFlag,
    showNoResultsText,
}: {
    results: T[];
    onClick: (result: T) => void;
    setSearchString: (value: string) => void;
    showIcon: boolean;
    maxResults: number;
    resultStringKeyName: string;
    highlightedItem: number;
    setHighlightedItem: (request: HighlightRequest) => void;
    formatResult?: (item: T) => ReactNode;
    showNoResultsFlag: boolean;
    showNoResultsText: string;
}) {
    const formatResultWithKey = formatResult ?? ((item: T) => item[resultStringKeyName]);

    const handleClick = (result: T) => {
        onClick(result);
        setSearchString(result[resultStringKeyName]);
    };

    const handleMouseDown = (event: MouseEvent<HTMLLIElement>, result: T) => {
        if (event.button === 0) {
            event.preventDefault();
            handleClick(result);
        }
    };

    if (showNoResultsFlag) {
        return (
            <ResultsWrapper>
                <li data-test="no-results-message">
                    <SearchIcon showIcon={showIcon} />
                    <div className="ellipsis">{showNoResultsText}</div>
                </li>
            </ResultsWrapper>
        );
    }

    if (results.length <= 0) return null;

    return (
        <ResultsWrapper>
            {results.slice(0, maxResults).map((result, index) => (
                <li
                    className={highlightedItem === index ? "selected" : ""}
                    onMouseEnter={() => setHighlightedItem({ index })}
                    data-test="result"
                    key={`rsa-result-${result.id}`}
                    onMouseDown={(event) => handleMouseDown(event, result)}
                    onClick={() => handleClick(result)}
                >
                    <SearchIcon showIcon={showIcon} />
                    <div className="ellipsis" title={result[resultStringKeyName]}>
                        {formatResultWithKey(result)}
                    </div>
                </li>
            ))}
        </ResultsWrapper>
    );
}

export default function SearchAutocomplete<T extends Item>({
    items = [],
    fuseOptions = defaultFuseOptions,
    inputDebounce = DEFAULT_INPUT_DEBOUNCE,
    onSearch = () => {},
    onHover = () => {},
    onSelect = () => {},
    onFocus = () => {},
    onClear = () => {},
    showIcon = true,
    showClear = true,
    maxResults = MAX_RESULTS,
    placeholder = "",
    autoFocus = false,
    resultStringKeyName = "name",
    inputSearchString = "",
    formatResult,
    showNoResults = true,
    showNoResultsText = "No results",
    showItemsOnFocus = false,
    maxLength = 0,
    className,
}: SearchAutocompleteProps<T>) {
    const options = { ...defaultFuseOptions, ...fuseOptions };
    const fuse = new Fuse(items, options);
    fuse.setCollection(items);

    const [searchString, setSearchString] = useState(inputSearchString);
    const [results, setResults] = useState<T[]>([]);
    const [highlightedItem, setHighlightedItem] = useState(-1);
    const [isSearchComplete, setIsSearchComplete] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [hasFocus, setHasFocus] = useState(false);

    const fuseResults = (keyword: string) =>
        fuse
            .search(keyword, { limit: maxResults })
            .map((result) => ({ ...result.item }))
            .slice(0, maxResults);

    const eraseResults = () => {
        setResults([]);
        setIsSearchComplete(true);
    };

    // The three effects below sync state from props exactly as the package
    // does; deriving it during render would change when results appear.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSearchString(inputSearchString);
        const timeoutId = setTimeout(() => setResults(fuseResults(inputSearchString)), 0);
        return () => clearTimeout(timeoutId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputSearchString]);

    useEffect(() => {
        if (searchString?.length > 0 && results?.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setResults(fuseResults(searchString));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    const showNoResultsFlag =
        showNoResults && searchString.length > 0 && !isTyping && results.length === 0 && !isSearchComplete;

    useEffect(() => {
        if (showItemsOnFocus && results.length === 0 && searchString.length === 0 && hasFocus) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setResults(items.slice(0, maxResults));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showItemsOnFocus, results, searchString, hasFocus]);

    useEffect(() => {
        const handleDocumentClick = () => {
            eraseResults();
            setHasFocus(false);
        };
        document.addEventListener("click", handleDocumentClick);
        return () => document.removeEventListener("click", handleDocumentClick);
    }, []);

    const handleOnFocus = (event: FocusEvent<HTMLInputElement>) => {
        onFocus(event);
        setHasFocus(true);
    };

    const callOnSearch = (keyword: string) => {
        const newResults = keyword?.length > 0 ? fuseResults(keyword) : [];
        setResults(newResults);
        onSearch(keyword, newResults);
        setIsTyping(false);
    };

    // As in the package, the debounced search is rebuilt only when `items`
    // changes, so it searches the collection it was created with.
    const handleOnSearch = useMemo(
        () => inputDebounce > 0
            ? debounce((keyword: string) => callOnSearch(keyword), inputDebounce)
            : (keyword: string) => callOnSearch(keyword),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [items]
    );

    const handleOnClick = (result: T) => {
        eraseResults();
        onSelect(result);
        setSearchString(result[resultStringKeyName]);
        setHighlightedItem(0);
    };

    const handleSetSearchString = ({ target }: SearchStringEvent) => {
        const keyword = target.value;
        setSearchString(keyword);
        handleOnSearch(keyword);
        setIsTyping(true);
        if (isSearchComplete) setIsSearchComplete(false);
    };

    const handleSetHighlightedItem = ({ index, event }: HighlightRequest) => {
        const setValues = (nextIndex: number) => {
            setHighlightedItem(nextIndex);
            if (results?.[nextIndex]) onHover(results[nextIndex]);
        };

        if (index !== undefined) {
            setValues(index);
        } else if (event) {
            switch (event.key) {
                case "Enter":
                    if (results.length > 0 && results[highlightedItem]) {
                        event.preventDefault();
                        onSelect(results[highlightedItem]);
                        setSearchString(results[highlightedItem][resultStringKeyName]);
                        onSearch(results[highlightedItem][resultStringKeyName], results);
                    } else {
                        onSearch(searchString, results);
                    }
                    setHighlightedItem(-1);
                    eraseResults();
                    break;
                case "ArrowUp":
                    event.preventDefault();
                    setValues(highlightedItem > -1 ? highlightedItem - 1 : results.length - 1);
                    break;
                case "ArrowDown":
                    event.preventDefault();
                    setValues(highlightedItem < results.length - 1 ? highlightedItem + 1 : -1);
                    break;
                default:
                    break;
            }
        }
    };

    return (
        <div className={className ? `rsa ${className}` : "rsa"}>
            <div className="wrapper">
                <SearchInput
                    searchString={searchString}
                    setSearchString={handleSetSearchString}
                    eraseResults={eraseResults}
                    autoFocus={autoFocus}
                    onFocus={handleOnFocus}
                    onClear={onClear}
                    placeholder={placeholder}
                    showIcon={showIcon}
                    showClear={showClear}
                    setHighlightedItem={handleSetHighlightedItem}
                    maxLength={maxLength}
                />
                <Results
                    results={results}
                    onClick={handleOnClick}
                    setSearchString={setSearchString}
                    showIcon={showIcon}
                    maxResults={maxResults}
                    resultStringKeyName={resultStringKeyName}
                    formatResult={formatResult}
                    highlightedItem={highlightedItem}
                    setHighlightedItem={handleSetHighlightedItem}
                    showNoResultsFlag={showNoResultsFlag}
                    showNoResultsText={showNoResultsText}
                />
            </div>
        </div>
    );
}
