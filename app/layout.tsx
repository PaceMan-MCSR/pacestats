import type {Metadata} from "next";
import "bootstrap/dist/css/bootstrap.min.css";
import "./styles/main.css"
import "./globals.css";
import BootstrapLoader from "@/app/components/BootstrapLoader";
import {inter} from "@/app/styles/fonts";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v14-appRouter';
import { getAllUserInfo, getAllUsers, getCached } from "@/app/data";
import Header from "@/app/Header";

export const metadata: Metadata = {
    title: "Pace Stats",
    description: "Stats from PaceMan data",
};

export default async function RootLayout({children}: Readonly<{
    children: React.ReactNode;
}>) {
    const users = await getCached(getAllUsers, "getAllUsers");
    const userInfo = await getCached(getAllUserInfo, "getAllUserInfo");
    return (
        <html lang="en">
        <body className={inter.className}>
        <AppRouterCacheProvider>
            <BootstrapLoader/>
            <Header users={users} userInfo={userInfo}/>
            {children}
        </AppRouterCacheProvider>
        </body>
        </html>
    );
}
