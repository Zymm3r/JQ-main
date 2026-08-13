# Retail Operations and Queue Timing Plan

## Milestone review

| Milestone | Outcome | Review status |
| --- | --- | --- |
| 0 | Multi-tenant and security foundation | Complete; retained |
| 1 | Merchant membership and store verification | Complete; retained |
| 2 | Store/branch-scoped queue domain | Complete; retained |
| 3 | LIFF reservations and store QR sources | Complete; retained |
| 4 | Central LINE notification delivery and audit | Complete; retained |
| 5 | No authoritative milestone exists in the repository | Retired number; do not reuse to avoid confusing existing deployments |
| 6 | Staff roles, permissions, and branches | Complete; retained |
| 7 | Platform control plane and audited support access | Complete; retained |
| 8 | Pre-launch idempotency, rate limiting, and service hardening | Complete; retained |
| 9 | Retail automation, persisted deadlines, and accurate countdowns | Complete; retained |
| 10 | Server-authoritative retail operations and production recovery | In progress |
| 11 | Production observability and load validation | Next: scheduler lag, failed transitions, queue throughput, and LINE delivery SLOs |

## Milestone 10 behavior contract

1. MongoDB timestamps are authoritative. Browser timers only render time remaining and never decide a queue transition.
2. A waiting queue may have a persisted `scheduledCallAt`. Automatic calls claim due queues with an atomic status predicate.
3. Queue-call spacing uses a persisted branch cursor and configured interval, so restart or redeploy cannot collapse all waiting calls into the same instant.
4. Calling stores `calledAt` and `seatDeadlineAt`; optional no-show cancellation uses the persisted response deadline.
5. Seating always requires a staff action and stores `seatedAt` plus `diningDeadlineAt`.
6. Completion remains manual by default. Stores may explicitly enable automatic completion at the persisted dining deadline.
7. Optional automatic calling hours are evaluated in the branch timezone and may span midnight.
8. Every transition is conditional on its prior status. Repeated or concurrent requests cannot transition the same queue twice.
9. LINE delivery claims a deterministic queue-event key before sending to prevent two app replicas from dispatching the same event.
10. Socket rooms are scoped by store and branch; reconnect fetches a fresh server snapshot. Five-second polling remains a fallback.
11. The Railway process exposes automation health and stops the scheduler, HTTP server, and Mongo connection gracefully on termination.

## Time-trigger audit

| Trigger | Source of truth | Accuracy / safety decision |
| --- | --- | --- |
| Automatic queue call | `Queue.scheduledCallAt` + branch call cursor | Persisted UTC timestamps; atomic status transition and interval spacing |
| Arrival grace period | `Queue.seatDeadlineAt` | Persisted UTC timestamp; warning or explicit opt-in cancellation |
| Dining limit | `Queue.diningDeadlineAt` | Persisted UTC timestamp; warning or explicit opt-in completion |
| Automatic-call hours | Branch timezone + stored `HH:mm` start/end | Server evaluates schedule, including overnight ranges |
| Automation worker | `QUEUE_AUTOMATION_POLL_MS` (default 5 seconds) | Recursive timeout after completion; no overlapping loops |
| Merchant queue refresh | Authenticated branch Socket.IO + server API every 5 seconds | Reconnect obtains a fresh snapshot; polling is the fallback |
| Merchant countdown | Server-calibrated browser clock every 1 second | Display only; server decides transitions |
| LIFF status refresh | Server API every 5 seconds | Customer display only; server remains authoritative |
| Email OTP | 10 minutes, server timestamp | Server-enforced expiry and one-minute resend cooldown |
| Merchant account token | 7 days, signed expiry | Server-enforced |
| Legacy admin token | 12 hours, signed expiry | Server-enforced |
| Platform impersonation | 30 minutes, signed expiry | Server-enforced and audited |
| LINE profile lookup | 5-second HTTP timeout | Prevents stuck reservation requests |

## Retail usability and stability decisions

- Keep the existing `/store/queues` route and navigation structure.
- Group called, waiting, and dining queues so urgent called queues appear first.
- Show occupied and available table counts from `totalTables` and active dining queues.
- Add `Call Next` without changing the existing per-queue call route.
- Disable queue action buttons while a mutation is in flight to reduce duplicate operations.
- Show online/offline refresh state without clearing the last useful queue data.
- Let staff schedule an individual waiting queue up to seven days ahead.
- Limit automation settings to members with `settings.update`; staff retain queue-call scheduling permission.
- Keep timestamps in UTC and localize only at render time.
- Retain manual confirmation for seating. Keep table completion manual unless the merchant explicitly enables automatic completion.

## Audit findings addressed by Milestone 10

- `setTimeout` in the automation worker is scheduling only; elapsed truth is read back from persisted deadlines after every tick.
- UI `setInterval` calls update displays or refresh snapshots only; they do not advance queue state.
- All `Date.now()` and `new Date()` values that affect transitions are generated on the server. Client dates are accepted only for explicit scheduling and are range-validated by the server.
- `calledAt`, `seatedAt`, `completedAt`, `cancelledAt`, `scheduledCallAt`, `seatDeadlineAt`, and `diningDeadlineAt` survive browser refresh, Socket.IO reconnect, Railway restart, and redeploy because they live in MongoDB.
- The legacy admin endpoints remain scoped to the default branch. The merchant queue workspace uses authenticated store-and-branch routes.

## Milestone 11 exit criteria

- Measure scheduler lag (actual transition time minus scheduled time) at p50, p95, and p99.
- Alert on scheduler lag above 30 seconds, repeated database failures, and LINE delivery failure spikes.
- Load-test at least 100 active stores and verify no duplicate transition under multiple replicas.
- Add an operations report for overdue called and dining queues by branch.
