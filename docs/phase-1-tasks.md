# Phase 1 tasks

Phase 1 (Oct 2026 – Apr 2027) tags every link and QR code with the labels each team needs (such as store, channel and campaign), routes each scan to the right store or page, and reports the results. Go-live target: end of Feb 2027. See [linktrace-roadmap.drawio](linktrace-roadmap.drawio) for all phases.

**Scope of our side:** every QR code carries the right labels and redirects correctly. How many QR codes to print, and how, is marketing's decision.

**Labels are configurable, not fixed.** Each workspace defines its own tracking parameters (a retailer might add `store_code`, an events team `event_id` and `booth_id`, another team none). No business-specific field is hard-coded and no database column is added per parameter.

## How the new parts fit with what exists

| Concept | What it is | Where it lives |
|---|---|---|
| Workspace | The tenant. Every parameter, option, link and placement belongs to one | `workspaces` (exists) |
| Tag | Free-text platform label on a link (`email`, `lark`), up to 12 per link, each with its own URL `/r/<slug>/<tag>`. No longer added from the app; existing ones keep working and are listed as "Older tag links" | `links.tags`, `clicks.tag` (exists, unchanged) |
| Tracking parameter | A workspace's definition of a label: name, stable key, type (text, dropdown, later reference list), active, order. Always optional. Shown in the app as a **label** | `tracking_parameters` (new) |
| Parameter option | A predefined value of a dropdown parameter, such as one store code | `tracking_parameter_options` (new) |
| Placement | An extra short link `/q/<code>` to a link's destination, with fixed parameter values and its own QR code; used in print, email, chat or anywhere else. Shown in the app as a **labelled link**, named from its labels | `placements`, `placement_values` (new) |

Tags and parameters stay separate. Tags are never changed or removed. The optional `npm run tags:migrate` script adds a `platform` dropdown parameter and one placement per link and tag alongside them (preview by default, `--apply` to run, `--undo` to remove what it made).

## A. Requests to other teams (start now)

These have long waiting times and run alongside the build.

| # | Task | With | Blocks | Status |
|---|---|---|---|---|
| A1 | Send the PDPA note: what scan data is stored, why, where, and for how long | Legal / DPO | Go-live, task 9 | Not started |
| A2 | Request the branded short domain for QR codes | IT | Task 13, any printing | Not started |
| A3 | Request AWS access, reusing the translation project's setup | IT | Tasks 10–12 | Not started |

## B. Build tasks (in order)

Sizes: S = 1–2 days, M = 3–5 days, L = about a week.

| # | Task | Size | Depends on | Status |
|---|---|---|---|---|
| 1 | Save the scan after the redirect is sent (`after()`), so a slow database never delays the visitor | S | – | Done |
| 0 | **Regression baseline:** add a test runner and tests for today's behaviour: create link with tags, `/r/<slug>` and `/r/<slug>/<tag>` redirect and record clicks, unknown tag returns 404, HEAD and prefetch not counted, workspace access by role. Run before every later task (`npm test`) | S–M | – | Done |
| 2a | **Parameter definitions (backend):** `tracking_parameters` and `tracking_parameter_options` tables per workspace; key unique per workspace regardless of case and fixed after creation; archive instead of delete once used; server-side validation of values; audit log entries. Migration `0007_tracking_parameters` | M | 0 | Done |
| 2b | **Parameter management page:** workspace members list, search, create, edit, activate or deactivate parameters, set order; for dropdowns add, edit, deactivate, reorder options and import options by paste or CSV. At `/parameters` and `/workspaces/<id>/parameters` | M | 2a | Done |
| 3 | **Placements:** `placements` table (short code, link, name, status) and `placement_values` (placement, parameter, value or option); short `/q/<code>` route; `placement_id` on clicks; short code unique with retry on collision. Existing `/r/<slug>/<tag>` links keep working | M | 2a | Done |
| 4 | **Placement form:** on a link, create placements with fields rendered from the workspace's active parameters (in order), review before saving, list placements, QR code per placement. A workspace with no parameters can still create a placement | M | 2b, 3 | Done |
| 5 | **Bulk QR:** upload a CSV whose columns are parameter keys, preview the row count and errors, create only the rows given (no automatic combinations), download a zip of labelled QR codes plus a CSV mapping each code to its URL and values | M | 4 | Done |
| 5a | **Labelled links in the forms:** one flow on the create-link form (behind "+ Add labelled links") and the link page. Add a label and all its active options start ticked; untick what is not needed (searchable checkbox list). Every combination of the ticked values becomes one labelled link, shown as a live count ("2 Store × 2 Channel = 4") with a preview, up to 5,000 per create. Several are made by bulk jobs of up to 1,000 each, each with a PNG or SVG zip. No nickname: rows are named from their labels. Tag form removed; links with tags list them read-only | M | 4, 5 | Done |
| 5b | **Labels at visit time:** a link can accept labels in its address, `/r/<slug>?store_code=KL001&channel=email`, so digital shares (email, chat, ads) need no labelled link per value. Off by default per link (rule 3). Values are checked against the workspace's active labels at visit time: unknown keys are ignored, unknown dropdown values are kept and reported as "Unrecognised", never dropped. Stored per click in a new table (rule 2). Link page gets a "copy link with labels" helper. Labelled links stay the choice for print (short, cannot be edited) | M | 3 | Awaiting sign-off |
| 6 | **Routing by device:** iOS, Android and fallback URLs per link, set by whoever creates the link; store OS and device type on each scan | M | 3 | Next |
| 7 | **Reports:** filter and group by any parameter (from labelled links, and from the address if 5b is built), tag and device; label unique visitors as estimated; CSV export. Renamed parameters show their current name; archived ones still report. **Done so far:** a Report tab on each link (group by up to 3 labels, filter by any labels and values — any value within a label, all labels together — 7/30/90 days or all time, main link shown apart, CSV export with the same filters), read from daily totals (`click_daily`, filled hourly by the `click-rollup` job) plus today's clicks, so a report never scans a link's whole history. Labelled links are paged (25 a page) with search and a status filter, using shared list controls (`components/list-controls.tsx`). The Overview tab, dashboard and link list read the same totals, in each workspace's reporting timezone. The Overview has a period (today, 7/30/90 days, all time) with the change from the period before, an hourly/daily/monthly trend, and top cards per label and for all labels combined; each viewer picks which cards show (saved in their browser). **Left:** the same report across a workspace's links, device, tags, date picker | L | 3, 6, 5b if approved | In progress |
| 8 | **Bot and data-centre filtering:** cloud IP ranges with a refresh script (excluding iCloud Private Relay), burst flag, internal-traffic exclusion; flagged scans shown separately, never deleted | M | 3 | |
| 9 | **PDPA changes:** IP masking or retention job, privacy notice link | S–M | A1 feedback | |
| 10 | **Location without Vercel:** CloudFront geo headers or a GeoIP database | S | A3 | |
| 11 | **CI/CD:** lint, type check, tests from task 0, migrations, deploy | S | A3, 0 | |
| 12 | **Production on AWS:** server, PostgreSQL, migrations, monitoring | M | 10, 11 | |
| 13 | **Branded domain live** on production with HTTPS | S | 12, A2 | |
| 14 | **Real-phone scan testing:** camera, Google Lens, in-app browsers; confirm real scans are not counted as bots | S | 6, 8, 13 | |
| 15 | **UAT with marketing:** one campaign from CSV to QR files to report | S | 0–14 | |
| 16 | Go-live, pilot, hypercare | – | 15, PDPA sign-off | |

