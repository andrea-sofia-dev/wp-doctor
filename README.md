# wp-doctor

**PageSpeed tells you the server is slow. wp-doctor tells you why, and whether your real visitors get the cache.**

PageSpeed Insights tests a clean visit: no cookies, no campaign parameters. Real visitors are different. Most of them
have accepted a cookie banner, and every ad or newsletter click carries `utm_*` parameters. On many WordPress sites
those visitors skip the page cache and get the slow page, while PageSpeed shows you a fast one.

wp-doctor checks a public site from the outside, the way those visitors reach it, in a few seconds and without
installing anything on the site. It works on any site; on WordPress it does more (plugin files, cache plugins,
WordPress-specific fixes). Try it in the browser at **[wp-doctor.vercel.app](https://wp-doctor.vercel.app)**, use it as a command-line tool, or as an MCP server that lets an AI agent
run the checks and propose fixes for your stack.

Example output:

```
$ npx github:andrea-sofia-dev/wp-doctor example-site.com

wp-doctor · https://example-site.com/

✔ Server response time: The HTML starts arriving after 122 ms (repeat visit).
    first request: 665 ms
! Page cache: Campaign parameters (utm_*) skip the cache, so ad and newsletter traffic gets the slow page.
    cache layers seen: Cloudflare
    repeat visit: HIT (122 ms) — cf-cache-status: HIT
    visitor with a cookie: HIT (126 ms)
    visit with UTM parameters: MISS (690 ms)
    → Skip the cache only for logged-in users, and tell the cache to ignore utm_*, fbclid, gclid and similar parameters.
✔ Compression: HTML is compressed with br (151 KB uncompressed).
! Viewport meta tag: The viewport tag comes after 6 stylesheet/preload tags. Until a phone reads it, media queries
  run as if the screen were 980 px wide, so it may download desktop images too.
✔ Main image priority: The page marks an image as important (fetchpriority="high").
! Render-blocking files: 5 blocking script(s) and 9 stylesheet(s) in <head>.
! reCAPTCHA: reCAPTCHA loads on a page with no form.
i Plugin files: 14 plugins load 31 CSS/JS files on this page.

3 passed · 4 warnings · 0 failed
```

## What it checks

It comes from optimizing production WordPress portals, where the obvious fixes were already done and the site was
still slow. The full story is in [this case study](https://github.com/andrea-sofia-dev/wordpress-performance-case-study).

**What PageSpeed won't tell you**

| Check | What it catches |
| --- | --- |
| Page cache after the cookie banner | wp-doctor recognises the site's banner (iubenda, Cookiebot, Complianz, CookieYes, OneTrust, Borlabs, CookieLawInfo, Cookie Notice) and sends **the cookie a visitor has after accepting it**. Many caches skip exactly those visitors |
| Page cache for ad and newsletter traffic | A cache that is skipped by **visits with UTM parameters**, so every campaign click gets the slow page |
| Cache on phones | Phones that miss the cache computers get, and `Vary: User-Agent` splitting the cache into countless copies |
| Other pages | A few pages from the sitemap, because the home page is often the only well-cached one |
| Missing pages (404) | "Soft 404s" that answer 200, and 404s cached for hours that hide pages published later |
| Which cache, and whether it hit | HIT or MISS, and which layer answered: Cloudflare, LiteSpeed, nginx, WP Super Cache, W3 Total Cache, WP Rocket |
| Viewport tag position | A viewport tag printed after stylesheets or preloads, so phones briefly lay out the page at 980 px and may download desktop images |
| Fixes for your stack | Through the MCP server, the exact setting to change in WP Super Cache, W3 Total Cache, LiteSpeed, Cloudflare, nginx or the theme |

**Also checked**, so you get the full picture in one command

| Check | What it catches |
| --- | --- |
| Server response time | Time to the first byte on a repeat visit (good ≤ 0.8 s, poor > 1.8 s, as on web.dev) |
| Compression | HTML sent without gzip or Brotli |
| Main image priority | No preload and no `fetchpriority="high"` for the hero image |
| Render-blocking files | Scripts in `<head>` without `defer` or `async` |
| reCAPTCHA | reCAPTCHA loaded on pages with no form, or before anyone touches the form |
| Plugin files | How many CSS/JS files each plugin adds to the page |

Cache detection understands Cloudflare, Fastly, CloudFront, Akamai, Vercel, Netlify and the standard `Cache-Status`
header, Varnish, nginx/FastCGI, LiteSpeed, Sucuri, managed WordPress hosts (WordPress VIP, Kinsta, WP Engine,
Hostinger), WP Super Cache, W3 Total Cache, WP Rocket and the `Age` header. When a site gives no signal, wp-doctor says
so instead of guessing. If a site blocks automated requests, wp-doctor stops after two requests and says so, instead
of analysing the error page.

## Usage

```
npx github:andrea-sofia-dev/wp-doctor <url> [--json] [--html[=file]] [--pages=N] [--browser | --no-browser]
```

- `--pages=N` also checks N pages from the sitemap (default 3, `--pages=0` to skip).
- `--json` prints machine-readable results, handy in CI.
- `--html` also saves a self-contained HTML report (light and dark mode, no external files) to send to a client or attach to a ticket. `--html=report.html` picks the file name.
- `--browser` sends every request through Chrome; `--no-browser` never uses it (see below).
- Exit code `0` if nothing failed, `1` if a check failed, `2` if the site could not be reached.

Requires Node.js 20 or later (22 for browser mode). No dependencies.

wp-doctor sends ordinary GET requests, one after the other: the page twice, once with the banner's consent cookie,
once with UTM parameters, twice as a phone, a missing page twice, robots.txt and the sitemap, and each sampled page
twice (about 17 requests with the defaults). It identifies itself in the User-Agent. Only run it on sites you own or
are allowed to test.

### Sites that refuse plain requests

Some bot protections (Cloudflare bot management, Akamai, AWS WAF) refuse anything that is not a browser, whatever it
is called: they look at how the connection is made. When that happens, wp-doctor runs the same checks again through a
real Chrome (or Chromium, or Edge) installed on your computer:

- each visit starts from a clean profile, like a new visitor, and loads only the HTML document: no images, scripts or
  styles, so the site gets the same requests as in plain mode;
- the User-Agent is Chrome's own, followed by `wp-doctor/1.2`: it still says who is asking;
- the report says it was checked with a browser. Response times leave out the connection setup, so they compare
  with plain mode (on sites that accept both, the verdicts are the same).

It does not solve CAPTCHAs or "are you human?" challenges: a site that shows one stays "could not be checked".

## Use it from Claude (MCP server)

wp-doctor includes a [Model Context Protocol](https://modelcontextprotocol.io) server, so an AI agent can audit a site
and explain the fixes for your stack (WP Super Cache, W3 Total Cache, LiteSpeed, Cloudflare, nginx, theme code).

**Claude Code**

```
claude mcp add wp-doctor -- npx -y -p github:andrea-sofia-dev/wp-doctor wp-doctor-mcp
```

**Claude Desktop** (or any MCP client): add this to the MCP servers configuration.

```json
{
  "mcpServers": {
    "wp-doctor": {
      "command": "npx",
      "args": ["-y", "-p", "github:andrea-sofia-dev/wp-doctor", "wp-doctor-mcp"]
    }
  }
}
```

Then ask, for example: *"Check example.com with wp-doctor and tell me how to fix the cache on WP Super Cache."*

| Tool | What it does |
| --- | --- |
| `check_site` | Runs every check on a URL (optionally `pages`: how many sitemap pages to add) and returns the report and the results as JSON |
| `list_checks` | Lists the checks and their ids |
| `explain_check` | Why a check matters, how to verify it by hand, and the usual fixes per stack |

All tools are read-only: the server only sends GET requests to the URL you give it. It has no dependencies; it speaks
JSON-RPC over stdio.

## Web version

The same checks run in the browser at [wp-doctor.vercel.app](https://wp-doctor.vercel.app): paste an address, follow the progress live, get a score, the results with the
background and fixes for each check, a link to share and the JSON.

- `public/` is the page (no frameworks, no third-party scripts or fonts), `api/check.js` the Vercel function,
  `web/handler.js` the logic they share. The answer streams as newline-delimited JSON, one line per step.
- Because the server sends the requests, it only checks public sites: no IP addresses or local names, nothing that
  resolves to a private network, standard ports only. The same rule applies to every redirect it follows.
- Sites that refuse plain requests are checked again through Chromium
  ([@sparticuz/chromium](https://github.com/Sparticuz/chromium), a development dependency used only by the Vercel
  function: the command-line tool still installs nothing).
- Each check sends about twenty requests to the site, so there is a limit of 10 checks per 10 minutes per visitor,
  and a site checked again within 10 minutes gets the stored result. The terminal version has no limits.

Run it locally with no extra dependencies:

```
npm run web
```

then open http://localhost:8787.

## Roadmap

- Before/after cookie consent, in a real browser
- Lighthouse on mobile with heavier CPU throttling (×12), closer to mid-range Android phones

## How it's built

I build with an agentic workflow: Claude Code writes and tests the code, I set the design, the rules and review
every change. The test suite runs the real collector against fake sites on localhost, so it needs no network.

```
npm test
```

## License

MIT © Andrea Sofia
