import type {Metadata} from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles/main.css"
import "./globals.css";
import BootstrapLoader from "@/app/components/BootstrapLoader";
import SearchWrapper from "@/app/components/SearchWrapper";
import {inter} from "@/app/styles/fonts";
import PaceManLink from "@/app/components/PaceManLink";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v14-appRouter';

export const metadata: Metadata = {
    title: "Pace Stats",
    description: "Stats from PaceMan data",
};

export default function RootLayout({children}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
        <body className={inter.className}>
            <AppRouterCacheProvider>
                <nav className="navbar navbar-expand-sm navbar-dark bg-dark">
                    <div className="container">
                        <a className="navbar-brand" href="/stats/">Pace Stats</a>
                        <ul className="navbar-nav me-auto">
                            <li className="nav-item">
                                <a className="nav-link" href="/stats/">Leaderboards</a>
                            </li>
                            <li className="nav-item">
                                <a className="nav-link d-sm-none d-md-block" href="/stats/obs/">OBS Overlays</a>
                                <a className="nav-link d-none d-sm-block d-md-none" href="/stats/obs/">OBS</a>
                            </li>
                            <li className="nav-item">
                                <a className="nav-link" href="/stats/aa/">AA</a>
                            </li>
                            <li className="nav-item">
                                <SearchWrapper/>
                            </li>
                        </ul>
                        <ul className="navbar-nav">
                            <li className="nav-item">
                                <PaceManLink/>
                            </li>
                        </ul>
                    </div>
                </nav>
                <BootstrapLoader/>
                {children}
            </AppRouterCacheProvider>
        </body>
        </html>
    );
}
