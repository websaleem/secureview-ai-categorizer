# SecureView

## Overview

SecureView is a Chrome Extension (Manifest V3) that gives you a clear picture of how you spend your time online. It tracks active browsing time per site, automatically categorizes every domain into one of many categories (Technology, Entertainment, Productivity, and more), and surfaces the data through a clean popup UI with daily history and search. For sites it cannot classify by rule, it falls back to Amazon Bedrock via a serverless AWS pipeline — keeping your API key out of the extension entirely. Categorization happens immediately when a page loads, driven by the content script. The popup updates live as soon as a category is written to storage. Built with pure vanilla JavaScript; no build step, no dependencies.

## Installation

Install SecureView from the [Chrome Web Store](https://chromewebstore.google.com/detail/secureview/ojhmodiiehcingcnhlglenenoemmegim).

## Loading the Extension for Testing

1. Open `chrome://extensions/` in Chrome
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory
4. After code changes, click the reload button on the extension card

## Architecture

### End-to-End Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                          │
│                                                                  │
│  ┌─────────────────┐  PAGE_READY      ┌──────────────────────┐  │
│  │ content_        │  (title+url)     │ background.js        │  │
│  │ script.js       │ ───────────────▶ │ (Service Worker)     │  │
│  │                 │  USER_ACTIVE     │                      │  │
│  │ • Sends title   │ ───────────────▶ │ • Tracks active tab  │  │
│  │   on doc ready  │                  │ • Measures dwell time│  │
│  │ • Watches <title│                  │ • Eager categorize   │  │
│  │   > for SPA     │                  │   on PAGE_READY      │  │
│  │   changes       │                  │ • Flushes every 60s  │  │
│  └─────────────────┘                  └──────────┬───────────┘  │
│                                                  │              │
│  ┌──────────────────────────────────────┐        │ categorize   │
│  │ popup.html / popup.js / popup.css    │        ▼              │
│  │                                      │  ┌─────────────────┐  │
│  │ • Category + site views              │  │ categorizer.js  │  │
│  │ • Daily history & search             │  │                 │  │
│  │ • Live-updates via                   │  │ 1. Rule-based   │  │
│  │   storage.onChanged                  │  │    (categories  │  │
│  └──────────────────────────────────────┘  │    .js)         │  │
│           ▲  storage update                │ 2. AI fallback  │  │
│           └────────────────────────────────│    for "Other"  │  │
│                                            └────────┬────────┘  │
│  ┌──────────────────────────────────────┐           │           │
│  │ shared/logger.js                     │           │           │
│  │ shared/categories.js                 │           │           │
│  └──────────────────────────────────────┘           │           │
└────────────────────────────────────────────────────┼────────────┘
                                                      │ HTTPS
                                                      │ x-origin-token
                                                      ▼
                                             ┌─────────────────┐
                                             │   CloudFront    │
                                             │  Distribution   │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │  Lambda@Edge    │
                                             │ viewer-request  │
                                             │                 │
                                             │ • Validates     │
                                             │   x-origin-token│
                                             │ • Injects real  │
                                             │   x-api-key     │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │   API Gateway   │
                                             │  (API key auth) │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │     Lambda      │
                                             │  (classifier)   │
                                             └────────┬────────┘
                                                      │
                                                      ▼
                                             ┌─────────────────┐
                                             │  Amazon Bedrock │
                                             │ (AI category    │
                                             │  inference)     │
                                             └─────────────────┘
```

The AI pipeline is only invoked for domains that fall through rule-based matching as "Other" (or for all domains when `force_cloudfront` is enabled). Results are cached in `chrome.storage.local` under `br_cat_cache` so each domain is classified at most once. The real AWS API key never leaves Lambda@Edge — the extension holds only a lightweight shared secret (`x-origin-token`).

Categorization is triggered **immediately** when the content script sends `PAGE_READY` (on `document` load complete, and again whenever `<title>` changes for SPAs). The result is written to the domain entry in `chrome.storage.local` right away, and the open popup re-renders via `storage.onChanged`.

### Extension Components

The extension has four runtime components that communicate via Chrome APIs:

**`background/background.js` (Service Worker)** — The core tracking engine. Maintains session state in `chrome.storage.session` (key: `sv_session`) so it survives service worker restarts. Tracks active tab, window focus, and idle state. On every tab switch or `PAGE_READY` message it calls `triggerEagerCategorization()`, which immediately classifies the URL+title and writes the result to the domain entry — no waiting for the alarm. Flushes accumulated dwell time to `chrome.storage.local` every 60 seconds via an alarm, and also on every tab switch. On first install (`onInstalled` reason `"install"`) opens `https://www.websaleem.com/secureview/success.html` in a new tab. `setUninstallURL` points to `https://www.websaleem.com/secureview/uninstall.html` so Chrome opens it automatically when the extension is removed.

**`content/content_script.js`** — Injected into all pages. Sends `PAGE_READY` (`{ title, url }`) to the background as soon as `document` load fires; re-sends whenever the `<title>` element changes (MutationObserver) to catch SPA navigation; re-sends on `visibilitychange` when the tab becomes visible again. Also detects user activity (mouse, keyboard, scroll) and sends `USER_ACTIVE` every 10 seconds while active.

**`popup/popup.html` + `popup.js` + `popup.css`** — The extension popup UI. Reads today's data from `chrome.storage.local` on open, renders category/site views, supports search, and shows a history overlay for past days. Subscribes to `chrome.storage.onChanged` for today's data key so the "Now:", category, and site views update live the moment the background writes a categorization result — without reopening the popup.

**`shared/logger.js`** — Loaded in all four contexts (background SW, content script, popup, categorizer). Provides `Logger.debug/info/warn/error(module, message, ...args)`. Every log line is prefixed with a timestamp (`YYYY-MM-DD HH:MM:SS.mmm`), level, and module name. Errors always print; all other levels are gated by the `debug_config` flag (see Runtime Settings Flags below).

**`shared/categories.js`** — Shared module imported by both `background.js` (via `importScripts`) and `popup.html` (via `<script>`). Defines categories with domain lists, keyword patterns, icons, and colors. Matching order: exact domain → root domain → keyword scan.

**`shared/categorizer.js`** — Imported by `background.js` via `importScripts`. Provides `categorizeUrlEnhanced(url, title)`, an async drop-in for `categorizeUrl()`. Rule-based first; for "Other" domains it calls a CloudFront distribution. Flow: `CloudFront → Lambda@Edge (viewer-request validates x-origin-token, injects real x-api-key) → API Gateway → Lambda → Bedrock`. The real API key never leaves Lambda@Edge — the extension only holds a lightweight shared secret (`x-origin-token`). Beta and prod CloudFront URLs + origin tokens are hardcoded in `CF_CONFIGS`; active env is derived from the extension name at runtime. Retries up to 2× with exponential backoff to handle Lambda@Edge cold starts. Results cached under `br_cat_cache`. Fails silently if unreachable.

AWS setup required (per env): CloudFront distribution pointing to API Gateway as origin; Lambda@Edge viewer-request function that validates `x-origin-token` and injects `x-api-key`; API Gateway with API key authorization; Lambda function that calls Amazon Bedrock for classification.

### Runtime Settings Flags

Both flags are toggled live via `chrome.storage.local` — no extension reload required. Open DevTools on any extension page (background SW, popup) and run:

| Flag | Storage key | Effect |
|---|---|---|
| Debug logging | `debug_config` | Enables/disables all `Logger.debug/info/warn` output across every context. Errors always print. On by default in beta builds; off in prod. |
| Force AI classification | `force_cloudfront` | Bypasses rule-based matching for all sites and sends every URL straight to the AWS pipeline. Useful for testing Bedrock responses against known domains. Browser-internal pages (`chrome://`, `about:`) are always classified locally regardless of this flag. |

```js
// Debug logging
chrome.storage.local.set({ debug_config: { enabled: true } })   // enable
chrome.storage.local.set({ debug_config: { enabled: false } })  // disable

// Force AI classification (skip rule-based matching)
chrome.storage.local.set({ force_cloudfront: true })   // enable
chrome.storage.local.set({ force_cloudfront: false })  // disable
```

Both flags are watched via `chrome.storage.onChanged`, so changes take effect immediately in all active contexts.

## Storage Schema

**Session state** (`chrome.storage.session`, key: `sv_session`):
```json
{ "currentUrl": "...", "activeTabId": 123, "currentTabTitle": "Page Title", "sessionStart": 1712520000000, "isWindowFocused": true, "isUserIdle": false }
```

**Daily data** (`chrome.storage.local`, key: `data_YYYY_MM_DD`):
```json
{
  "domains": { "github.com": { "seconds": 3600, "category": "Technology", ... } },
  "categories": { "Technology": { "seconds": 3600, ... } },
  "totalSeconds": 3600
}
```

## Key Timings & Thresholds

| Constant | Value | Purpose |
|---|---|---|
| Idle threshold | 60s | Chrome idle API + content script silence |
| Activity debounce | 10s | Content script `USER_ACTIVE` reporting interval |
| Flush cycle | 60s | Background alarm tick — accumulates dwell time |
| Categorization | Immediate | Triggered by `PAGE_READY` from content script on document load and `<title>` mutation |
| CloudFront timeout | 10s | Per attempt; up to 2 retries with exponential backoff |

## Important Design Constraints

- **MV3 service worker lifecycle**: The SW can be killed at any time. All mutable state must be written to `chrome.storage.session` before being read back. `ensureTracking()` re-establishes context after restarts.
- **No double-counting**: `flushTime()` advances `sessionStart` to `Date.now()` after each flush, so the same time interval is never counted twice.
- **Date partitioning**: Daily data resets automatically because storage keys use `data_YYYY_MM_DD` format — no explicit reset logic needed.
- **`shared/categories.js` is shared**: Changes to categorization logic affect both tracking (what gets saved) and display (how it's shown). Test both popup views after any change.
