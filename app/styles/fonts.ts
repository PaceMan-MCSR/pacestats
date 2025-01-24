import localFont from 'next/font/local'
import {Inter} from "next/font/google";

const mcFont = localFont({ src: './Minecraftia.ttf' })
const mcFontObs = localFont({ src: './Minecraftia.ttf' })

const inter = Inter({subsets: ["latin"]});


export { mcFont, mcFontObs, inter }