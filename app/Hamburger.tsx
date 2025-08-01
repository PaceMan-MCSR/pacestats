'use client'

import { useContext, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Drawer from '@mui/material/Drawer';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { Button } from "@mui/material";
import PlayerSearch from "@/app/components/PlayerSearch";
import { usePathname } from "next/navigation";
import { UserColoursContext } from "@/app/contexts";

export default function Hamburger({users, userInfo}: {users: any, userInfo: any}) {
    const [open, setOpen] = useState(false);
    const path = usePathname();
    const colours = useContext(UserColoursContext)

    useEffect(() => {
        setOpen(false);
    }, [path]);

    const toggleDrawer = (newOpen: boolean) => () => {
        setOpen(newOpen);
    };

    const DrawerList = (
        <Box sx={{
            width: 260,
            color: colours?.isCustom ? `${(colours.bgText as {color: string}).color}` : "#DDDDEE",
        }} role="presentation">
            <List>
                <ListItem disablePadding>
                    <ListItemButton href={"/stats/"}>
                        <ListItemText primary={"Leaderboards"} />
                    </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                    <ListItemButton href={"/stats/obs/"}>
                        <ListItemText primary={"OBS Overlays"} />
                    </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                    <ListItemButton href={"/stats/aa/"}>
                        <ListItemText primary={"AA Leaderboards"} />
                    </ListItemButton>
                </ListItem>
                <ListItem disablePadding>
                    <div className="searchWrapper">
                        <PlayerSearch data={users} userInfo={userInfo}/>
                    </div>
                </ListItem>
            </List>
        </Box>
    );

    return (
        <div>
            <Button onClick={toggleDrawer(true)}>
                <span className="material-symbols-outlined" style={{color: "#DDDDEE"}}>menu</span>
            </Button>
            <Drawer
                open={open}
                onClose={toggleDrawer(false)}
                sx={{
                    '& .MuiDrawer-paper': {
                        backgroundColor: colours?.isCustom ? `#${colours.bg}` : "#121215",
                        color: "rgb(230,230,230)",
                    },
                }}
            >
                {DrawerList}
            </Drawer>
        </div>
    )
}