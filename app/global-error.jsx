"use client";

import Error from "next/error";
import { useEffect } from "react";
import {reportSentryError} from '../sentry.client.bridge';

export default function GlobalError({ error }) {
  useEffect(() => {
    // Importing the SDK here compiled a second copy in the App Router layer.
    // The instrumentation owner loads and initializes it once for both paths.
    reportSentryError(error);
  }, [error]);

  return (
    <html>
      <body>
        <Error />
      </body>
    </html>
  );
}
