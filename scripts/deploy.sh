#!/bin/bash
# Deploy candidate-chatbot-v2 to Cloud Run.
# Usage: [DEPLOY_CALLBACK_URL=<url>] ./scripts/deploy.sh
set -e

DEPLOY_SHA=$(git rev-parse HEAD)
DEPLOY_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
CALLBACK_URL="${DEPLOY_CALLBACK_URL:-}"
SERVICE="candidate-chatbot-v2"
PROJECT="project-5d8dd8a0-67af-44ba-b6e"
REGION="europe-west1"

echo "Deploying $SERVICE @ $DEPLOY_SHA..."

set +e
deploy_output=$(gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT" \
  --set-secrets "GEMINI_API_KEY=GEMINI_API_KEY:latest,V2_PROD_NEON_URL=V2_PROD_NEON_URL:latest,SESSION_SECRET=SESSION_SECRET:latest,HH_CLIENT_ID=HH_CLIENT_ID:latest,HH_CLIENT_SECRET=HH_CLIENT_SECRET:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest" \
  --set-env-vars "USE_REAL_DB=true,NODE_ENV=production,HH_SEND_ENABLED=false,OUTBOUND_SEND_ENABLED=false,DEPLOY_SHA=$DEPLOY_SHA,DEPLOY_TIME=$DEPLOY_TIME" \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --min-instances 0 \
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
