import type {Metadata} from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles/main.css"
import "./globals.css";
import BootstrapLoader from "@/app/components/BootstrapLoader";
import {inter} from "@/app/styles/fonts";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v14-appRouter';
import { fetchAllUsersFromRedis, getAllUserInfo, getAllUsers, getCached } from "@/app/data";
import Header from "@/app/Header";

export const metadata: Metadata = {
    title: "Pace Stats",
    description: "Stats from PaceMan data",
};

export default async function RootLayout({children}: Readonly<{
    children: React.ReactNode;
}>) {
    const users = await getCached(fetchAllUsersFromRedis, "fetchAllUsersFromRedis");
    const userInfo = await getCached(getAllUserInfo, "getAllUserInfo");
    return (
        <html lang="en">
        <head>
            <meta name="darkreader-lock"/>
        </head>
        <body className={inter.className} id="body">
        <AppRouterCacheProvider>
            <BootstrapLoader/>
            <Header users={users} userInfo={userInfo}/>
            {children}
        </AppRouterCacheProvider>
        </body>
        </html>
    );
}
