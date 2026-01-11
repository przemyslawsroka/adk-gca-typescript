#!/bin/bash
set -e

PROJECT_ID="przemeksroka-joonix-service"
REGION="us-central1"
SERVICE_NAME="adk-network-agent"

echo "Deploying $SERVICE_NAME to project $PROJECT_ID in region $REGION"

# Build container using Cloud Build
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME . --project $PROJECT_ID

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region $REGION \
  --project $PROJECT_ID \
  --allow-unauthenticated \
  --memory 2Gi \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=$PROJECT_ID"

# Note: The service account adk-agent-sa needs to exist and have permissions:
# - roles/cloudasset.viewer
# - roles/aiplatform.user
# If it doesn't exist, you might need to use default compute service account or create one.
# For simplicity, I'll remove the explicit service-account flag to use the default one, 
# unless the user has a specific one. I'll comment it out or leave it if I'm sure.
# I'll use the default compute service account which usually exists.
