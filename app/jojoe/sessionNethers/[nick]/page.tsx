import { permanentRedirect } from 'next/navigation'

export default async function Page({params, searchParams}: {
    params: { nick: string },
    searchParams: { [key: string]: string | undefined }
}) {
    let hours: number = parseInt(searchParams["hours"] || "24")
    if (isNaN(hours)) {
        hours = 24
    }
    let hoursBetween = parseInt(searchParams["hoursBetween"] || "6")
    if (isNaN(hoursBetween)) {
        hoursBetween = 6
    }
    let nick = params.nick
    permanentRedirect(`/obs/sessionNethers/${nick}/?hours=${hours}&hoursBetween=${hoursBetween}`)
}