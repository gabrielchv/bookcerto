variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for Cloud Run and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "image" {
  description = "Container image for both services (full Artifact Registry digest)"
  type        = string
}

variable "service_account" {
  description = "Cloud Run service account email (reads Secret Manager secrets)"
  type        = string
}

variable "auth_secret" {
  description = "AUTH_SECRET value for Auth.js"
  type        = string
  sensitive   = true
}

variable "neon_api_key" {
  description = "Neon API key"
  type        = string
  sensitive   = true
}

variable "neon_region_id" {
  description = "Neon region id"
  type        = string
  default     = "aws-us-east-1"
}

variable "neon_pg_version" {
  description = "Postgres major version for Neon"
  type        = number
  default     = 16
}

variable "upstash_email" {
  description = "Upstash account email"
  type        = string
}

variable "upstash_api_key" {
  description = "Upstash API key"
  type        = string
  sensitive   = true
}

variable "upstash_region" {
  description = "Upstash Redis region"
  type        = string
  default     = "us-east-1"
}
