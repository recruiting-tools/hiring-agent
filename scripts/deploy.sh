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
PUBLIC_URL="${DEPLOY_PUBLIC_URL:-https://candidate-chatbot.recruiter-assistant.com}"
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

  echo "Post-deploy smoke: checking $PUBLIC_URL..."
  root_body=$(mktemp)
  set +e
  root_status=$(curl -sS -o "$root_body" -w "%{http_code}" "$PUBLIC_URL/" 2>&1)
  root_curl_exit=$?
  login_body=$(mktemp)
  login_status=$(curl -sS -o "$login_body" -w "%{http_code}" "$PUBLIC_URL/login" 2>&1)
  login_curl_exit=$?
  health_body=$(mktemp)
  health_status=$(curl -sS -o "$health_body" -w "%{http_code}" "$PUBLIC_URL/health" 2>&1)
  health_curl_exit=$?
  set -e

  if [ $root_curl_exit -ne 0 ] || [ $login_curl_exit -ne 0 ] || [ $health_curl_exit -ne 0 ]; then
    echo "Post-deploy smoke FAILED: curl error"
    echo "GET /: $root_status"
    echo "GET /login: $login_status"
    echo "GET /health: $health_status"
    exit_code=1
  elif ! [[ "$root_status" =~ ^(2|3)[0-9][0-9]$ ]]; then
    echo "Post-deploy smoke FAILED: GET / returned HTTP $root_status"
    cat "$root_body"
    exit_code=1
  elif grep -q '"error":"not_found"' "$root_body"; then
    echo "Post-deploy smoke FAILED: GET / returned not_found JSON"
    cat "$root_body"
    exit_code=1
  elif [ "$login_status" != "200" ] || ! grep -qi "<html" "$login_body"; then
    echo "Post-deploy smoke FAILED: GET /login did not return HTML 200"
    echo "HTTP $login_status"
    cat "$login_body"
    exit_code=1
  elif [ "$health_status" != "200" ] || ! grep -q '"status":"ok"' "$health_body"; then
    echo "Post-deploy smoke FAILED: GET /health did not return ok 200"
    echo "HTTP $health_status"
    cat "$health_body"
    exit_code=1
  else
    echo "Post-deploy smoke succeeded."
  fi

  rm -f "$root_body" "$login_body" "$health_body"
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
