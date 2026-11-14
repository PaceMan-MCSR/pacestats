// Native controls keep the first filter interaction independent of MUI/Emotion.
import "./runFilters.css";
import RunDateFilter from "@/app/components/RunDateFilter";
import MaterialIcon from "@/app/components/MaterialIcon";

const parseTime = (value: string) => {
    const parts = value.split(':');
    if (parts.length !== 2 || !parts.every(part => /^\d+$/.test(part))) return NaN;
    const minutes = Number(parts[0]), seconds = Number(parts[1]);
    return seconds < 60 ? (minutes * 60 + seconds) * 1000 : NaN;
};

const PRESETS = [
    {label: "Sub 2 Enter", column: "nether", value: "2:00", inMs: 120000, operatorValue: "lessThan"},
    {label: "Sub 10", column: "finish", value: "10:00", inMs: 600000, operatorValue: "lessThan"},
    {label: "All Completions", column: "finish", value: "", inMs: 0, operatorValue: "isNotEmpty"},
];

export default function RunFiltersPanel({bf, filters, setFilters}: {bf: boolean, filters: any[], setFilters: (filters: any[]) => void}) {
    const update = (index: number, changes: Record<string, unknown>) => {
        setFilters(filters.map((filter, current) => current === index ? {...filter, ...changes} : filter));
    };
    const columns = [
        {value: "date", label: "Date"},
        {value: "nether", label: "Nether"},
        bf ? {value: "bastion", label: "Bastion"} : {value: "first_structure", label: "First Structure"},
        bf ? {value: "fortress", label: "Fortress"} : {value: "second_structure", label: "Second Structure"},
        {value: "first_portal", label: "First Portal"},
        {value: "stronghold", label: "Stronghold"},
        {value: "end", label: "End Enter"},
        {value: "finish", label: "Finish"},
    ];
    return <div className="runFiltersPanel">
        <p className="runFilterPresetsTitle">Presets</p>
        <div className="runFilterPresets">
            {PRESETS.map(({label, ...filter}) => <button
                key={label}
                type="button"
                className="runFilterPreset"
                onClick={() => setFilters([{...filter}])}
            >{label}</button>)}
        </div>
        <p className="runFiltersTitle">Filters</p>
        {filters.map((filter, index) => <div className="runFilterRow" key={index}>
            <label className="runFilterField runFilterColumn">
                <span>Column</span>
                <select aria-label={`Filter ${index + 1} column`} value={filter.column} onChange={event => {
                    const column = event.target.value;
                    if (column === "date") {
                        const now = new Date();
                        update(index, {column, operatorValue: "before", value: new Date(now.getFullYear(), now.getMonth(), now.getDate())});
                    } else if (filter.column === "date") {
                        update(index, {column, operatorValue: "lessThan", value: "1:30", inMs: 90000});
                    } else update(index, {column});
                }}>
                    {columns.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
            </label>
            <label className="runFilterField runFilterOperator">
                <span>Operator</span>
                <select aria-label={`Filter ${index + 1} operator`} value={filter.operatorValue || ''} onChange={event => update(index, {operatorValue: event.target.value})}>
                    {(filter.column === "date" ? [
                        {value: "before", label: "Before"}, {value: "after", label: "After"}, {value: "during", label: "During"},
                    ] : [
                        {value: "lessThan", label: "Under"}, {value: "greaterThan", label: "Over"},
                        {value: "isNotEmpty", label: "Exists"}, {value: "isEmpty", label: "Doesn't Exist"},
                    ]).map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
            </label>
            {["before", "after", "during"].includes(filter.operatorValue) && <RunDateFilter value={filter.value} onChange={value => update(index, {value})}/>}
            {["lessThan", "greaterThan"].includes(filter.operatorValue) && <label className="runFilterField runFilterTime">
                <span>Time</span>
                <input
                    type="text"
                    inputMode="numeric"
                    aria-label={`Filter ${index + 1} time`}
                    value={filter.value || ''}
                    placeholder="mm:ss"
                    onChange={event => {
                        const value = event.target.value;
                        if (/^[\d:]*$/.test(value)) update(index, {value, inMs: parseTime(value)});
                    }}
                />
            </label>}
            <button type="button" className="runFilterIconButton runFilterRemove" aria-label={`Remove filter ${index + 1}`} title="Remove filter" onClick={() => setFilters(filters.filter((_, current) => current !== index))}>
                <MaterialIcon icon="close"/>
            </button>
        </div>)}
        <button type="button" className="runFilterIconButton" aria-label="Add filter" title="Add filter" onClick={() => setFilters([...filters, {column: "nether", operatorValue: "lessThan", value: "1:30", inMs: 90000}])}>
            <MaterialIcon icon="add"/>
        </button>
        <button type="button" className="runFilterIconButton runFilterRemove" aria-label="Reset all filters" title="Reset all filters" onClick={() => setFilters([])}>
            <MaterialIcon icon="delete"/>
        </button>
    </div>;
}
