# wp-doctor

**Find out why a WordPress site is slow, from the outside, in seconds.** As a command-line tool, or as an MCP server
that lets an AI agent run the checks and propose fixes.

`wp-doctor` checks any public WordPress site without logging in or installing anything on it. It looks for the
problems that keep real sites slow even when "the cache is on": a cache that every visitor with a cookie skips, ad
traffic that never hits the cache, a viewport tag that makes phones download desktop images, reCAPTCHA on every page.

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

## Why these checks

They come from optimizing production WordPress portals, where the obvious fixes were already done and the site was
still slow. The full story is in [this case study](https://github.com/andrea-sofia-dev/wordpress-performance-case-study).

| Check | What it catches |
| --- | --- |
| Server response time | Time to the first byte on a repeat visit (good ≤ 0.8 s, poor > 1.8 s, as on web.dev) |
| Page cache | No page cache, or a cache that skips **visitors with any cookie** (consent banners set one on almost everyone) or **visits with UTM parameters** (every ad and newsletter click) |
| Compression | HTML sent without gzip or Brotli |
| Viewport meta tag | A viewport tag printed after stylesheets or preloads, so phones briefly lay out the page at 980 px |
| Main image priority | No preload and no `fetchpriority="high"` for the hero image |
| Render-blocking files | Scripts in `<head>` without `defer` or `async` |
| reCAPTCHA | reCAPTCHA loaded on pages with no form, or before anyone touches the form |
| Plugin files | How many CSS/JS files each plugin adds to the page |

Cache detection understands Cloudflare, LiteSpeed, nginx/FastCGI caches, WP Super Cache, W3 Total Cache, WP Rocket
and the `Age` header. When a site gives no signal, wp-doctor says so instead of guessing.

## Usage

```
npx github:andrea-sofia-dev/wp-doctor <url> [--json] [--html[=file]]
```

- `--json` prints machine-readable results, handy in CI.
- `--html` also saves a self-contained HTML report (light and dark mode, no external files) to send to a client or attach to a ticket. `--html=report.html` picks the file name.
- Exit code `0` if nothing failed, `1` if a check failed, `2` if the site could not be reached.

Requires Node.js 20 or later. No dependencies.

wp-doctor sends four ordinary GET requests (a first visit, a repeat visit, one with a cookie, one with UTM
parameters) and identifies itself in the User-Agent. Only run it on sites you own or are allowed to test.

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
| `check_site` | Runs every check on a URL and returns the report and the results as JSON |
| `list_checks` | Lists the checks and their ids |
| `explain_check` | Why a check matters, how to verify it by hand, and the usual fixes per stack |

All tools are read-only: the server only sends GET requests to the URL you give it. It has no dependencies; it speaks
JSON-RPC over stdio.

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