**Critical path:** 0 → 2a → 2b and 3 → 4 → 5 → 5b (if approved) → 7. Decide 5b before starting 7, since it changes where report values come from. Tasks 6 and 8 can follow task 3 in any order. Tasks 9–13 depend on other teams' timing.

**Later (not Phase 1 unless needed):** a "reference list" parameter type that points to a shared table, if a company-wide list is ever needed; rules-based bulk generation; more field types (number, date).

## Rules: do not break existing links

LinkTrace is already in use for tracking button clicks. Every task must follow these rules.

1. `/r/<slug>` and `/r/<slug>/<tag>` keep working. New QR codes use `/q/<code>`.
2. Schema changes only add: new tables, and new columns that are nullable or have defaults. No renames, drops or rewrites of existing data.
3. A link without device URLs, parameters or placements behaves exactly as today. Creating a link never requires a label, and every label is optional on labelled links.
4. Tags keep their current meaning and storage. Nothing changes or removes them; the tag script only adds placements next to them.
5. A parameter or option that has been used is archived, never deleted. Its key never changes, so old scans still report correctly.
6. Bot and data-centre filtering writes to a new flag column; `is_bot` and historical counts stay unchanged.
7. Any change to stored data (such as IP masking for PDPA) is applied only after the DPO decides, and current users are told first.
8. Before each deploy, the task 0 tests pass and an existing redirect link and a tag link still redirect and still record clicks.

## Open decisions

- [ ] **Labels at visit time (task 5b):** build it in Phase 1? If yes, confirm:
  - it is off by default and turned on per link
  - it works on `/r/<slug>` only, not on labelled links (`/q/<code>` keeps its fixed labels)
  - unknown dropdown values are recorded and shown as "Unrecognised" rather than rejected
  - the PDPA note (A1) mentions that labels in the address are stored with each visit

## Decisions made

