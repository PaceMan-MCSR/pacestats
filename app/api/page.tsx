'use client'

import "@/app/styles/api.css"
import {anOldHope, CodeBlock} from 'react-code-blocks';

function GetSessionNethers(){
    return <div id="getSessionNethers" className="apiBlock">
        <h2 className="header mb-4">getSessionNethers</h2>
        <h3>Description</h3>
        <p>
            Returns nether enter count & average for a given timeframe<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>name: Either MC username or twitch</li>
            <li>hours: How many hours of stats to include (default: 24)</li>
            <li>hoursBetween: The max number of hours between runs in a session (default: 6)</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getSessionNethers?name=meebie&hours=24&hoursBetween=2</code>
                <p>
                    Returns nether enter count and average for latest session in the last 24 hours,
                    ignoring runs behind a &gt;2 hour break (in case there are multiple sessions in a day)
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\n" +
                           "  \"count\": 3,\n" +
                           "  \"avg\": \"3:36\"\n" +
                           "}"}/>
                </div>
            </li>
            <li>
                <code>getSessionStats?name=meebie&hours=730&hoursBetween=730</code>
                <p>
                    Returns all stats for 30-ish days (any hour values are valid, e.g 999999 for "lifetime")
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\n" +
                           "  \"count\": 20,\n" +
                           "  \"avg\": \"5:40\"\n" +
                           "}"}/>
                </div>
            </li>
        </ul>
        <h3>Edge cases</h3>
        <ul>
            <li>Invalid MC username/twitch provided:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\"error\": \"Unknown user\"}\n" +
                           "# Status code 404"}/>
                </div>
            </li>
            <li>If no runs are found for a valid player name:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\n" +
                           "  \"count\": 0,\n" +
                           "  \"avg\": \"0:00\"\n" +
                           "}\n" +
                           "# Status code 200"}/>
                </div>
            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>20 seconds</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 20 seconds
            </li>
        </ul>
    </div>
}

function GetSessionStats(){
    return <div id="getSessionStats" className="apiBlock">
        <h2 className="header mb-4">getSessionStats</h2>
        <h3>Description</h3>
        <p>
            Returns counts & average for all splits in a given timeframe<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>name: Either MC username or twitch</li>
            <li>hours: How many hours of stats to include (default: 24)</li>
            <li>hoursBetween: The max number of hours between runs in a session (default: 6)</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getSessionStats?name=meebie&hours=24&hoursBetween=2</code>
                <p>
                    Returns stats for latest session in the last 24 hours,
                    ignoring runs behind a &gt;2 hour break (in case there are multiple sessions in a day)
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\n" +
                           "  \"nether\": {\n" +
                           "    \"count\": 2,\n" +
                           "    \"avg\": \"4:36\"\n" +
                           "  },\n" +
                           "  \"bastion\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"fortress\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"first_structure\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"second_structure\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"first_portal\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"stronghold\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"end\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  },\n" +
                           "  \"finish\": {\n" +
                           "    \"count\": 0,\n" +
                           "    \"avg\": \"0:00\"\n" +
                           "  }\n" +
                           "}"}/>
                </div>
            </li>
            <li>
                <code>getSessionStats?name=meebie&hours=730&hoursBetween=730</code>
                <p>
                    Returns all stats for 30-ish days (any hour values are valid, e.g 999999 for "lifetime")
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\n" +
                           "  \"nether\": {\n" +
                           "    \"count\": 1818,\n" +
                           "    \"avg\": \"2:25\"\n" +
                           "  },\n" +
                           "  \"bastion\": {\n" +
                           "    \"count\": 432,\n" +
                           "    \"avg\": \"2:32\"\n" +
                           "  },\n" +
                           "  \"fortress\": {\n" +
                           "    \"count\": 167,\n" +
                           "    \"avg\": \"4:40\"\n" +
                           "  },\n" +
                           "  \"first_structure\": {\n" +
                           "    \"count\": 464,\n" +
                           "    \"avg\": \"2:26\"\n" +
                           "  },\n" +
                           "  \"second_structure\": {\n" +
                           "    \"count\": 137,\n" +
                           "    \"avg\": \"5:28\"\n" +
                           "  },\n" +
                           "  \"first_portal\": {\n" +
                           "    \"count\": 108,\n" +
                           "    \"avg\": \"7:04\"\n" +
                           "  },\n" +
                           "  \"stronghold\": {\n" +
                           "    \"count\": 54,\n" +
                           "    \"avg\": \"9:36\"\n" +
                           "  },\n" +
                           "  \"end\": {\n" +
                           "    \"count\": 33,\n" +
                           "    \"avg\": \"11:06\"\n" +
                           "  },\n" +
                           "  \"finish\": {\n" +
                           "    \"count\": 13,\n" +
                           "    \"avg\": \"10:33\"\n" +
                           "  }\n" +
                           "}"}/>
                </div>
            </li>
        </ul>
        <h3>Edge cases</h3>
        <ul>
            <li>Invalid MC username/twitch provided:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"{\"error\": \"Unknown user\"}\n" +
                                   "# Status code 404"}/>
                </div>
            </li>
            <li>If no runs are found for a valid player name:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"{\n" +
                                   "  \"nether\": {\n" +
                                   "    \"count\": 0,\n" +
                                   "    \"avg\": \"0:00\"\n" +
                                   "  },\n" +
                                   "  # etc, other splits with 0's here\n" +
                                   "}\n" +
                                   "# Status code 200"}/>
                </div>
            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>20 seconds</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 20 seconds
            </li>
        </ul>
        <h3>Notes</h3>
        <ul>
            <li>
                <code>first_structure</code> and <code>second_structure</code> are recommended instead of bastion and fortress
            </li>
            <li>
                <code>second_structure</code> requires either a rod if fort first, or &gt;50 seconds between structures if bastion first
            </li>
        </ul>
    </div>
}

