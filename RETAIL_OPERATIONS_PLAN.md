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
| 9 | Retail automation, persisted deadlines, and accurate countdowns | Implemented in this change |
| 10 | Production observability and load validation | Next: scheduler lag, failed transitions, queue throughput, and LINE delivery SLOs |

## Milestone 9 behavior contract

1. A waiting queue may have a persisted `scheduledCallAt`. The scheduler calls it when server time reaches that value.
2. Automatic transition claims are atomic. More than one Railway replica cannot call the same queue twice.
3. Calling a queue stores `calledAt` and `seatDeadlineAt`. The grace period is configured per branch.
4. A store may opt into automatic no-show cancellation. It is disabled by default.
5. Seating always requires a staff action because software cannot infer that a customer physically arrived.
6. Seating stores `seatedAt` and `diningDeadlineAt`. Passing the dining deadline raises an operational warning; it never closes the table automatically.
7. Completing a queue always requires a staff action because software cannot infer that the table is free.
8. The scheduler polls every five seconds by default, does not overlap itself, and evaluates persisted server timestamps rather than counting interval ticks.
9. Merchant countdowns calibrate against server time and update visually once per second. Queue data refreshes every five seconds.

## Time-trigger audit

| Trigger | Source of truth | Accuracy / safety decision |
| --- | --- | --- |
| Automatic queue call | `Queue.scheduledCallAt` | Persisted UTC timestamp; atomic status transition |
| Arrival grace period | `Queue.seatDeadlineAt` | Persisted UTC timestamp; warning or explicit opt-in cancellation |
| Dining limit | `Queue.diningDeadlineAt` | Persisted UTC timestamp; warning only |
| Automation worker | `QUEUE_AUTOMATION_POLL_MS` (default 5 seconds) | Recursive timeout after completion; no overlapping loops |
| Merchant queue refresh | Server API every 5 seconds | Failures keep last known state and display connection status |
| Merchant countdown | Server-calibrated browser clock every 1 second | Display only; server decides transitions |
| LIFF status refresh | 15 seconds | Customer display only; server remains authoritative |
| Email OTP | 10 minutes, server timestamp | Server-enforced expiry and one-minute resend cooldown |
| Merchant account token | 7 days, signed expiry | Server-enforced |
| Legacy admin token | 12 hours, signed expiry | Server-enforced |
| Platform impersonation | 30 minutes, signed expiry | Server-enforced and audited |
| LINE profile lookup | 5-second HTTP timeout | Prevents stuck reservation requests |

## Retail usability and stability decisions

- Keep the existing `/store/queues` route and navigation structure.
- Group called, waiting, and dining queues so urgent called queues appear first.
- Disable queue action buttons while a mutation is in flight to reduce duplicate operations.
- Show online/offline refresh state without clearing the last useful queue data.
- Let staff schedule an individual waiting queue up to seven days ahead.
- Limit automation settings to members with `settings.update`; staff retain queue-call scheduling permission.
- Keep timestamps in UTC and localize only at render time.
- Retain manual confirmation for physical-world events: seating and table completion.

## Milestone 10 exit criteria

- Measure scheduler lag (actual transition time minus scheduled time) at p50, p95, and p99.
- Alert on scheduler lag above 30 seconds, repeated database failures, and LINE delivery failure spikes.
- Load-test at least 100 active stores and verify no duplicate transition under multiple replicas.
- Add an operations report for overdue called and dining queues by branch.
