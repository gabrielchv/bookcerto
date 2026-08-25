variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "service_account" {
  description = "Cloud Run service account email (reads Secret Manager secrets)"
  type        = string
}

variable "database_url" {
  description = "Neon Postgres connection string"
  type        = string
  sensitive   = true
}

variable "redis_url" {
  description = "Upstash Redis connection string"
  type        = string
  sensitive   = true
}

variable "auth_secret" {
  description = "AUTH_SECRET value for Auth.js"
  type        = string
  sensitive   = true
}
