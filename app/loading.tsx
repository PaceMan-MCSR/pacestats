import { CircularProgress } from "@mui/material";

export default function Loading() {
    return <main className="main loading">
        <div className="container">
            <h1 className="header">
                <CircularProgress />
            </h1>
        </div>
    </main>
}