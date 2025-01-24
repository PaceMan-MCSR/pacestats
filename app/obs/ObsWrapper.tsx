'use client'
import ResetScroll from "@/app/components/ResetScroll";
import PlayerSearch from "@/app/components/PlayerSearch";
import {ChangeEvent, useEffect, useState} from "react";
import {HexColorInput, HexColorPicker} from "react-colorful";
import Tooltip from "react-bootstrap/Tooltip";
import OverlayTrigger from "react-bootstrap/OverlayTrigger";
import SessionNethers from "@/app/obs/sessionNethers/[nick]/SessionNethers";
import Session from "@/app/obs/session/[nick]/Session";
import FontPicker from "@/app/obs/FontPicker";

export default function ObsWrapper({names, params}: {
        names: any, params: { }
    }) {
    const [search, setSearch] = useState("")
    const [color, setColor] = useState("#000000")
    const [hours, setHours] = useState(24)
    const [hoursBetween, setHoursBetween] = useState(2)

    const [bufferedHours, setBufferedHours] = useState(hours)
    const [bufferedHoursBetween, setBufferedHoursBetween] = useState(hoursBetween)

    const [font, setFont] = useState("Minecraft")

    const [netherUrl, setNetherUrl] = useState(`${process.env.NEXT_PUBLIC_HOSTNAME}/stats/obs/sessionNethers/${search}`)
    const [sessionUrl, setSessionUrl] = useState(`${process.env.NEXT_PUBLIC_HOSTNAME}/stats/obs/session/${search}`)

    const [clipboard, setClipboard] = useState("")
    const [dynamic, setDynamic] = useState(true)
    const [nph, setNph] = useState(true)
    const [nphRight, setNphRight] = useState(false)
    const [avgDp, setAvgDp] = useState(0)
    const [nphDp, setNphDp] = useState(0)

    const [sessionWidth, setSessionWidth] = useState(0)
    const [sessionHeight, setSessionHeight] = useState(0)

    const [wallScene, setWallScene] = useState("Walling")
    const [playingScene, setPlayingScene] = useState("Playing")

    const url = `https://mc-heads.net/avatar/${search}/8`

    useEffect(() => {
        setNetherUrl(`${process.env.NEXT_PUBLIC_HOSTNAME}/stats/obs/sessionNethers/${search}/?hours=${hours}&hoursBetween=${hoursBetween}&color=${color.replace("#", "")}&font=${font}&nph=${nph}&nphRight=${nphRight}&dp=${avgDp}&nphDp=${nphDp}&wallScene=${wallScene}&playingScene=${playingScene}`)
        setSessionUrl(`${process.env.NEXT_PUBLIC_HOSTNAME}/stats/obs/session/${search}/?hours=${hours}&hoursBetween=${hoursBetween}&color=${color.replace("#", "")}&font=${font}&dynamic=${dynamic}`)
    }, [search, hours, hoursBetween, color, font, nph, avgDp, nphDp, nphRight, wallScene, playingScene, dynamic])

    const changeHours = (event: ChangeEvent<{ value: string }>) => {
        // @ts-ignore
        setHours(event?.currentTarget?.value || 24);
    }

    const changeHoursBetween = (event: ChangeEvent<{ value: string }>) => {
        // @ts-ignore
        setHoursBetween(event?.currentTarget?.value || 2);
    }

    const pushHours = () => {
        setBufferedHours(hours)
        setBufferedHoursBetween(hoursBetween)
    }

    const setClipboardUrl = (url: string) => {
        navigator.clipboard.writeText(url);
        setClipboard(url)
    }

    return (<main className="main obsSetup">
        <div className="container">
            <ResetScroll/>
            <div className="row justify-content-center">
                <h1 className="header mb-3">OBS Browser Sources</h1>
            </div>
            {!search && (
                <div className="row justify-content-center">
                    <div className="col-12" style={{textAlign: "center"}}>
                        <h4>Enter username to get started</h4>
                        <p>If you can't find your name, make sure you have previously entered the nether with PaceMan</p>
                    </div>
                </div>
            )}
            <div className="row justify-content-center">
                <div className="col-11 col-md-8 col-lg-7 col-xl-6">
                    <div className="settings row">
                        <div className="col">
                            <img className="avatar" src={url} alt={search}/>
                            <div className="nameSearch">
                                <PlayerSearch data={names} input={search} setOutput={setSearch} />
                            </div>
                            <OverlayTrigger overlay={
                                <Tooltip className="hoursTooltip">
                                    <p>Number of hours to include stats for</p>
                                </Tooltip>
                            } delay={{ show: 100, hide: 50 }}>
                                <label>Time period:</label>
                            </OverlayTrigger>
                            <input type="number" defaultValue={24} placeholder="24" className="form-control hours" onChange={changeHours} />
                            <br/>
                            <OverlayTrigger overlay={
                                <Tooltip className="hoursTooltip">
                                    <p>Max number of hours between runs in a session<br/>Set this to a high number (e.g 9999) to ignore sessions<br/>and include all runs for a given time period</p>
                                </Tooltip>
                            } delay={{ show: 100, hide: 50 }}>
                                <label>Max session break:</label>
                            </OverlayTrigger>
                            <input type="number" defaultValue={2} placeholder="2" className="form-control hours" onChange={changeHoursBetween} />
                            <br/>
                            <button style={{display: hours !== bufferedHours || hoursBetween !== bufferedHoursBetween ? "block" : "none"}} className="btn btn-primary" onClick={pushHours}>Preview updated hours</button>
                            <FontPicker output={setFont}/>
                        </div>
                        <div className="colorSection col-5 col-xl-5 col-xxl-4">
                            <label>Text color:</label>
                            <div className="colorPicker">
                                <HexColorPicker color={color} onChange={setColor} />
                            </div>
                            <div className="colorPickerInput">
                                <HexColorInput color={color} onChange={setColor} />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {search && (
                <div className="row justify-content-center">
                    <div className="col-12 col-sm-12 col-md-6 col-lg-4 col-xl-3">
                        <h4 className="header">Nethers</h4>
                        <div className="urlHint">{netherUrl === clipboard ? "Copied!" : "Click URL to copy"}</div>
                        <div className="urlBox" onClick={() => {setClipboardUrl(netherUrl)}}>
                            <p>{netherUrl}</p>
                        </div>
                        <div>
                            <label id="nphLabel">
                                <input type="checkbox" id="nph" defaultChecked={nph} onChange={(e) => {setNph(e.target.checked)}}/>
                                Show NPH
                            </label>
                            <label id="nphRightLabel">
                                <input type="checkbox" id="nphRight" defaultChecked={nphRight} onChange={(e) => {setNphRight(e.target.checked)}}/>
                                Right-align NPH
                            </label>
                            <br/>
                            <p style={{marginBottom: 0}}>Decimal precision:</p>
                            <label>
                                Avg
                                <input type="number" defaultValue={avgDp} placeholder="0" className="form-control avgDp" onChange={(e) => {
                                    // @ts-ignore
                                    setAvgDp(e.target.value)}
                                } />
                            </label>
                            <label>
                                NPH
                                <input type="number" defaultValue={nphDp} placeholder="0" className="form-control nphDp" onChange={(e) => {
                                    // @ts-ignore
                                    setNphDp(e.target.value)}
                                } />
                            </label>
                            <br/>
                        </div>
                        <div>
                            <SessionNethers name={search} settings={{
                                hours: bufferedHours, hoursBetween: bufferedHoursBetween, color: color,
                                demo: true, font: font, nph: nph, liveOnly: false,
                                decimals: avgDp, nphDp: nphDp, nphRight: nphRight}}/>
                        </div>
                    </div>
                    <div className="col-1 col-sm-6 d-md-none col-lg-1 col-xl-1"/>
                    <div className="col-12 col-sm-12 col-md-6 col-lg-4 col-xl-3">
                        <h4 className="header">Stats</h4>
                        <div className="urlHint">{sessionUrl === clipboard ? "Copied!" : "Click URL to copy"}</div>
                        <div className="urlBox" onClick={() => {setClipboardUrl(sessionUrl)}}>
                            <p>{sessionUrl}</p>
                        </div>
                        <label id="dynamicLabel">
                            <input type="checkbox" id="dynamic" defaultChecked={dynamic} onChange={(e) => {setDynamic(e.target.checked)}}/>
                            Dynamic layout
                        </label>
                        <OverlayTrigger overlay={
                            <Tooltip className="dynamicTooltip">
                                <p>
                                    Automatically adjust layout based on browser source width & height<br/>
                                    Defaults to horizontal when enough space is available<br/>
                                    Resize the box here to desired size, then set the same width & height in OBS
                                </p>
                            </Tooltip>
                        } delay={{ show: 100, hide: 1000 }}>
                            <span className="material-symbols-outlined info-icon">help</span>
                        </OverlayTrigger>
                        <p className="sizeHint">{sessionWidth}x{sessionHeight}</p>
                        <div>
                            <Session setWidth={setSessionWidth} setHeight={setSessionHeight} name={search} settings={{hours: bufferedHours, hoursBetween: bufferedHoursBetween, color: color, demo: true, showAvg: false, dynamic: dynamic, font: font}}/>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </main>)
    }