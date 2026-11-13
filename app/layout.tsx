import type {Metadata} from "next";
import "./globals.css";
import {inter} from "@/app/styles/inter";
import Header from "@/app/Header";

export const metadata: Metadata = {
    title: "Pace Stats",
    description: "Stats from PaceMan data",
};

const criticalThemeCss = `
    html, body, #body {
        min-height: 100%;
        background-color: rgb(18, 18, 21) !important;
        color: rgb(230, 230, 230);
    }
    .main {
        color: rgb(230, 230, 230);
        padding-top: 10px;
    }
    main .header {
        margin: 20px 0 5px;
        text-align: center;
        font-size: 2.2em;
    }
    main .subheader {
        margin-bottom: 40px;
        text-align: center;
    }
    .topRow, .rangeButtons, .filterGroup, .footer {
        text-align: center;
    }
    .topRow .btn, .rangeButtons .btn {
        margin: 0 8px 10px;
    }
    .rangeButtons {
        margin-top: 20px;
        margin-bottom: 10px;
    }
    .filterGroup {
        margin-bottom: 40px;
    }
    .filterToggle {
        margin-top: 5px;
        margin-bottom: 5px;
    }
    .footer {
        background-color: rgb(18, 18, 21);
        color: rgb(230, 230, 230);
        padding: 10px;
    }
`;

export default function RootLayout({children}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" data-bs-theme="dark" style={{backgroundColor: "rgb(18, 18, 21)"}}>
        <head>
            <meta name="darkreader-lock"/>
            {/* Every avatar and skin comes from this host. */}
            <link rel="preconnect" href="https://mc-api.io"/>
            <style id="critical-theme">{criticalThemeCss}</style>
        </head>
        <body className={inter.className} id="body" style={{backgroundColor: "rgb(18, 18, 21)"}}>
        <Header/>
        {children}
        </body>
        </html>
    );
}
