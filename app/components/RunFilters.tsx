'use client'

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Collapse } from "@/app/components/HoverTooltip";

// Loaded when the panel first opens; see RunFiltersPanel.tsx.
const RunFiltersPanel = dynamic(() => import("@/app/components/RunFiltersPanel"), {
    ssr: false,
    loading: () => <p style={{margin: "15px 0"}}>Loading filters...</p>,
});

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
