import {getAllUsers, getCached, getConn, getNick} from "@/app/data";
import {formatTime} from "@/app/utils";

export const revalidate = 60

function formatSeconds(seconds: number) {
    // Calculate hours, minutes, and remaining seconds
    const hours = Math.floor(seconds / 3600); // 3600 seconds in an hour
    const minutes = Math.floor((seconds % 3600) / 60); // 60 seconds in a minute
    const remainingSeconds = seconds % 60;

    // Format the result to always show two digits for hours, minutes, and seconds
    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(remainingSeconds).padStart(2, '0');

    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

function formatNumberWithCommas(number: number) {
    return number.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function days(seconds: number) {
    return Math.floor(seconds / 86400);
}

function hours(seconds: number) {
    return Math.floor(seconds / 3600); // 3600 seconds in an hour
}

export default async function Page({params, searchParams}: {
    params: { worldid: string },
    searchParams: { [key: string]: string | undefined }
}) {
    const conn = await getConn();
    const names = await getCached(getAllUsers, "getAllUsers");
    const [result, _] = await (conn).query(`
        SELECT ROUND(SUM(nether)/1000) as overworld, SUM(realUpdated-insertTime) as netherTime FROM pace WHERE id NOT IN (SELECT runId FROM nethers) AND realUpdated-insertTime <= 3600 AND year(insertTime)=2024;
        SELECT ROUND(SUM(wallTime)/1000) as wallTime, ROUND(SUM(playTime)/1000) as playTime, SUM(enters) as enters FROM nethers WHERE year(insertTime)=2024;
        SELECT SUM(resets) as resets FROM nethers WHERE resets<(totalResets/5) AND resets < 10000 and year(insertTime)=2024;
        SELECT COUNT(nether) as netherCount, AVG(nether) as netherAvg, COUNT(finish) as finishCount, AVG(finish) as finishAvg, MIN(nether) as fastestNether, MIN(finish) as fastestFinish FROM pace WHERE year(insertTime)=2024;
        SELECT uuid, COUNT(*) as nethers, avg(nether) as avg FROM pace force index (insertTime) WHERE year(insertTime)=2024 GROUP BY uuid ORDER BY nethers DESC LIMIT 5;
        SELECT nickname, finish, UNIX_TIMESTAMP(insertTime) as time FROM pace WHERE finish IS NOT NULL AND year(insertTime)=2024 ORDER BY finish ASC LIMIT 5;
        SELECT count(*), uuid, avg(finish) FROM pace ignore index (uuid) ignore index (insertTime) WHERE finish IS NOT null AND finish < 600000 AND year(insertTime)=2024 group by uuid order by count(*) desc limit 3;
        SELECT COUNT(DISTINCT uuid) AS count FROM pace;
    `);
    const results = result as any;
    let mostNethers = [];
    for(const result of results[4]){
        let name = names.find((name: any) => name.id === result.uuid)?.nick;
        mostNethers.push({uuid: result.uuid, name: name, nethers: result.nethers, avg: result.avg});
    }

    let mostSub10s = [];
    for(const result of results[6]){
        let name = names.find((name: any) => name.id === result.uuid)?.nick;
        mostSub10s.push({uuid: result.uuid, name: name, count: result['count(*)'], avg: formatTime(result['avg(finish)'])});
    }

    const overworld = parseInt(results[0][0].overworld) + parseInt(results[1][0].playTime)
    const nether = parseInt(results[0][0].netherTime);
    const wall = parseInt(results[1][0].wallTime);

    return (<main className="main obsSetup">
        <div className="container">
            <div style={{textAlign: "center", marginTop: "32px", marginBottom: "32px"}}>
                <h1>2024 Pace Recap</h1>
            </div>
            <div className="row mb-4">
                <div className="col-md-3">
                    <div style={{textAlign: "center"}}>
                        <h2>Time Spent</h2>
                    </div>
                    <ul style={{marginLeft: "5px"}}>
                        <li>Overworld: {formatNumberWithCommas(hours(parseInt(results[0][0].overworld) + parseInt(results[1][0].playTime)))} hours</li>
                        <li>Nether: {formatNumberWithCommas(hours(results[0][0].netherTime))} hours</li>
                        <li>Resetting: {formatNumberWithCommas(hours(results[1][0].wallTime))} hours</li>
                        <li>Total: {formatNumberWithCommas(hours(overworld + nether + wall))} hours</li>
                    </ul>
                </div>
                <div className="col-md-3">
                    <div style={{textAlign: "center"}}>
                        <h2>Nether Stats</h2>
                    </div>
                    <ul style={{marginLeft: "5px"}}>
                        <li>Enters: {formatNumberWithCommas(results[3][0].netherCount)}</li>
                        <li>Average: {formatTime(results[3][0].netherAvg)}</li>
                        <li>Resets: {formatNumberWithCommas(results[2][0].resets)}</li>
                    </ul>
                </div>
                <div className="col-md-3">
                    <div style={{textAlign: "center"}}>
                        <h2>Completions</h2>
                    </div>
                    <ul style={{marginLeft: "5px"}}>
                        <li>Total completions: {formatNumberWithCommas(results[3][0].finishCount)}</li>
                        <li>Average: {formatTime(results[3][0].finishAvg)}</li>
                    </ul>
                </div>
                <div className="col-md-3">
                    <div style={{textAlign: "center"}}>
                        <h2>Users</h2>
                    </div>
                    <ul style={{marginLeft: "5px"}}>
                        <li>Active users: {results[7][0].count}</li>
                    </ul>
                </div>
            </div>
            <div className="row">
                <div className="col-12 col-md-6 col-xl-4">
                    <div style={{textAlign: "center"}}>
                        <h2>Most Enters</h2>
                    </div>
                    <table className="table table-bordered table-dark">
                        <thead>
                        <tr>
                            <th>#</th>
                            <th>Name</th>
                            <th>Count</th>
                            <th>Avg</th>
                        </tr>
                        </thead>
                        <tbody>
                        {
                            mostNethers.map((row: any, idx: number) => {
                                return <tr key={row.name}>
                                    <td style={{width: "10px"}}>{idx + 1}</td>
                                    <td style={{width: "10px"}}>{row.name}</td>
                                    <td style={{width: "10px"}}>{row.nethers}</td>
                                    <td style={{width: "10px"}}>{formatTime(row.avg)}</td>
                                </tr>
                            })
                        }
                        </tbody>
                    </table>
                </div>
                <div className="col-12 col-md-6 col-xl-4">
                    <div style={{textAlign: "center"}}>
                        <h2>Fastest Runs</h2>
                    </div>
                    <table className="table table-bordered table-dark">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Name</th>
                                <th>Time</th>
                                <th>Date</th>
                            </tr>
                        </thead>
                        <tbody>
                        {
                            results[5].map((row: any, idx: number) => {
                                return <tr key={row.nickname}>
                                    <td style={{width: "10px"}}>{idx + 1}</td>
                                    <td style={{width: "10px"}}>{row.nickname}</td>
                                    <td style={{width: "10px"}}>{formatTime(row.finish)}</td>
                                    <td style={{width: "10px"}}>{new Date((row.time) * 1000).toLocaleDateString("en-US")}</td>
                                </tr>
                            })
                        }
                        </tbody>
                    </table>
                </div>
                <div className="col-12 col-md-6 col-xl-4">
                    <div style={{textAlign: "center"}}>
                        <h2>Most sub 10s</h2>
                    </div>
                    <table className="table table-bordered table-dark">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Name</th>
                                <th>Count</th>
                                <th>Avg</th>
                            </tr>
                        </thead>
                        <tbody>
                            {mostSub10s.map((user: any, idx: number) => {
                                return <tr key={user.name}>
                                    <td style={{width: "10px"}}>{idx + 1}</td>
                                    <td style={{width: "10px"}}>{user.name}</td>
                                    <td style={{width: "10px"}}>{user.count}</td>
                                    <td style={{width: "10px"}}>{user.avg}</td>
                                </tr>
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
            <div className="row justify-content-center">
                <div className="col-7">
                    <div style={{marginTop: "140px"}}>
                        <div style={{textAlign: "center"}}>
                            <h5>Accuracy Disclaimer</h5>
                            <span>Some stats are underreported due to:</span>
                        </div>
                        <ul>
                            <li>PaceMan/database outages & user tracker issues</li>
                            <li>Playtime tracking is not accurate without SeedQueue wall</li>
                            <li>Reset count was not counted before SeedQueue for most users</li>
                            <li>Time spent in nether is missing for many runs</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    </main>)
}