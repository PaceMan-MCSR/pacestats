'use client'

import React, { useState } from "react";
import { Collapse } from "@/app/components/HoverTooltip";
import RunFiltersPanel from "@/app/components/RunFiltersPanel";

// The native form is only a few KB. Share the history route's download so
// opening it needs no script/stylesheet round trip. Collapse still defers
// mounting the controls until they are used.

export default function RunFilters({bf, filters, setFilters}: {bf: boolean, filters: any[], setFilters: (filters: any[]) => void}) {
    const [toggled, setToggled] = useState(false);

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
                <RunFiltersPanel bf={bf} filters={filters} setFilters={setFilters}/>
            </Collapse>
        </div>
    )
}
