"use client"

import {useEffect} from 'react';

function BootstrapLoader() {
    useEffect(() => {
        require('bootstrap/dist/js/bootstrap.bundle.min.js');
    }, []);
    return null;
}

export default BootstrapLoader;