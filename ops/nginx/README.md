# Build-aware nginx caching

The stats application has two separate caches in nginx:

- `/stats/_next/static/` serves content-hashed build assets. Keeping these
  immutable for a year is safe; each changed asset has a new URL. The build
  script retains published files for 30 days for already-open pages.
- `/stats/` caches HTML and API responses at their unchanged URLs. Next.js
  advertises a one-year shared-cache lifetime for prerendered pages without
  revalidation. This included `/stats/api/`, so its old HTML could survive a
  deployment even though the origin already served the new documentation.

The docs page now revalidates every 60 seconds. Successful `npm run build`
also generates an nginx cache namespace from `.next/BUILD_ID` and publishes it
beside the static assets. Once the following nginx change is installed, the
postbuild script tests and reloads nginx automatically. The existing deploy
command stays the same:

```sh
npm run build && systemctl restart jojoesite
```

## One-time production setup

First run the updated build to create
`/var/www/pacestats-static/nginx-cache-version.conf`. Before the include is
installed, the script only prepares the file and reports that setup is needed.

Add this directive in nginx's **`http {}` context**, outside all `server` and
`location` blocks. A file under `/etc/nginx/conf.d/` is usually included there;
verify how your nginx configuration loads that directory.

```nginx
include /var/www/pacestats-static/nginx-cache-version.conf;
```

In the existing `location /stats/` block, replace only these two directives:

```nginx
proxy_cache_key "$pacestats_cache_build|$request_uri";
proxy_no_cache $http_authorization $http_x_api_key $pacestats_cache_mismatch;
```

Keep the static alias, deny rules, upstream, forwarded headers, authorization
bypass, cache lock, stale-response settings and other headers as they are.
Then test and reload once:

```sh
nginx -t && nginx -s reload
```

The new namespace immediately stops looking up the previous URL-only entries,
including the old API docs page. Subsequent builds publish a new namespace and
reload nginx without changing the deploy command. nginx eventually expires the
unused old entries through its normal cache manager; no cache directories or
Redis data are deleted.

## Why build and restart order is safe

Every built response carries `X-PaceStats-Build`, fixed in that build's route
manifest. The generated nginx include also checks this response header.
Between the build and `systemctl restart`, the old app may still answer, but
nginx does not store its responses in the new namespace. After restart, the
matching new build fills the new namespace normally. Static assets keep their
existing immutable URLs and are not invalidated.

If nginx is unable to reload, the build script fails and restores the previous
published include when one existed. The `&&` deployment command therefore does
not proceed to restart the app after a failed cache activation. The build user
needs permission to test and reload nginx, just as for the initial setup.

## Settings and verification

The script loads the normal environment files; explicit process environment
variables take precedence.

| Setting | Default | Purpose |
| --- | --- | --- |
| `PACESTATS_STATIC_DIR` | `/var/www/pacestats-static` | Existing shared asset directory; contains the generated nginx include. Match the nginx include path when changing it. |
| `PACESTATS_NGINX_BIN` | Auto-detect `nginx` | nginx executable used for configuration testing and reload. |
| `PACESTATS_NGINX_RELOAD` | Automatic | `1` requires configured cache activation and fails if unavailable; `0` only prepares/publishes the include, for builds where nginx is managed separately. |

Local builds without the shared directory still generate
`.next/nginx-cache-version.conf` and need no nginx installation. Builds on a
separate machine can deploy that include to the nginx host and test/reload it
there; restart the origin with the matching build.

After a deploy, check the response headers:

```sh
curl -sI https://paceman.gg/stats/api/
curl -sI https://paceman.gg/stats/api/
```

The page should contain the new endpoint documentation, `X-PaceStats-Build`
should match the deployed `.next/BUILD_ID`, and a newly activated namespace
normally transitions from `X-Cache-Status: MISS` to `HIT`. The docs advertise
`s-maxage=60`; development responses deliberately do not use production caching.

Run `node tests/build-cache.mjs` for isolated build-script checks. No production
nginx configuration or cache is changed by these tests.
