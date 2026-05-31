# ADR-0001: Per-event `level` field for editorial-prominence filtering

**Date:** 2026-05-31
**Status:** Accepted
**Issue:** [#506](https://github.com/lucas42/lucos_loganne/issues/506)

## Context

loganne records high-level events of interest across the lucos estate and renders them as a single reverse-chronological feed (`/view`), kept live via a websocket on `/stream`. Every event carries `source`, `type`, `humanReadable`, and optionally `date`, `url`, and `uuid`. There is no notion of how *interesting* an event is — every event is shown to every viewer equally.

In practice the feed mixes signal and noise. Some events are genuinely worth a person's attention (a new album created, a deploy, a contact updated); others are mechanical churn that a viewer rarely cares about — track-finished events and their subsequent weighting updates, or monitoring alerts raised during a known suppression window. A viewer who wants to skim "what's happening" has no way to drop the churn, and a future estate-wide homepage glance ([lucos_root#135](https://github.com/lucas42/lucos_root/issues/135)) has no way to surface only the handful of events significant enough to belong on a front page.

The requirement (issue #506) is a way to filter the feed by how interesting an event is, applied consistently to existing events, the catch-up replay, and live websocket sends, with a default that leaves today's behaviour unchanged.

Two framing decisions shaped the design before the mechanism:

- **The axis is editorial prominence, not severity.** loganne is not a logging or alerting system; rfc5424 syslog severities (`emergency`…`debug`) describe operational urgency, which is the wrong axis for "how much should this stand out in a human-facing activity feed". A bespoke, small, ordered vocabulary fits the actual question being asked.
- **Prominence is a property of the event, not the source.** The same source legitimately emits both routine and significant events (a deploy is more prominent than a config touch from the same service). So the field must be per-event, set by the emitter, not a per-source configuration in loganne.

## Decision

### Add an optional, ordered `level` field to the event payload

A new optional field `level` is added to the event schema, expressed as a **named string** drawn from a fixed, ordered vocabulary of four values:

| Level | Meaning | Surfaces in |
|---|---|---|
| `detail` | Mechanical / low-interest churn — weighting updates, track-finished, monitoring alerts raised during a suppression window. | Hidden from the default feed; shown only when explicitly requested. |
| `routine` *(default)* | Regular estate activity — everything loganne emits today (album created, track added, contact updated, deploy). | Default feed and above. |
| `notable` | Worth emphasising in-feed, but not estate-headline material. | loganne feed. |
| `headline` | Estate-significant; suitable for the lucos_root homepage glance. | Homepage + loganne feed. |

The ordering is `detail < routine < notable < headline`.

**Named strings, not integers and not rfc5424.** Integers would invite arithmetic and a false sense of a continuous scale; named strings are self-documenting in payloads, logs, and URLs, and the fixed set keeps the vocabulary honest. rfc5424 was explicitly rejected — its severities describe operational urgency, a different axis (see Context).

### Validation: default-on-absent, reject-on-unknown

Validation lives in the existing `validateEvent` function in `src/handleEvents.js`, mirroring the patterns already used there for `date`, `uuid`, and `url`:

- **Absent** `level` → normalised to the default, `routine`.
- **Present and in the vocabulary** → accepted as-is.
- **Present but not a recognised value** → rejected with a `400`, consistent with how `validateEvent` already throws a descriptive string that the `POST /events` route turns into a `400 Invalid event data`.

Because `initEvents` runs every persisted event back through `validateEvent` on load, existing stored events (which have no `level`) are normalised to `routine` on startup — no data migration step is required.

### One vocabulary, one comparator, in the shared module

The vocabulary, its ordering, the default, and a single comparator (a `rank(level)` lookup plus a "does this event meet this threshold" predicate) live in **one place — `src/handleEvents.js`** — which is already the shared server/client module (`validateEvent`/`formatEvent` are imported by both the Express routes and the browser bundle). That single comparator is reused by:

- `validateEvent` (membership check),
- the `/view` route (server-side render filter),
- `GET /events` (JSON filter),
- the websocket (`/stream`) catch-up replay and live-send filter.

Defining the ordering once and reusing it everywhere is the load-bearing simplicity decision here: there is no second copy of the vocabulary that can drift, on the server or the client.

### Filtering is server-side, query-parameter driven

The viewer's chosen threshold is carried in a `?level=` **URL query parameter**, not in `localStorage` or a cookie. This makes a filtered view **bookmarkable and linkable**, and gives lucos_root a zero-code embed: an iframe pointed at `…/view?level=headline` is the entire integration.

- **Default threshold is `routine`.** An absent or empty `?level=` filters at `routine`, which sits one step above `detail`. Combined with the default event level also being `routine`, this means **with no emitter updated, the default view is byte-for-byte identical to today's** — every current level-less event is `routine`, and `routine >= routine` passes. `detail` events only ever appear when a viewer explicitly asks for them (`?level=detail`).
- **An out-of-vocabulary `?level=` value** is treated as the default (`routine`) rather than erroring — a malformed bookmark should degrade to the normal feed, not a `400` page. (This is deliberately more lenient than event *ingestion*, where an unknown level is a producer bug worth surfacing loudly.)

**`GET /view`** (the HTML feed; `/` redirects here) filters server-side in the route before rendering, so there is no flash of filtered-out items that a client-side filter would cause.

**`GET /events`** (the JSON endpoint) also accepts `?level=` for symmetry, so future JSON consumers get the same filtering for free. It composes with the existing `?since=` parameter.

### Websocket filtering: server-side, per-connection, on `/stream`

This was the point lucas42 asked to be stated unambiguously, so it is stated here as the contract:

**Websocket filtering happens on the server, per connection, on the `/stream` endpoint.** The browser opens its `/stream` connection carrying the **same `?level=` query parameter the page was loaded with** (the client appends its active level — in practice `location.search` — to the websocket URL). The server reads and validates that parameter once, at connection time, and stores the resolved threshold on the connection (alongside the existing `client.authenticated` flag). From then on:

- **Catch-up replay** — the events sent immediately on connect (today's unconditional `getEvents().forEach(...)`) are filtered to those meeting the connection's threshold.
- **Live sends** — `sendToAllClients` sends each new event only to connections whose stored threshold the event meets.

So a viewer on `?level=headline` receives, over the websocket, only headline-or-above events — both the backlog and anything streamed in afterwards — with the filtering decision made server-side and never shipping filtered-out events to that client. A viewer changing their filter loads a new URL, which establishes a fresh `/stream` connection at the new threshold; there is no in-place re-filtering of an existing connection.

### Scope

The change is **additive and backwards-compatible**: a new optional field plus read-path filtering. Specifically out of scope for this ADR:

- **No webhook consumer changes.** Webhooks route by `type`, not `level`; existing consumers are unaffected and receive the (now level-bearing) payload unchanged.
- **No emitter changes are required for correctness.** Emitters only change if they *want* a non-default level; until then everything is `routine` and the feed is unchanged. The specific emitter changes are tracked as separate follow-ups (see Consequences).
- **No persisted-state migration.** Normalisation on load (above) handles existing events.

The one genuinely new consumer is lucos_root, via the `?level=headline` query parameter / iframe embed.

## Consequences

### Positive

- **Backwards compatible by construction.** Default event level == default filter threshold == `routine`, so an estate with no emitter changes sees exactly today's feed. The feature can ship and sit dormant until producers opt in.
- **One source of truth for the vocabulary.** Ordering and membership are defined once in the shared module and reused by validator, view, JSON, and websocket — no server/client drift, and adding or reordering levels is a one-place change.
- **Linkable, embeddable views.** A query-parameter threshold is bookmarkable and gives lucos_root a no-code iframe integration (`?level=headline`).
- **No flash of filtered content.** Server-side filtering on both the rendered page and the websocket means a client never receives, then hides, events below its threshold.
- **Minimal, boring surface area.** No new storage, no new endpoint, no new dependency — an optional field, a comparator, and a query parameter threaded through routes that already exist.

### Negative

- **Filter changes mean a reconnect.** Because the threshold is fixed per `/stream` connection at connect time, changing the filter is a page reload / new connection rather than an in-place adjustment. This is a deliberate simplification (no client→server "change my level" control message), justified by the query-parameter model where each threshold is just a different URL. If an in-place control ever becomes desirable, it is an additive change to the connection.
- **Two different leniency rules for the same vocabulary.** Unknown `level` on *ingestion* is a `400` (producer bug, fail loud); unknown `?level=` on *viewing* degrades to the default (malformed bookmark, fail soft). This asymmetry is intentional but is a thing a future reader must understand — hence its explicit statement here.
- **Value depends on emitters opting in.** The mechanism alone changes nothing a viewer notices; the churn only disappears once the noisy emitters are updated to emit `detail`. Those changes are deferred to follow-up tickets, so there is a window where the field exists but the feed is unchanged. This is acceptable (the feature is opt-in by design) but means the user-visible payoff lands incrementally, not at merge.
- **`headline` has no defined producers yet.** Which events warrant `headline` is a product decision owned by lucos_root#135, not loganne. Until that is settled, the top level is reachable by viewers but unused by producers.

## Follow-up work

Per the lucos-architect convention that an ADR is not complete until its deferred work is tracked, the following are raised as separate issues after sign-off:

- **`lucos_monitoring`** — emit monitoring alerts that fire during a suppression window at `level: detail`.
- **track-finished / `lucos_media_weightings`** — emit track-finished events and their subsequent weighting-update events at `level: detail`.
- **`headline` taxonomy** — which estate events warrant `headline` belongs in [lucos_root#135](https://github.com/lucas42/lucos_root/issues/135)'s scope, not a new loganne ticket.

## Alternatives considered

- **rfc5424 syslog severities.** Rejected: describes operational urgency, not editorial prominence (see Context). Reusing it would mislead producers into thinking loganne is an alerting channel.
- **Integer levels.** Rejected: invites arithmetic and a false continuous scale; named strings are self-documenting in payloads, logs, and URLs.
- **Per-source level configuration in loganne.** Rejected: prominence is a property of the event, not the producer — the same source emits both routine and significant events.
- **Client-side filtering (localStorage / cookie).** Rejected: not linkable or embeddable, causes a flash of filtered-out content, and still ships filtered events to the client over the websocket. Server-side query-parameter filtering avoids all three.
- **A separate "prominence" endpoint or event stream.** Rejected as over-engineering: a single ordered field on the existing payload, filtered on the existing routes, is sufficient for the scale and need.
