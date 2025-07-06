import { permanentRedirect } from 'next/navigation'

export default async function Page(
    props: {
        params: Promise<{ nick: string }>,
        searchParams: Promise<{ [key: string]: string | undefined }>
    }
) {
    const searchParams = await props.searchParams;
    const params = await props.params;
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