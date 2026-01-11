
terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = "przemeksroka-joonix-service"
  region  = "us-central1"
}

# Service Account
resource "google_service_account" "troubleshooting_agent" {
  account_id   = "troubleshooting-agent"
  display_name = "Troubleshooting Agent"
}

# IAM Bindings
resource "google_project_iam_member" "cloudasset_viewer" {
  project = "przemeksroka-joonix-service"
  role    = "roles/cloudasset.viewer"
  member  = "serviceAccount:${google_service_account.troubleshooting_agent.email}"
}

resource "google_project_iam_member" "aiplatform_user" {
  project = "przemeksroka-joonix-service"
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.troubleshooting_agent.email}"
}

# Cloud Run Service
resource "google_cloud_run_service" "adk_agent" {
  name     = "adk-network-agent"
  location = "us-central1"

  template {
    spec {
      service_account_name = google_service_account.troubleshooting_agent.email
      containers {
        image = "gcr.io/przemeksroka-joonix-service/adk-network-agent"
        env {
          name  = "GOOGLE_CLOUD_PROJECT"
          value = "przemeksroka-joonix-service"
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

# Allow unauthenticated access
data "google_iam_policy" "noauth" {
  binding {
    role = "roles/run.invoker"
    members = [
      "allUsers",
    ]
  }
}

resource "google_cloud_run_service_iam_policy" "noauth" {
  location    = google_cloud_run_service.adk_agent.location
  project     = google_cloud_run_service.adk_agent.project
  service     = google_cloud_run_service.adk_agent.name
  policy_data = data.google_iam_policy.noauth.policy_data
}
