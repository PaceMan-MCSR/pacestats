export default function Loading() {
    return <main className="main">
        <div className="container">
            <h1 className="header">
                <span className="spinner-border text-primary" style={{width: 40, height: 40}} role="status" aria-label="Loading"/>
            </h1>
        </div>
    </main>
}