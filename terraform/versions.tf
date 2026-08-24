terraform {
  required_version = ">= 1.5"
  required_providers {
    google  = { source = "hashicorp/google", version = "~> 6.0" }
    neon    = { source = "kislerdm/neon", version = "~> 0.15" }
    upstash = { source = "upstash/upstash", version = "~> 1.0" }
  }
}