| Decision | Reason |
|---|---|
| Every workspace member manages its tracking parameters and options for now, and is responsible for their correctness. The rule lives in one place (`lib/permissions.ts`) | Marketing self-serves; role-based control will narrow it later without code changes elsewhere |
| Parameters are defined per workspace, not hard-coded as store, channel and campaign | Different teams need different labels; no code or column changes per team |
| No built-in store, channel or campaign field; each workspace defines the parameters it needs (a store list is just a dropdown parameter whose options are imported from CSV) | Teams manage their own labels; no stores module to build or maintain |
| Parameter values are stored on placements only, not on the link | One link can have many QR codes with different labels; the create-link form stays as it is today |
| Tags stay separate from parameters; converting them is an optional, reversible script | Tags are already in use with their own URLs and reports; the script adds placements without changing what exists |
| A placement's labels are fixed once created; deactivate it and create a new one instead | Changing labels would rewrite the meaning of its past scans |
| Inactive placements keep redirecting and counting scans | Their QR codes may already be printed |
| A link with placements cannot be moved to another workspace | Its labels use the original workspace's parameters |
| Placements are created by editors and owners (`placements.manage`) | Same as creating links and adding tags today |
| The app no longer adds tags. The create-link form offers optional labelled links instead; links that already have tags keep their addresses and stats, listed read-only as "Older tag links" | One way to label traffic (a Channel label replaces tags); existing tag links, addresses and stats are unchanged |
| Adding a label ticks all its active options; every combination of the ticked values is one labelled link, with the count and a preview shown before creating, up to 5,000 per create | One flow for short lists (channels) and long ones (1,000 outlets); the visible count stops surprise volume. Replaces "one QR code per placement, not every combination" |
| Every label is optional: no "required" setting, and none is enforced in the forms or CSV uploads. The `is_required` column stays (rule 2) and is saved off | People pick the labels each set of links needs; a required label made the optional section contradict itself |
| A link has at most one active labelled link per name and set of labels (case ignored), enforced by the database (`placements.label_key`, unique among active ones). Single adds are refused with the existing link's address; batches and CSV uploads skip the ones that exist; re-activating is refused while another active one has the same labels. Deactivated ones do not count, so a printed code can still be replaced | Two with the same labels cannot be told apart in lists or reports. Active duplicates made before the rule keep working: the oldest of each keeps its key, the others have none until deactivated |
| The forms do not ask for a name; a labelled link is named from its labels. CSV uploads may still set one | Labels already say what the link is for; a free-text name was confused with them |
| The app calls placements "labelled links" and parameters "labels"; code, tables and URLs keep their names | Plain words for marketing; renaming code or tables would break rule 2 for no gain |
| Background jobs go through one job catalog (`lib/jobs/catalog.ts`) and one setting, `QUEUE_DRIVER`: `inline` (default, runs in the app after the response, works on Vercel), then `pgboss` (Postgres queue + `npm run worker`), then later `bullmq` (Redis) | The PoC needs no worker or Redis; each step up changes the setting and adds a driver, not the app |
| Bulk uploads keep their zip for 7 days, then only the placements remain | Zips are stored in the database until file storage (S3) is set up |
| Clicks are a job like any other (`record-click`): saved right after the redirect with `inline`, in worker batches with a queue | One path for every job; with a worker queue a click that cannot be queued is saved directly |
| A parameter's key and field type are fixed once created; its name and description can change. An option's value (code) is fixed; its label can change. To fix a wrong code, deactivate it and add a new one | Renaming must not break existing placements or reports |
| Parameters and options are deactivated, never deleted, from the app | Keeps history intact without checking whether something was used |
| Limits: 30 parameters per workspace, 5,000 options per parameter, 2,000 options per import | Covers a full store list while keeping pages and imports fast |
| No preview or similar-name checks on import; only case-insensitive unique codes and keys | Keeps tasks 2a and 2b small; owners own data quality |
| Link creators enter the App Store, Play Store and fallback URLs themselves | No dependency on the app team for routing |
| If the destination lookup fails, show an error page instead of a fallback redirect | Redirecting somewhere other than the real destination is not wanted |
| Each workspace has a reporting timezone (default `Asia/Kuala_Lumpur`, set by org admins on the workspace page). Its days, "today", the last 7 days, charts and report periods start at local midnight there; changing it recounts past days in the background (`rebuild-totals`), as does moving a link to another workspace. Pages name the zone, and times show their UTC offset ("14:05 GMT+8") | Teams in different countries each see their own working day, like an AppsFlyer app or Google Analytics property timezone. Per-viewer zones would need hourly totals: up to 24× the rows, weaker visitor counts, and half-hour zones still misaligned |
| Overview, dashboard, link list, report and labelled-link counts all read the same daily totals (`lib/daily-totals.ts`): `click_daily_link` (per link), `click_daily_dim` (per tag, country, referrer) and `click_daily` (per labelled link). Only the newest 50 visits are read from clicks | One source for every count, so pages agree; the old `link_detail()` function and `link_summaries` view stay in the database unused (rule 2) |
| Reports read daily totals per link, labelled link and local day; only clicks after the last rolled-up day are read raw. The rollup redoes the last 2 days each run. Visitors are distinct per day and summed over the period | Report cost stays near one day of clicks however much history a link has. A visitor returning on another day counts again; exact uniques over long periods would need a full scan or a HyperLogLog extension. Clicks saved more than 2 days late (a long queue outage) need a manual re-run of the rollup |
| Unique visitors are reported as an estimate | The visitor cookie resets when cookies are cleared or browsers change; no fingerprinting |
| Bot and data-centre filtering is in Phase 1; ad fraud checks stay in Phase 3 | Email link scanners and bots inflate counts now; ad fraud only matters with paid ads |
