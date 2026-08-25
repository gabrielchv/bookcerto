provider "google" {
  project = var.project_id
  region  = var.region
}

# Neon and Upstash are external SaaS, not GCP infra, and their community
# Terraform providers are broken against current APIs (Neon requires an org_id
# that personal accounts don't have; Upstash deprecated regional DB creation).
# They are provisioned through their own consoles. Their connection strings
# arrive here as variables and land in Secret Manager. Terraform owns GCP only:
# Artifact Registry + Secret Manager. CI owns the app deployment.

resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "bookcerto"
  format        = "DOCKER"
}

resource "google_secret_manager_secret" "database_url" {
  secret_id = "database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.secret_id
  secret_data = var.database_url
}

resource "google_secret_manager_secret" "redis_url" {
  secret_id = "redis-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = google_secret_manager_secret.redis_url.secret_id
  secret_data = var.redis_url
}

resource "google_secret_manager_secret" "auth_secret" {
  secret_id = "auth-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "auth_secret" {
  secret      = google_secret_manager_secret.auth_secret.secret_id
  secret_data = var.auth_secret
}

resource "google_secret_manager_secret_iam_member" "database_url_accessor" {
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account}"
}

resource "google_secret_manager_secret_iam_member" "redis_url_accessor" {
  secret_id = google_secret_manager_secret.redis_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account}"
}

resource "google_secret_manager_secret_iam_member" "auth_secret_accessor" {
  secret_id = google_secret_manager_secret.auth_secret.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${var.service_account}"
}