function GetSplitStats(){
    return <div id="getSplitStats" className="apiBlock">
        <h2 className="header mb-4">getSplitStats</h2>
        <h3>Description</h3>
        <p>
            Returns count & average for a given split in a given timeframe<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>name: Either MC username or twitch</li>
            <li>hours: How many hours of stats to include (default: 24)</li>
            <li>hoursBetween: The max number of hours between runs in a session (default: 6)</li>
            <li>split: The split to get stats for (nether, bastion, fortress, first_structure, second_structure, first_portal, stronghold, end, finish)</li>
            <li>maxTime: The slowest run to include in the average, in milliseconds</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getSplitStats?name=meebie&split=bastion&maxTime=300000&hours=24&hoursBetween=2</code>
                <p>
                    Returns number of sub 5 bastions for latest session in the last 24 hours,
                    ignoring runs behind a &gt;2 hour break (in case there are multiple sessions in a day)
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"{\n" +
                                   "  \"count\": 2,\n" +
                                   "  \"avg\": \"4:36\"\n" +
                                   "}"}/>
                </div>
            </li>
        </ul>
        <h3>Edge cases</h3>
        <ul>
            <li>Invalid MC username/twitch provided:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"{\"error\": \"Unknown user\"}\n" +
                                   "# Status code 404"}/>
                </div>
            </li>
            <li>If no runs are found for a valid player name:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"{\n" +
                                   "  \"count\": 0,\n" +
                                   "  \"avg\": \"0:00\"\n" +
                                   "}\n" +
                                   "# Status code 200"}/>
                </div>
            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>20 seconds</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 20 seconds
            </li>
        </ul>
        <h3>Notes</h3>
        <ul>
            <li>
                <code>first_structure</code> and <code>second_structure</code> are recommended instead of bastion and fortress
            </li>
            <li>
                <code>second_structure</code> requires either a rod if fort first, or &gt;50 seconds between structures if bastion first
            </li>
        </ul>
    </div>
}

