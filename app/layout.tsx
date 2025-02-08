import type {Metadata} from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles/main.css"
import "./globals.css";
import BootstrapLoader from "@/app/components/BootstrapLoader";
import {inter} from "@/app/styles/fonts";
import PaceManLink from "@/app/components/PaceManLink";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v14-appRouter';
import Hamburger from "@/app/Hamburger";
import { getAllUsers, getCached } from "@/app/data";
import PlayerSearch from "@/app/components/PlayerSearch";

export const metadata: Metadata = {
    title: "Pace Stats",
    description: "Stats from PaceMan data",
};

export default async function RootLayout({children}: Readonly<{
    children: React.ReactNode;
}>) {
    const users = await getCached(getAllUsers, "getAllUsers");
    return (
        <html lang="en">
        <body className={inter.className}>
        <AppRouterCacheProvider>
            <div className="d-sm-none">
                <nav className="navbar navbar-expand-sm navbar-dark bg-dark">
                    <div className="container">
                        <Hamburger users={users}/>
                    </div>
                </nav>
            </div>
            <div className="d-none d-sm-block">
                <nav className="navbar navbar-expand-sm navbar-dark bg-dark">
                    <div className="container">
                        <a className="navbar-brand" href="/stats/">Pace Stats</a>
                        <ul className="navbar-nav me-auto">
                            <li className="nav-item">
                                <a className="nav-link" href="/stats/">Leaderboards</a>
                            </li>
                            <li className="nav-item">
                                <a className="nav-link d-none d-lg-block" href="/stats/obs/">OBS Overlays</a>
                                <a className="nav-link d-block d-lg-none" href="/stats/obs/">OBS</a>
                            </li>
                            <li className="nav-item">
                                <a className="nav-link" href="/stats/aa/">AA</a>
                            </li>
                            <li className="nav-item">
                                <div className="searchWrapper">
                                    <PlayerSearch data={users}/>
                                </div>
                            </li>
                        </ul>
                        <ul className="navbar-nav d-none d-lg-block">
                            <li className="nav-item">
                                <PaceManLink/>
                            </li>
                        </ul>
                    </div>
                </nav>
            </div>
            <BootstrapLoader/>
            {children}
        </AppRouterCacheProvider>
        </body>
        </html>
    );
}
