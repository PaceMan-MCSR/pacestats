import Link from "next/link";
import {Metadata} from "next";

export const metadata: Metadata = {
    title: "404",
    description: ""
};

export default function NotFound() {
    return (
        <main className="main">
            <div className="notFound">
                <h1>Page Not Found</h1>
                <Link href="/">
                    <button className="btn btn-primary">Go to Home</button>
                </Link>
            </div>
        </main>
    )
}