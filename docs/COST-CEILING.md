# Cost ceiling: R$30 / month, enforced

Set 2026-10-29 after discovering ~R$1.000/month of Google Cloud spend across
accounts that were believed to be dormant.

> **Total monthly Google Cloud spend must never exceed R$30.**
> Not per project. Not "usually". Never.

A Cloud Billing budget on its own only *emails you*. Google Cloud has no native
hard spend cap, so the cap is built here in three layers.

---

## Layer 1 — Alerts

A R$30 BRL budget on every billing account, with thresholds at 50%, 80%, 100%
and 150% of current spend.

| Billing account | Holds | Budget |
|---|---|---|
| `014E13-20A03A-995A8B` | machine-learning-study (portfolio, bookcerto), blog, cape-motors, gomadb | R$30 |
| `0162FA-1FFFFE-3AC452` | Jobsearch | R$30 |
| `0186A5-698AAA-BCA26D` | inquilino-ia, rag-ic, chat-llm, spring-rabbit-saga | R$30 |
| `0196B0-76BC3D-00B0F6` | yank, carmatch, openwebui | R$30 |
| `013297-3FFA71-413CA8` | status-page | R$30 |
| `01DFB1-AA54B9-AEBDF6` | (closed account, no live projects) | **not creatable via API** — 400 |

## Layer 2 — Enforcement (the actual hard cap)

`infra/cost-guard/` is a Cloud Run service that receives every budget
notification over Pub/Sub and, at **100% of the budget**, removes everything that
bills while idle:

- **Stops every RUNNING Compute Engine instance** in the 13 listed projects.
- **Forces `minInstanceCount: 0`** on every Cloud Run service there.

It does **not** disable billing and does **not** delete anything. Both are
irreversible enough to need a human; a stopped VM is one command away from
running again.

**Verified end to end**, not assumed:

1. A canary `e2-micro` was started in `spring-rabbit-saga-3720`.
2. A budget payload (`costAmount 31.50 / budgetAmount 30`) was published to the
   `billing-hard-cap` topic — no manual call to the service.
3. Pub/Sub pushed it with an OIDC token; the guard stopped the canary
   (`stopped_vms: 1`) and the instance went `RUNNING → STOPPING`.
4. Canary deleted.

The endpoint is **not public**. Its IAM policy grants `roles/run.invoker` to
exactly one identity, `cost-guard@machine-learning-study-481717.iam.gserviceaccount.com`,
which signs the Pub/Sub pushes. An anonymous POST returns 403, so nobody can
trigger a mass shutdown by curling a URL.

## Layer 3 — Nothing always-on in the first place

The cap is the backstop, not the plan. The plan is that nothing bills while
idle:

- **Scale to zero, always.** `--min-instances 0` is pinned in every deploy
  workflow with a comment saying why.
- **No idle databases.** Cloud SQL costs money doing nothing; `bookcerto` uses
  Neon (free tier) and Upstash instead. `status-page-db` is `activationPolicy=NEVER`.
- **No VM without a stop date.** A VM is a subscription.
- **Workers are Cloud Run Jobs.** A continuously-running queue consumer cannot be
  a scale-to-zero service; if it must always run, it is a Job on a schedule.

---

## What was actually billing

Found by inventorying every project over Cloud Resource Manager, Compute, Cloud
SQL, Artifact Registry and Cloud Run v2.

| Resource | Was | Action |
|---|---|---|
| `openwebui-server` — e2-small, 30 GB, 24/7 | ~R$250/mo | `TERMINATED` |
| `bookcerto-worker` — `--min-instances 1 --no-cpu-throttling` | ~R$270/mo | `minInstanceCount: 0`, flag removed from workflow |
| `status-page-db` — Cloud SQL db-f1-micro | ~R$60/mo | `activationPolicy=NEVER` |
| `omnistore-rabbitmq` — e2-micro, 24/7 | ~R$45/mo | `TERMINATED` |
| `broker` — e2-micro, 24/7 | ~R$45/mo | `TERMINATED` |
| `status-page` — `minInstanceCount 1` | ~R$270/mo | not billable: project's billing is disabled |

**Cloud Run was never the problem** — all 29 services across 12 projects were
already `min-instances 0`, serving 1–9 requests/hour. Model API spend was
US$1.82 total (2026-10-20 → 10-26), from `job_find_apply`'s own ledger.

---

## Operating it

```bash
# Is the guard alive? (needs auth; it is not public)
gcloud run services describe cost-guard \
  --project machine-learning-study-481717 --region us-central1

# Test the containment path without spending anything:
#   1. start a throwaway VM
gcloud compute instances create canary --machine-type e2-micro \
  --zone us-central1-a --project spring-rabbit-saga-3720
#   2. publish a breach
gcloud pubsub topics publish billing-hard-cap \
  --project machine-learning-study-481717 \
  --message '{"costAmount":31.5,"budgetAmount":30,"alertThresholdExceeded":1.0,"currencyCode":"BRL"}'
#   3. the canary should go RUNNING -> STOPPING within ~60s
#   4. delete it
gcloud compute instances delete canary --zone us-central1-a --project spring-rabbit-saga-3720
```

To add a project to the protected set, add it to the `PROJECTS` env var on the
`cost-guard` service and grant `cost-guard@…` three roles on that project:
`roles/browser`, `roles/run.admin`, `roles/compute.instanceAdmin.v1`, plus
`roles/iam.serviceAccountUser` for the Cloud Run patch.

To disable enforcement without deleting anything: set `DRY_RUN=1` on the service.
It will log what it *would* do and touch nothing.

## Reverting

Stopped VMs are `TERMINATED`, not deleted — disks and configuration survive.

```bash
gcloud compute instances start openwebui-server --zone us-central1-b --project openwebui-501108
```

That also restarts the R$250/month. That is the trade, made explicitly.
