# Cost ceiling: R$30 / month, hard limit

Set 2026-10-29 after discovering ~R$1.000/month of Google Cloud spend across
accounts that were believed to be dormant. The rule is simple:

> **Total monthly Google Cloud spend must never exceed R$30.** Not per project.
> Not "usually". Never.

This document records what was actually running, what was cut, and the rules that
keep it from coming back.

---

## What was billed, and why

Found by inventorying every project over the Cloud Resource Manager API on
2026-10-29. Only three projects held always-on infrastructure.

| Resource | Project | Type | Estimated cost | Status |
|---|---|---|---|---|
| `openwebui-server` | `openwebui-501108` | e2-small, 30 GB disk, 24/7 | **~R$250/mo** | `TERMINATED` |
| `omnistore-rabbitmq` | `status-page-7823` | e2-micro, 10 GB disk, 24/7 | ~R$45/mo | `TERMINATED` |
| `broker` | `spring-rabbit-saga-3720` | e2-micro, 10 GB disk, 24/7 | ~R$45/mo | `TERMINATED` |
| `status-page-db` | `status-page-7823` | Cloud SQL db-f1-micro, 24/7 | ~R$60/mo | `activationPolicy=NEVER` |
| 50 GB of persistent disks on the three VMs | — | pd-standard | ~R$10/mo | attached to stopped VMs, retained |

The dominant line was a **single `e2-small` VM running Open WebUI 24/7**. Second
was Cloud SQL idle. Everything else — all 29 Cloud Run services, every Artifact
Registry repo, every bucket — was already scale-to-zero and cost almost nothing.

**Cloud Run was never the problem.** All 29 services across 12 projects had
`min-instances=0`. Traffic was 1–9 requests per hour on the busiest one.

Model API spend was also negligible: `job_find_apply` records every call it makes
and its ledger totals **US$1.82** from 2026-10-20 to 2026-10-26.

### One real bug found in code

`bookcerto/.github/workflows/deploy.yml` deployed the queue worker with
`--min-instances 1 --no-cpu-throttling`. That shape bills a full vCPU 24/7
(roughly R$270/month) for a demo queue consumer with no traffic. The live service
had already drifted to 0, but the next `git push` would have re-broken it. Both
flags are now removed and the workflow pins `--min-instances 0 --max-instances 1`.

The web service is pinned at `--min-instances 0 --max-instances 2 --cpu 1 --memory 512Mi`.

---

## How it is enforced

**Mechanism, not intention:**

1. **Budgets on every billing account**, set at R$30 with alerts at 50%, 80%,
   100% and 150% of the ceiling. Created 2026-10-29. A budget alerts; it does not
   stop spend, so it is a tripwire rather than the guarantee.
2. **`--min-instances 0` in every deploy workflow**, with the reason in a comment
   next to the flag so nobody "fixes" it back.
3. **Workers are Cloud Run Job territory.** A queue consumer that must run
   continuously cannot be a scale-to-zero Cloud Run *service*. When it has to be
   always-on, the answer is a Job on a schedule, not a service holding a vCPU.

### Budgets actually created

| Billing account | Currency | Budget |
|---|---|---|
| `014E13-20A03A-995A8B` (portfolio, bookcerto, task-organizer) | BRL | R$30 |
| `0162FA-1FFFFE-3AC452` (Jobsearch) | BRL | R$30 |
| `0186A5-698AAA-BCA26D` (inquilino-ia, rag-ic, spring-rabbit-saga) | BRL | R$30 |
| `0196B0-76BC3D-00B0F6` (yank, carmatch, openwebui) | BRL | R$30 |

Not yet covered: `013297-3FFA71-413CA8` (`status-page-7823`) and
`01DFB1-AA54B9-AEBDF6`. For the first, the Budget API call returned 403 for a
propagation reason and the retry has not been re-run; `01DFB1` rejected the
payload with a generic invalid argument. Both need to be created in the console.

---

## Rules for anything new

- **Free tier first.** Neon and Upstash (as `bookcerto` already does) over Cloud SQL
  and Memorystore. Cloud Run over GCE. Firebase Hosting over a VM.
- **Scale to zero, always.** If a workload cannot tolerate cold starts, it is a
  Job or it is not worth deploying.
- **No idle databases.** Cloud SQL costs money while doing nothing. Use
  `activationPolicy=NEVER` or a serverless Postgres.
- **No VM without a stop date.** A VM is a subscription, not a deployment.
- **Check the bill before adding infrastructure**, not after. The console shows
  the current cost breakdown per project.

## Reverting

The stopped VMs are `TERMINATED`, not deleted — disks and configuration survive.
To bring one back:

```bash
gcloud compute instances start openwebui-server --zone us-central1-b --project openwebui-501108
```

Restarting it also restarts the R$250/month. That is the trade, made explicitly.
