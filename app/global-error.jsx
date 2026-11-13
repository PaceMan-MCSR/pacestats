"use client";

import Error from "next/error";
import { useEffect } from "react";

export default function GlobalError({ error }) {
  useEffect(() => {
    // Loaded here instead of imported at the top: a static import put the
    // Sentry SDK (about 58 KB) into the first load of every page. This is the
    // same trimmed module the rest of the site loads on idle; importing the
    // whole "@sentry/nextjs" namespace here would build a second, much larger
    // copy with session replay and the feedback widget in it.
    void import("../sentry.client.lazy").then((sentry) => {
      sentry.initSentry();
      sentry.captureException(error);
    });
  }, [error]);

  return (
    <html>
      <body>
        <Error />
      </body>
    </html>
  );
}
