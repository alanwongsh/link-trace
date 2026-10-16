# Phase 1 tasks

Phase 1 (Oct 2026 – Apr 2027) tags every link and QR code with the labels each team needs (such as store, channel and campaign), routes each scan to the right store or page, and reports the results. Go-live target: end of Feb 2027. See [linktrace-roadmap.drawio](linktrace-roadmap.drawio) for all phases.

**Scope of our side:** every QR code carries the right labels and redirects correctly. How many QR codes to print, and how, is marketing's decision.

**Labels are configurable, not fixed.** Each workspace defines its own tracking parameters (a retailer might add `store_code`, an events team `event_id` and `booth_id`, another team none). No business-specific field is hard-coded and no database column is added per parameter.

## How the new parts fit with what exists

| Concept | What it is | Where it lives |
|---|---|---|
| Workspace | The tenant. Every parameter, option, link and placement belongs to one | `workspaces` (exists) |
| Tag | Free-text platform label on a link (`email`, `lark`), up to 12 per link, each with its own URL `/r/<slug>/<tag>` | `links.tags`, `clicks.tag` (exists, unchanged) |
| Tracking parameter | A workspace's definition of a label: name, stable key, type (text, dropdown, later reference list), required, active, order | `tracking_parameters` (new) |
| Parameter option | A predefined value of a dropdown parameter, such as one store code | `tracking_parameter_options` (new) |
| Placement | One real QR code or printed link: short code `/q/<code>` pointing at a link, with its parameter values | `placements`, `placement_values` (new) |

Tags and parameters stay separate. Existing tags are never converted into parameters.

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
| 2a | **Parameter definitions (backend):** `tracking_parameters` and `tracking_parameter_options` tables per workspace; key unique per workspace regardless of case and fixed after creation; archive instead of delete once used; server-side validation of values; audit log entries. Migration `0007_tracking_parameters` | M | 0 | Done (migration not yet applied to Supabase) |
| 2b | **Parameter management page:** workspace members list, search, create, edit, activate or deactivate parameters, set required and order; for dropdowns add, edit, deactivate, reorder options and import options by paste or CSV | M | 2a | Next |
| 3 | **Placements:** `placements` table (short code, link, workspace, status) and `placement_values` (placement, parameter, value or option); short `/q/<code>` route; `placement_id` on clicks; short code unique with retry on collision. Existing `/r/<slug>/<tag>` links keep working | M | 2a | |
| 4 | **Placement form:** on a link, create placements with fields rendered from the workspace's active parameters (in order, required enforced), review before saving, list placements, QR code per placement. A workspace with no parameters can still create a placement | M | 2b, 3 | |
| 5 | **Bulk QR:** upload a CSV whose columns are parameter keys, preview the row count and errors, create only the rows given (no automatic combinations), download a zip of labelled QR codes plus a CSV mapping each code to its URL and values | M | 4 | |
| 6 | **Routing by device:** iOS, Android and fallback URLs per link, set by whoever creates the link; store OS and device type on each scan | M | 3 | |
| 7 | **Reports:** filter and group by any parameter, tag and device; label unique visitors as estimated; CSV export. Renamed parameters show their current name; archived ones still report | L | 3, 6 | |
| 8 | **Bot and data-centre filtering:** cloud IP ranges with a refresh script (excluding iCloud Private Relay), burst flag, internal-traffic exclusion; flagged scans shown separately, never deleted | M | 3 | |
| 9 | **PDPA changes:** IP masking or retention job, privacy notice link | S–M | A1 feedback | |
| 10 | **Location without Vercel:** CloudFront geo headers or a GeoIP database | S | A3 | |
| 11 | **CI/CD:** lint, type check, tests from task 0, migrations, deploy | S | A3, 0 | |
| 12 | **Production on AWS:** server, PostgreSQL, migrations, monitoring | M | 10, 11 | |
| 13 | **Branded domain live** on production with HTTPS | S | 12, A2 | |
| 14 | **Real-phone scan testing:** camera, Google Lens, in-app browsers; confirm real scans are not counted as bots | S | 6, 8, 13 | |
| 15 | **UAT with marketing:** one campaign from CSV to QR files to report | S | 0–14 | |
| 16 | Go-live, pilot, hypercare | – | 15, PDPA sign-off | |

**Critical path:** 0 → 2a → 2b and 3 → 4 → 5 and 7. Tasks 6 and 8 can follow task 3 in any order. Tasks 9–13 depend on other teams' timing.

**Later (not Phase 1 unless needed):** a "reference list" parameter type that points to a shared table, if a company-wide list is ever needed; rules-based bulk generation; more field types (number, date).

## Rules: do not break existing links

LinkTrace is already in use for tracking button clicks. Every task must follow these rules.

1. `/r/<slug>` and `/r/<slug>/<tag>` keep working. New QR codes use `/q/<code>`.
2. Schema changes only add: new tables, and new columns that are nullable or have defaults. No renames, drops or rewrites of existing data.
3. A link without device URLs, parameters or placements behaves exactly as today. Creating a link never requires a parameter unless a workspace marks one as required, and required parameters apply to placements only.
4. Tags keep their current meaning and storage. They are not converted into parameters.
5. A parameter or option that has been used is archived, never deleted. Its key never changes, so old scans still report correctly.
6. Bot and data-centre filtering writes to a new flag column; `is_bot` and historical counts stay unchanged.
7. Any change to stored data (such as IP masking for PDPA) is applied only after the DPO decides, and current users are told first.
8. Before each deploy, the task 0 tests pass and an existing redirect link and a tag link still redirect and still record clicks.

## Open decisions

None at the moment.

## Decisions made

| Decision | Reason |
|---|---|
| Every workspace member manages its tracking parameters and options for now, and is responsible for their correctness. The rule lives in one place (`lib/permissions.ts`) | Marketing self-serves; role-based control will narrow it later without code changes elsewhere |
| Parameters are defined per workspace, not hard-coded as store, channel and campaign | Different teams need different labels; no code or column changes per team |
| No built-in store, channel or campaign field; each workspace defines the parameters it needs (a store list is just a dropdown parameter whose options are imported from CSV) | Teams manage their own labels; no stores module to build or maintain |
| Parameter values are stored on placements only, not on the link | One link can have many QR codes with different labels; the create-link form stays as it is today |
| Tags stay separate from parameters | Tags are already in use with their own URLs and reports; merging them would change the meaning of existing data |
| A parameter's key and field type are fixed once created; its name, description and required setting can change. An option's value (code) is fixed; its label can change. To fix a wrong code, deactivate it and add a new one | Renaming must not break existing placements or reports |
| Parameters and options are deactivated, never deleted, from the app | Keeps history intact without checking whether something was used |
| Limits: 30 parameters per workspace, 5,000 options per parameter, 2,000 options per import | Covers a full store list while keeping pages and imports fast |
| No preview or similar-name checks on import; only case-insensitive unique codes and keys | Keeps tasks 2a and 2b small; owners own data quality |
| Link creators enter the App Store, Play Store and fallback URLs themselves | No dependency on the app team for routing |
| One QR code per real placement, not every combination of labels | Labels are attributes; print volume is marketing's call |
| If the destination lookup fails, show an error page instead of a fallback redirect | Redirecting somewhere other than the real destination is not wanted |
| Unique visitors are reported as an estimate | The visitor cookie resets when cookies are cleared or browsers change; no fingerprinting |
| Bot and data-centre filtering is in Phase 1; ad fraud checks stay in Phase 3 | Email link scanners and bots inflate counts now; ad fraud only matters with paid ads |