function GetWorld(){
    return <div id="getWorld" className="apiBlock">
        <h2 className="header mb-4">getWorld</h2>
        <h3>Description</h3>
        <p>
            Returns data for a given run<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>worldId: Either a numerical run ID, or the world ID hash</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getWorld/?worldId=31aad8ee0540af3a0573ac959e85f8b81f3941010d8cd20a33b67d04b29a0237</code>
                <br/>
            </li>
            <li>
                <code>getWorld/?worldId=251471</code>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\n" +
                           "  \"data\": {\n" +
                           "    \"id\": 251471, # run id from stats db\n" +
                           "    \"worldId\": \"31aad8ee0540af3a0573ac959e85f8b81f3941010d8cd20a33b67d04b29a0237\", # world id from paceman api (hash of world file path)\n" +
                           "    \"nickname\": \"dfanm\", # mc username\n" +
                           "    \"uuid\": \"4990072b-252e-42f2-aef9-45cd765f2425\", # mc uuid\n" +
                           "    \"twitch\": \"dfanm\", # twitch account (or null)\n" +
                           "    \"nether\": 146952, # IGT in ms\n" +
                           "    \"bastion\": 200037, # IGT in ms (or null)\n" +
                           "    \"fortress\": null, # IGT in ms (or null)\n" +
                           "    \"first_portal\": null, # IGT in ms (or null)\n" +
                           "    \"stronghold\": null, # IGT in ms (or null)\n" +
                           "    \"end\": null, # IGT in ms (or null)\n" +
                           "    \"finish\": null, # IGT in ms (or null)\n" +
                           "    \"netherRta\": 152614, # RTA in ms\n" +
                           "    \"bastionRta\": 211353, # RTA in ms (or null)\n" +
                           "    \"fortressRta\": null, # RTA in ms (or null)\n" +
                           "    \"first_portalRta\": null, # RTA in ms (or null)\n" +
                           "    \"strongholdRta\": null, # RTA in ms (or null)\n" +
                           "    \"endRta\": null, # RTA in ms (or null)\n" +
                           "    \"finishRta\": null, # RTA in ms (or null)\n" +
                           "    \"insertTime\": 1715824744, # unix timestamp (secs) of nether enter\n" +
                           "    \"updateTime\": 1715824800, # unix timestamp (secs) of last split update\n" +
                           "    \"vodId\": 2146675569, # twitch VOD id (or null)\n" +
                           "    \"vodOffset\": 14503, # seconds from VOD start to run start (or null)\n" +
                           "  },\n" +
                           "  \"time\": 1715929618254, # unix timestamp (ms) when this data was last cached\n" +
                           "  \"isLive\": false # whether the run is currently in liveruns\n" +
                           "}"}/>
                </div>
            </li>
        </ul>
        <h3>Edge cases</h3>
        <ul>
            <li>Invalid world/run ID:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"null\n" +
                           "# Status code 200"}/>
                </div>
            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>5 seconds</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 5 seconds
            </li>
        </ul>
        <h3>Notes</h3>
        <ul>
            <li>If you need to constantly update splits for a run, consider <a href="https://paceman.gg/api/ars/liveruns">liveruns</a> instead</li>
        </ul>
    </div>
}

