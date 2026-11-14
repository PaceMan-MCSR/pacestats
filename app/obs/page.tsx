import ObsWrapper from "@/app/obs/ObsWrapper";

export const dynamic = "force-dynamic"

export default function Page() {
    // Search results carry their own customization or resolve the few visible
    // players through usePlayerInfo. No global user dictionary is rendered here.
    return <ObsWrapper />
}
