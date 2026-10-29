"""Cost guard — the enforcement half of the R$30/month ceiling.

A Cloud Billing budget can only *alert*. Google Cloud has no native hard spend
cap, so the ceiling is enforced here: a budget notification is delivered to this
service over Pub/Sub, and at 100% of the budget it contains spending by removing
everything that bills while idle.

What "contain" does, and deliberately does not do:

  * STOPS every RUNNING Compute Engine instance in every project. A VM is a
    subscription; it bills whether or not anyone uses it. This was the R$250/mo
    Open WebUI box.
  * Forces `minInstanceCount` to 0 on every Cloud Run service. A service with
    min-instances 1 bills a vCPU 24/7 with zero traffic. Scale-to-zero services
    keep serving and keep costing nothing, so the sites stay up.

  * It does NOT disable billing and does NOT delete anything. Both are
    irreversible enough that a human should make that call. Stopped VMs and
    scale-to-zero services are recoverable in one command.

Idempotent and safe to run repeatedly: it only touches resources that are
already costing money while idle.

Stdlib only — no google-auth, no requests. The access token comes from the
metadata server, which keeps the image small and the dependency surface empty.
"""

import base64
import json
import logging
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

# Set DRY_RUN=1 to log what would happen without touching anything.
DRY_RUN = os.environ.get("DRY_RUN", "").lower() in ("1", "true", "yes")
METADATA_TOKEN = (
    "http://metadata.google.internal/computeMetadata/v1/instance/"
    "service-accounts/default/token"
)
# How far over budget before acting. 1.0 == 100% of the configured budget.
ACT_AT = float(os.environ.get("ACT_AT_THRESHOLD", "1.0"))