function GetRecentRuns(){
    return <div id="getRecentRuns" className="apiBlock">
        <h2 className="header mb-4">getRecentRuns</h2>
        <h3>Description</h3>
        <p>
            Returns recent runs for a user<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>name: Either MC username or twitch</li>
            <li>hours: How many hours of stats to include (default: 24)</li>
            <li>hoursBetween: The max number of hours between runs in a session (default: 6)</li>
            <li>limit: Max number of runs to return (default: 10)</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getRecentRuns?name=meebie&hours=24&limit=1</code>
                <p>
                    Returns the most recent run for user "meebie" in the last 24 hours
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"[\n" +
                                   "  {\n" +
                                   "    \"id\": 252315, # run id from stats db\n" +
                                   "    \"nether\": 128750, # IGT in ms\n" +
                                   "    \"bastion\": 167565, # IGT in ms (or null)\n" +
                                   "    \"fortress\": null, # IGT in ms (or null)\n" +
                                   "    \"first_portal\": null, # IGT in ms (or null)\n" +
                                   "    \"stronghold\": null, # IGT in ms (or null)\n" +
                                   "    \"end\": null, # IGT in ms (or null)\n" +
                                   "    \"finish\": null, # IGT in ms (or null)\n" +
                                   "    \"lootBastion\": null, # IGT in ms (or null)\n" +
                                   "    \"obtainObsidian\": null, # IGT in ms (or null)\n" +
                                   "    \"obtainCryingObsidian\": null, # IGT in ms (or null)\n" +
                                   "    \"obtainRod\": null, # IGT in ms (or null)\n" +
                                   "    \"time\": 1715912736 # unix timestamp (secs) of nether enter\n" +
                                   "  }\n" +
                                   "]"}/>
                </div>

            </li>
        </ul>
        <h3>Edge cases</h3>
        <ul>
            <li>Invalid MC username/twitch provided:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"{\"error\": \"Unknown user\"}\n" +
                                   "# Status code 404"}/>
                </div>
            </li>
            <li>If no runs are found for a valid player name:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"[]\n" +
                                   "# Status code 200"}/>
                </div>
            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>20 seconds</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 20 seconds
            </li>
        </ul>
        <h3>Notes</h3>
        <ul>
            <li>If you need more details, such as RTA splits and VOD info, pass the run ID to <a href="#getWorld"><code>getWorld</code></a></li>
        </ul>
    </div>
}

function GetLeaderboard(){
    return <div id="getLeaderboard" className="apiBlock">
        <h2 className="header mb-4">getLeaderboard</h2>
        <h3>Description</h3>
        <p>
            Returns the leaderboard for a given category and type<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>days: How many days of stats to include (default: 30)<br/>
                Valid values: <code>1, 7, 30, 9999</code>
            </li>
            <li>category: Which split to get results for (default: <code>nether</code>)<br/>
                Valid values: <code>nether, bastion, fortress, first_structure, second_structure, first_portal, second_portal, stronghold, end, finish</code>
            </li>
            <li>type: Method of comparing values (default: <code>count</code>)<br/>
                Valid values: <code>count, average, fastest, conversion</code>
            </li>
            <li>limit: Max number of players to return (default: 10, max: 999999)</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getLeaderboard?category=nether&type=count&days=7&limit=1</code>
                <p>
                    Returns the player with the most nether entries in the last 7 days
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                               theme={anOldHope}
                               showLineNumbers={false}
                               text={"[\n" +
                                   "  {\n" +
                                   "    \"uuid\": \"eb77c626-a8ff-4d25-b095-7918a5d19b59\", # mc uuid\n" +
                                   "    \"name\": \"Pjoes\", # mc username\n" +
                                   "    \"value\": 50, # value for given type (nether enter count)\n" +
                                   "    \"qty\": 50, # qty (always present)\n" +
                                   "    \"avg\": 112957.62 # avg (always present)\n" +
                                   "  }\n" +
                                   "]"}/>
                </div>

            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>10 minutes</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 10 minutes
            </li>
        </ul>
        <h3>Notes</h3>
        <ul>
            <li>Avoid using this if you can use <a href="#getSessionStats">getSessionStats</a> instead.</li>
            <li>getLeaderboard requires parsing all runs from all users during the given timeframe</li>
        </ul>
    </div>
}

