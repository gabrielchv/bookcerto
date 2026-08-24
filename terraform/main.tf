provider "google" {
  project = var.project_id
  region  = var.region
}

provider "neon" {
  api_key = var.neon_api_key
}

provider "upstash" {
  email   = var.upstash_email
  api_key = var.upstash_api_key
}

resource "neon_project" "bookcerto" {
  name       = "bookcerto"
  region_id  = var.neon_region_id
  pg_version = var.neon_pg_version
}

resource "neon_endpoint" "main" {
  project_id = neon_project.bookcerto.id
  branch_id  = neon_project.bookcerto.default_branch_id
  type       = "read_write"
}

resource "neon_role" "app" {
  project_id = neon_project.bookcerto.id
  branch_id  = neon_project.bookcerto.default_branch_id
  name       = "bookcerto"
}

resource "neon_database" "app" {
  project_id = neon_project.bookcerto.id
  branch_id  = neon_project.bookcerto.default_branch_id
  name       = "bookcerto"
  owner_name = neon_role.app.name
}

resource "upstash_redis_database" "main" {
  database_name = "bookcerto"
  region        = var.upstash_region
  tls           = true
}

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
  secret_data = "postgresql://${neon_role.app.name}:${neon_role.app.password}@${neon_endpoint.main.host}/${neon_database.app.name}?sslmode=require"
}

resource "google_secret_manager_secret" "redis_url" {
  secret_id = "redis-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = google_secret_manager_secret.redis_url.secret_id
  secret_data = "rediss://default:${upstash_redis_database.main.password}@${upstash_redis_database.main.endpoint}:${upstash_redis_database.main.port}"
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

resource "google_cloud_run_v2_service" "web" {
  name     = "bookcerto-web"
  location = var.region

  template {
    service_account = var.service_account

    containers {
      image = var.image
      ports {
        container_port = 8080
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "REDIS_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.redis_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.auth_secret.secret_id
            version = "latest"
          }
        }
      }
      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
  }
}

resource "google_cloud_run_v2_service" "worker" {
  name     = "bookcerto-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_INTERNAL_ONLY"

  template {
    service_account = var.service_account

    containers {
      image   = var.image
      command = ["npx"]
      args    = ["tsx", "src/worker.ts"]
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "REDIS_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.redis_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "AUTH_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.auth_secret.secret_id
            version = "latest"
          }
        }
      }
      resources {
        limits = {
          cpu    = "1000m"
          memory = "512Mi"
        }
      }
    }

    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
  }
}