def access_token() -> str:
    req = urllib.request.Request(METADATA_TOKEN, headers={"Metadata-Flavor": "Google"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)["access_token"]


def api(method: str, url: str, token: str, body: dict | None = None):
    """Call a Google API. Returns (status, parsed_body_or_text)."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as err:
        raw = err.read()[:300].decode("utf-8", "replace")
        return err.code, raw
    except Exception as err:  # network, timeout
        return 0, str(err)


def projects(token: str) -> list[str]:
    """Projects to contain.

    Prefer the explicit PROJECTS env var. Listing via Resource Manager needs
    `resourcemanager.projects.get` on every project (or org-level browser), which
    is more permission than a cost breaker should hold. An explicit list keeps the
    blast radius exactly equal to the names written down here.
    """
    explicit = os.environ.get("PROJECTS", "").strip()
    if explicit:
        return [p.strip() for p in explicit.split(",") if p.strip()]

    out, page = [], ""
    while True:
        url = "https://cloudresourcemanager.googleapis.com/v1/projects?pageSize=100"
        if page:
            url += f"&pageToken={page}"
        status, body = api("GET", url, token)
        if status != 200 or not isinstance(body, dict):
            logging.error("cannot list projects: %s %s", status, body)
            return out
        for p in body.get("projects", []):
            if p.get("lifecycleState") == "ACTIVE":
                out.append(p["projectId"])
        page = body.get("nextPageToken", "")
        if not page:
            return out


def stop_vms(token: str, project: str) -> int:
    """Stop every RUNNING instance. Returns how many were stopped."""
    status, body = api(
        "GET",
        f"https://compute.googleapis.com/compute/v1/projects/{project}"
        "/aggregated/instances",
        token,
    )
    if status != 200 or not isinstance(body, dict):
        return 0
    stopped = 0
    for scope in (body.get("items") or {}).values():
        for inst in scope.get("instances", []):
            if inst.get("status") != "RUNNING":
                continue
            zone = inst["zone"].rsplit("/", 1)[-1]
            name = inst["name"]
            if DRY_RUN:
                logging.info("[dry-run] would stop VM %s/%s (%s)", project, name, zone)
                stopped += 1
                continue
            code, err = api(
                "POST",
                f"https://compute.googleapis.com/compute/v1/projects/{project}"
                f"/zones/{zone}/instances/{name}/stop",
                token,
                {},
            )
            if code in (200, 202):
                logging.warning("STOPPED VM %s/%s (%s)", project, name, zone)
                stopped += 1
            else:
                logging.error("failed to stop VM %s/%s: %s %s", project, name, code, err)
    return stopped


def floor_cloud_run(token: str, project: str) -> int:
    """Force minInstanceCount=0 on every service. Returns how many changed."""
    status, body = api(
        "GET",
        f"https://run.googleapis.com/v2/projects/{project}/locations/-/services",
        token,
    )
    if status != 200 or not isinstance(body, dict):
        return 0
    changed = 0
    for svc in body.get("services", []):
        name = svc["name"]  # projects/P/locations/R/services/S
        region = name.split("/")[3]
        scale = (svc.get("template") or {}).get("scaling") or {}
        if not scale.get("minInstanceCount"):
            continue  # already scale-to-zero, costs nothing while idle
        if DRY_RUN:
            logging.info("[dry-run] would set minInstanceCount=0 on %s", name)
            changed += 1
            continue
        code, err = api(
            "PATCH",
            f"https://run.googleapis.com/v2/{name}?updateMask=template.scaling",
            token,
            {"template": {"scaling": {"minInstanceCount": 0}}},
        )
        if code in (200, 202):
            logging.warning("SCALE-TO-ZERO %s (%s)", name.split("/")[-1], region)
            changed += 1
        else:
            logging.error("failed to patch %s: %s %s", name, code, err)
    return changed


def contain(token: str) -> dict:
    """Remove every resource that bills while idle, across every project."""
    stopped_vms = 0
    scaled = 0
    for project in projects(token):
        stopped_vms += stop_vms(token, project)
        scaled += floor_cloud_run(token, project)
    summary = {"stopped_vms": stopped_vms, "scaled_to_zero": scaled}
    logging.warning("CONTAINMENT COMPLETE %s", json.dumps(summary))
    return summary


def handle_budget(token: str, payload: dict) -> dict:
    """React to one budget notification."""
    cost = float(payload.get("costAmount", 0) or 0)
    budget = float(payload.get("budgetAmount", 0) or 0)
    threshold = payload.get("alertThresholdExceeded")

    logging.info(
        "budget=%s cost=%.2f budget=%.2f threshold=%s currency=%s",
        payload.get("budgetDisplayName"),
        cost,
        budget,
        threshold,
        payload.get("currencyCode"),
    )

    breached = False
    if threshold is not None:
        breached = float(threshold) >= ACT_AT
    elif budget > 0:
        # Some notifications carry no explicit threshold; fall back to the ratio.
        breached = cost >= budget * ACT_AT

    if not breached:
        return {"action": "none", "reason": "below threshold"}

    logging.warning("CEILING BREACHED — containing spend")
    return {"action": "contain", **contain(token)}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: dict) -> None:
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        self._send(200, {"ok": True, "dryRun": DRY_RUN, "actAt": ACT_AT})

    def do_POST(self) -> None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
            envelope = json.loads(self.rfile.read(length) or b"{}")
        except Exception as err:
            self._send(400, {"error": f"bad request: {err}"})
            return

        try:
            token = access_token()
            if "message" in envelope:
                # Pub/Sub push envelope.
                data = envelope["message"].get("data", "")
                payload = json.loads(base64.b64decode(data) or b"{}")
            else:
                # Direct invocation, for testing.
                payload = envelope

            result = handle_budget(token, payload)
            self._send(200, result)
        except Exception as err:
            # Always 200: a non-2xx makes Pub/Sub redeliver, and a poison message
            # would retry forever. The failure is in Cloud Logging.
            logging.exception("handler failed")
            self._send(200, {"error": str(err)})

    def log_message(self, fmt, *args):  # quieter default access log
        logging.info("%s %s", self.address_string(), fmt % args)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    logging.info("cost-guard listening on :%d (dry_run=%s)", port, DRY_RUN)
    HTTPServer(("", port), Handler).serve_forever()