function GetRecentTimestamps(){
    return <div id="getRecentTimestamps" className="apiBlock">
        <h2 className="header mb-4">getRecentTimestamps</h2>
        <h3>Description</h3>
        <p>
            Returns unix timestamps for splits in recent runs<br/>
        </p>
        <h3>Parameters</h3>
        <ul>
            <li>name: Either MC username or twitch</li>
            <li>limit: Max number of runs to return (default: 20, max: 50)</li>
            <li>onlyFort: Whether to only include runs that have 2 structures (default: false)</li>
        </ul>
        <h3>Examples</h3>
        <ul>
            <li>
                <code>getRecentTimestamps/?name=jojoe_77777&limit=1</code>
                <p>
                    Returns timestamps for most recent run from player
                </p>
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"[\n" +
                           "  {\n" +
                           "    \"id\": 123456, # run id\n" +
                           "    \"runName\": \"3:23 Bastion\", # last split of run\n" +
                           "    \"start\": 1714048026.945, # timestamp of run start (with decimals)\n" +
                           "    \"nether\": 1714048131, # no decimals sorry\n" +
                           "    \"bastion\": 1714048207.958, # with decimals (or null)\n" +
                           "    \"fortress\": null, # with decimals (or null)\n" +
                           "    \"first_portal\": null, # with decimals (or null)\n" +
                           "    \"stronghold\": null, # with decimals (or null)\n" +
                           "    \"end\": null, # with decimals (or null)\n" +
                           "    \"finish\": null, # with decimals (or null)\n" +
                           "    \"realUpdate\": null # more accurate but nullable, no decimals\n" +
                           "    \"lastUpdated\": 1714048207 # always exists but affected by db patches, no decimals\n" +
                           "  }\n" +
                           "]"}/>
                </div>

            </li>
        </ul>
        <h3>Edge cases</h3>
        <ul>
            <li>Invalid MC username/twitch provided:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\"error\": \"Unknown user\"}\n" +
                           "# Status code 404"}/>
                </div>
            </li>
            <li>If no runs are found for a valid player name:
                <div className="output">
                    <CodeBlock language={"JavaScript"}
                       theme={anOldHope}
                       showLineNumbers={false}
                       text={"{\"error\": \"No data found for this user\"}\n" +
                           "# Status code 404"}/>
                </div>
            </li>
        </ul>
        <h3>Caching</h3>
        <ul>
            <li>10 seconds</li>
            <li>
                There are no rate limits currently,
                but don't bother spamming this endpoint more than once every 10 seconds
            </li>
        </ul>
        <h3>Notes</h3>
        <ul>
            <li>Intended use case is clipping runs from local recordings</li>
            <li>If you want IGT/RTA split info, use <a href="#getRecentRuns">getRecentRuns</a> instead.</li>
        </ul>
    </div>
}

function GetAllData(){
    return <div id="getAllData" className="apiBlock">
        <h2 className="header mb-4">getAllData</h2>
        <h3>Description</h3>
        <p>
            Secret API to get all runs from all users for a given timeframe, DM jojoe77777 on Discord for access<br/>
            <b>Warning:</b> This endpoint can be very slow and take a long time to return data
        </p>
    </div>
}

export default function Page() {
    return <div className="container">
        <div className="row justify-content-center mt-4">
            <div className="col-12" style={{textAlign:"center"}}>
                <h1 className="header">API Documentation</h1>
            </div>
        </div>
        <div className="row justify-content-center">
            <div className="col-12 col-md-6">
                <p>All API routes on this page should be prefixed with https://paceman.gg/stats/api/</p>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12">
                <h3>API routes</h3>
                <ul>
                    <li><a href="#getSessionNethers">getSessionNethers</a></li>
                    <li><a href="#getSessionStats">getSessionStats</a></li>
                    <li><a href="#getSplitStats">getSplitStats</a></li>
                    <li><a href="#getWorld">getWorld</a></li>
                    <li><a href="#getRecentRuns">getRecentRuns</a></li>
                    <li><a href="#getLeaderboard">getLeaderboard</a></li>
                    <li><a href="#getRecentTimestamps">getRecentTimestamps</a></li>
                    <li><a href="#getAllData">getAllData</a></li>
                </ul>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetSessionNethers/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetSessionStats/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetSplitStats/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetWorld/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetRecentRuns/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetLeaderboard/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetRecentTimestamps/>
            </div>
        </div>
        <div className="row mb-3">
            <div className="col-12 col-lg-12">
                <GetAllData/>
            </div>
        </div>

        <div className="row mb-5"/>
    </div>
}