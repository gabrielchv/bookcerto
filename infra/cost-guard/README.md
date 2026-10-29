# cost-guard

Enforces the R$30/month ceiling. See [`../../docs/COST-CEILING.md`](../../docs/COST-CEILING.md)
for the why, the audit, and the test procedure.

A Cloud Billing budget can only notify. This service is what turns a notification
into an action: on a budget breach it stops every RUNNING VM and forces
`minInstanceCount: 0` on every Cloud Run service in the projects listed in its
`PROJECTS` env var.

It never disables billing and never deletes anything — both need a human.

- `main.py` — stdlib only; token from the metadata server, no google-auth.
- `Dockerfile` — `python:3.12-slim`, non-root, no pip install.

Deployed at `cost-guard` in `machine-learning-study-481717` / `us-central1`.
Not public: `roles/run.invoker` is granted only to its own service account, which
signs the Pub/Sub pushes.

```bash
docker build -t us-central1-docker.pkg.dev/machine-learning-study-481717/cost-guard/guard:v2 .
docker push  us-central1-docker.pkg.dev/machine-learning-study-481717/cost-guard/guard:v2
```
