#!/bin/bash
# Deploy candidate-chatbot-v2 to Cloud Run.
# Usage: [DEPLOY_CALLBACK_URL=<url>] ./scripts/deploy.sh
#
# NOTE: uses two-step approach (build then deploy) instead of --source in one shot.
# Reason: `gcloud run deploy --source` hangs when run inside a Claude Code agent session
# (process gets killed mid-upload on session restart, exit 144). Splitting into
# `gcloud builds submit` + `gcloud run deploy --image` is faster and reliable.
set -e

DEPLOY_SHA=$(git rev-parse HEAD)
DEPLOY_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CALLBACK_URL="${DEPLOY_CALLBACK_URL:-}"
SERVICE="candidate-chatbot-v2"
PROJECT="project-5d8dd8a0-67af-44ba-b6e"
REGION="europe-west1"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE"

echo "Deploying $SERVICE @ $DEPLOY_SHA..."

set +e

# Step 1: build image via Cloud Build (~30s)
echo "Step 1/2: building Docker image..."
build_output=$(gcloud builds submit . --tag "$IMAGE" --project "$PROJECT" --quiet 2>&1)
build_exit=$?

if [ $build_exit -ne 0 ]; then
  echo "Build FAILED:"
  echo "$build_output"
  if [ -n "$CALLBACK_URL" ]; then
    curl -s -X POST "$CALLBACK_URL" \
      -H "Content-Type: application/json" \
      -d "{\"status\":\"failed\",\"sha\":\"$DEPLOY_SHA\",\"service\":\"$SERVICE\",\"output\":$(echo "$build_output" | jq -R -s .)}"
  fi
  exit $build_exit
fi

echo "Build succeeded."

# Step 2: deploy the image to Cloud Run (~10s)
echo "Step 2/2: deploying to Cloud Run..."
deploy_output=$(gcloud run deploy "$SERVICE" \
  --image "$IMAGE:latest" \
  --region "$REGION" \
  --project "$PROJECT" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,V2_PROD_NEON_URL=V2_PROD_NEON_URL:latest,SESSION_SECRET=SESSION_SECRET:latest,HH_CLIENT_ID=HH_CLIENT_ID:latest,HH_CLIENT_SECRET=HH_CLIENT_SECRET:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest" \
  --set-env-vars "USE_REAL_DB=true,NODE_ENV=production,HH_SEND_ENABLED=false,OUTBOUND_SEND_ENABLED=false,DEPLOY_SHA=$DEPLOY_SHA,DEPLOY_TIME=$DEPLOY_TIME" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --min-instances 0 \
  --quiet \
  2>&1)
exit_code=$?
set -e

if [ $exit_code -eq 0 ]; then
  echo "Deploy succeeded."
else
  echo "Deploy FAILED:"
  echo "$deploy_output"
fi

if [ -n "$CALLBACK_URL" ]; then
  status=$( [ $exit_code -eq 0 ] && echo "success" || echo "failed" )
  curl -s -X POST "$CALLBACK_URL" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"$status\",\"sha\":\"$DEPLOY_SHA\",\"service\":\"$SERVICE\",\"output\":$(echo "$deploy_output" | jq -R -s .)}"
fi

exit $exit_code
