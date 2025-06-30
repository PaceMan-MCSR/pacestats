'use client';

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Collapse } from "react-bootstrap";

export default function FilterChange() {
    // Hooks for navigation and state
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isPending, startTransition] = useTransition();
    const [isLoading, setIsLoading] = useState(true);

    // Directly get the category from search params, with a default value. This is cleaner.
    const category = searchParams.get('category') || 'count_avg';

    // State for the collapse component. It's open if a category is already set in the URL.
    const [toggled, setToggled] = useState(searchParams.get('category') !== null);

    // New navigation handler using the App Router
    const handleCategoryChange = (newCategory: string) => {
        const newParams = new URLSearchParams(searchParams.toString());
        if(newCategory === "") {
            newParams.delete('category'); // Remove the category if it's empty
        } else {
            newParams.set('category', newCategory); // Set the new category
        }

        startTransition(() => {
            router.push(`${pathname}?${newParams.toString()}`);
        });
    };

    useEffect(() => {
        setIsLoading(false);
    }, []);

    return (
        <div
            className="filterGroup"
            style={{
                // Add a style to indicate the loading state
                opacity: isPending ? 0.7 : 1,
                transition: 'opacity 0.2s ease-in-out',
            }}
        >
            <button
                className={"btn btn-dark filterToggle" + (toggled ? " active" : "")}
                type="button"
                onMouseDown={() => setToggled(!toggled)}
                // Also disable the toggle button during navigation
                disabled={isLoading}
            >
                Toggle category
            </button>
            <Collapse in={toggled}>
                <div className="filterButtons" id="filterButtons">
                    <button
                        className={"btn mt-3 " + (category === "count_avg" ? "btn-primary" : "btn-dark")}
                        onMouseDown={() => handleCategoryChange("")}
                    >
                        Qty + Average
                    </button>
                    <br />
                    <button
                        className={"btn my-3 mx-1 " + (category === "conversion" ? "btn-primary" : "btn-dark")}
                        onMouseDown={() => handleCategoryChange("conversion")}
                        disabled={isPending}
                    >
                        Conversion
                    </button>
                    <button
                        className={"btn my-3 mx-1 " + (category === "fastest" ? "btn-primary" : "btn-dark")}
                        onMouseDown={() => handleCategoryChange("fastest")}
                        disabled={isPending}
                    >
                        Fastest
                    </button>
                    <button
                        className={"btn my-3 mx-1 " + (category === "average" ? "btn-primary" : "btn-dark")}
                        onMouseDown={() => handleCategoryChange("average")}
                        disabled={isPending}
                    >
                        Average
                    </button>
                </div>
            </Collapse>
        </div>
    );
}