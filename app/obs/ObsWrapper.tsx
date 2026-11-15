'use client'
import ResetScroll from "@/app/components/ResetScroll";
import PlayerSearch from "@/app/components/PlayerSearch";
import {ChangeEvent, memo, useMemo, useState} from "react";
import { OverlayTrigger, Tooltip } from "@/app/components/HoverTooltip";
import SessionNethers from "@/app/obs/sessionNethers/[nick]/SessionNethers";
import Session from "@/app/obs/session/[nick]/Session";
import MaterialIcon from "@/app/components/MaterialIcon";
import FontPicker from "@/app/obs/FontPicker";
import {useFrameState} from './useFrameState';
import {ColorInput, ColorPicker} from '@/app/obs/ObsColorPicker';
import {MAX_OVERLAY_AVERAGE_DECIMALS, MAX_OVERLAY_HOURS, MAX_OVERLAY_NPH_DECIMALS, overlayInteger} from './numericSettings';

const SessionPreview = memo(Session);
const NethersPreview = memo(SessionNethers);

// Both controls are always visible. Include their small module in this route
// so the browser does not discover another required script after hydration.

export default function ObsWrapper() {
    const [search, setSearch] = useState("")
    const [color, colorUpdate] = useFrameState("#000000")
    const [hours, setHours] = useState(24)
    const [hoursBetween, setHoursBetween] = useState(2)

    const [bufferedHours, setBufferedHours] = useState(hours)
    const [bufferedHoursBetween, setBufferedHoursBetween] = useState(hoursBetween)

    const [font, setFont] = useState("Minecraft")

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

    // Draft hours, copy feedback, scene names and preview measurements do not
    // change either overlay. Keep their SWR/socket/render trees untouched.
    const nethersSettings = useMemo(() => ({
        hours: bufferedHours, hoursBetween: bufferedHoursBetween, color,
        demo: true, font, nph, liveOnly: false,
        decimals: avgDp, nphDp, nphRight,
    }), [bufferedHours, bufferedHoursBetween, color, font, nph, avgDp, nphDp, nphRight]);
    const sessionSettings = useMemo(() => ({
        hours: bufferedHours, hoursBetween: bufferedHoursBetween, color,
        demo: true, showAvg: false, dynamic, font,
    }), [bufferedHours, bufferedHoursBetween, color, dynamic, font]);

    const url = `https://mc-api.io/render/FACE/${search}/JAVA?size=8`

    const [netherUrl, sessionUrl] = useMemo(() => [
        `${process.env.NEXT_PUBLIC_HOSTNAME}/stats/obs/sessionNethers/${search}/?hours=${hours}&hoursBetween=${hoursBetween}&color=${color.replace("#", "")}&font=${font}&nph=${nph}&nphRight=${nphRight}&dp=${avgDp}&nphDp=${nphDp}&wallScene=${wallScene}&playingScene=${playingScene}`,
        `${process.env.NEXT_PUBLIC_HOSTNAME}/stats/obs/session/${search}/?hours=${hours}&hoursBetween=${hoursBetween}&color=${color.replace("#", "")}&font=${font}&dynamic=${dynamic}`,
    ], [search, hours, hoursBetween, color, font, nph, nphRight, avgDp, nphDp, wallScene, playingScene, dynamic]);

    const changeHours = (event: ChangeEvent<HTMLInputElement>) => {
        setHours(overlayInteger(event.currentTarget.value, 24, 1, MAX_OVERLAY_HOURS));
    }

    const changeHoursBetween = (event: ChangeEvent<HTMLInputElement>) => {
        setHoursBetween(overlayInteger(event.currentTarget.value, 2, 0, MAX_OVERLAY_HOURS));
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
                        <p>If you can&apos;t find your name, make sure you have previously entered the nether with PaceMan</p>
                    </div>
                </div>
            )}
            <div className="row justify-content-center">
                <div className="col-11 col-md-8 col-lg-7 col-xl-6">
                    <div className="settings row">
                        <div className="col">
                            <img className="avatar" src={url} alt={search}/>
                            <div className="nameSearch">
                                <PlayerSearch input={search} setOutput={setSearch} />
                            </div>
                            <OverlayTrigger overlay={
                                <Tooltip className="hoursTooltip">
                                    <p>Number of hours to include stats for</p>
                                </Tooltip>
                            } delay={{ show: 100, hide: 50 }}>
                                <label>Time period:</label>
                            </OverlayTrigger>
                            <input type="number" defaultValue={24} placeholder="24" className="form-control hours"
                                aria-label="Time period (hours)" min={1} max={MAX_OVERLAY_HOURS} step={1}
                                onChange={changeHours} onBlur={event => {event.currentTarget.value = String(hours);}} />
                            <br/>
                            <OverlayTrigger overlay={
                                <Tooltip className="hoursTooltip">
                                    <p>Max number of hours between runs in a session<br/>Set this to a high number (e.g 9999) to ignore sessions<br/>and include all runs for a given time period</p>
                                </Tooltip>
                            } delay={{ show: 100, hide: 50 }}>
                                <label>Max session break:</label>
                            </OverlayTrigger>
                            <input type="number" defaultValue={2} placeholder="2" className="form-control hours"
                                aria-label="Max session break (hours)" min={0} max={MAX_OVERLAY_HOURS} step={1}
                                onChange={changeHoursBetween} onBlur={event => {event.currentTarget.value = String(hoursBetween);}} />
                            <br/>
                            <button style={{display: hours !== bufferedHours || hoursBetween !== bufferedHoursBetween ? "block" : "none"}} className="btn btn-primary" onClick={pushHours}>Preview updated hours</button>
                            <FontPicker output={setFont}/>
                        </div>
                        <div className="colorSection col-5 col-xl-5 col-xxl-4" onPointerUpCapture={colorUpdate.flush}>
                            <label>Text color:</label>
                            <div className="colorPicker">
                                <ColorPicker color={color} onChange={colorUpdate.schedule} />
                            </div>
                            <div className="colorPickerInput">
                                <ColorInput color={color} onChange={colorUpdate.immediately} />
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
                                <input type="number" defaultValue={avgDp} placeholder="0" className="form-control avgDp"
                                    min={0} max={MAX_OVERLAY_AVERAGE_DECIMALS} step={1}
                                    onChange={event => setAvgDp(overlayInteger(event.currentTarget.value, 0, 0, MAX_OVERLAY_AVERAGE_DECIMALS))}
                                    onBlur={event => {event.currentTarget.value = String(avgDp);}} />
                            </label>
                            <label>
                                NPH
                                <input type="number" defaultValue={nphDp} placeholder="0" className="form-control nphDp"
                                    min={0} max={MAX_OVERLAY_NPH_DECIMALS} step={1}
                                    onChange={event => setNphDp(overlayInteger(event.currentTarget.value, 0, 0, MAX_OVERLAY_NPH_DECIMALS))}
                                    onBlur={event => {event.currentTarget.value = String(nphDp);}} />
                            </label>
                            <br/>
                        </div>
                        <div>
                            <NethersPreview name={search} settings={nethersSettings}/>
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
                            <MaterialIcon icon="help" className="info-icon"/>
                        </OverlayTrigger>
                        <p className="sizeHint">{sessionWidth}x{sessionHeight}</p>
                        <div>
                            <SessionPreview setWidth={setSessionWidth} setHeight={setSessionHeight} name={search} settings={sessionSettings}/>
                        </div>
                    </div>
                </div>
            )}
        </div>
    </main>)
    }
