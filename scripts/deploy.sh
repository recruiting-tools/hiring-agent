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
SERVICE="${SERVICE:-candidate-chatbot-v2}"
PROJECT="project-5d8dd8a0-67af-44ba-b6e"
REGION="europe-west1"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE"
APP_ENV="${APP_ENV:-production}"
EXTERNAL_MODE="${EXTERNAL_MODE:-live}"
LLM_MODE="${LLM_MODE:-live}"
SECRET_PROFILE="${SECRET_PROFILE:-default}"
DB_SECRET_ENV="${DB_SECRET_ENV:-CHATBOT_DATABASE_URL}"   # env var name inside the container
DB_SECRET_NAME="${DB_SECRET_NAME:-V2_PROD_NEON_URL}"    # GCP Secret Manager secret name (unchanged)
IS_SANDBOX=false
if [ "$SECRET_PROFILE" = "sandbox" ]; then
  IS_SANDBOX=true
  SERVICE="candidate-chatbot-v2-sandbox"
  IMAGE="$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/$SERVICE"
  for required_var in SANDBOX_DATABASE_URL SANDBOX_DEMO_EMAIL SANDBOX_DEMO_PASSWORD; do
    if [ -z "${!required_var:-}" ]; then
      echo "ERROR: $required_var is required for sandbox deploy"
      exit 1
    fi
  done
fi
ENV_VARS="USE_REAL_DB=true,NODE_ENV=production,HH_SEND_ENABLED=false,OUTBOUND_SEND_ENABLED=false,DEPLOY_SHA=$DEPLOY_SHA,DEPLOY_TIME=$DEPLOY_TIME,APP_ENV=$APP_ENV,EXTERNAL_MODE=$EXTERNAL_MODE,LLM_MODE=$LLM_MODE"
if [ -n "${EXTRA_ENV_VARS:-}" ]; then
  ENV_VARS="$ENV_VARS,$EXTRA_ENV_VARS"
fi
if [ "$SECRET_PROFILE" = "sandbox" ]; then
  SECRETS="$DB_SECRET_ENV=$DB_SECRET_NAME:latest,SESSION_SECRET=SESSION_SECRET:latest"
else
  SECRETS="GEMINI_API_KEY=GEMINI_API_KEY:latest,$DB_SECRET_ENV=$DB_SECRET_NAME:latest,SESSION_SECRET=SESSION_SECRET:latest,HH_CLIENT_ID=HH_CLIENT_ID:latest,HH_CLIENT_SECRET=HH_CLIENT_SECRET:latest,TELEGRAM_BOT_TOKEN=TELEGRAM_BOT_TOKEN:latest"
fi

echo "Deploying $SERVICE @ $DEPLOY_SHA..."

# Run database migrations before deploying (local runs only; CI handles this in a separate workflow step)
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  echo "Running database migrations..."
  DB_URL=$(gcloud secrets versions access latest --secret="$DB_SECRET_NAME" --project="$PROJECT" 2>&1)
  DATABASE_URL="$DB_URL" node scripts/migrate.js
  echo "Migrations complete."
fi

set +e

if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
  echo "CI mode detected: deploying directly from source..."
  deploy_output=$(gcloud run deploy "$SERVICE" \
    --source . \
    --region "$REGION" \
    --project "$PROJECT" \
    --set-secrets "$SECRETS" \
    --set-env-vars "$ENV_VARS" \
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
fi

# Step 1: build image via Cloud Build (~30s)
echo "Step 1/2: building Docker image..."
build_output=$(gcloud builds submit . --tag "$IMAGE" --project "$PROJECT" --quiet --async --format=json 2>&1)
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

build_json=$(echo "$build_output" | sed -n '/^{/,$p')
build_id=$(echo "$build_json" | jq -r '.metadata.build.id // .id // empty')
if [ -z "$build_id" ]; then
  echo "Build FAILED: unable to parse Cloud Build id"
  echo "$build_output"
  exit 1
fi

echo "Cloud Build started: $build_id"

build_status=""
while true; do
  build_status=$(gcloud builds describe "$build_id" --project "$PROJECT" --format='value(status)' 2>/dev/null || true)
  case "$build_status" in
    SUCCESS)
      echo "Build succeeded."
      break
      ;;
    FAILURE|INTERNAL_ERROR|TIMEOUT|CANCELLED|EXPIRED)
      echo "Build FAILED with status: $build_status"
      gcloud builds describe "$build_id" --project "$PROJECT" --format=json || true
      exit 1
      ;;
    *)
      echo "Build status: ${build_status:-UNKNOWN}; waiting..."
      sleep 5
      ;;
  esac
done

# Step 2: deploy the image to Cloud Run (~10s)
echo "Step 2/2: deploying to Cloud Run..."
deploy_output=$(gcloud run deploy "$SERVICE" \
  --image "$IMAGE:latest" \
  --region "$REGION" \
  --project "$PROJECT" \
  --set-secrets "$SECRETS" \
  --set-env-vars "$ENV_VARS" \
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

  if [ "$IS_SANDBOX" = true ]; then
    service_url=$(gcloud run services describe "$SERVICE" \
      --region "$REGION" \
      --project "$PROJECT" \
      --format 'value(status.url)')
    echo "Service URL: $service_url"

    SANDBOX_BASE_URL="$service_url" \
    SANDBOX_DEMO_EMAIL="$SANDBOX_DEMO_EMAIL" \
    SANDBOX_DEMO_PASSWORD="$SANDBOX_DEMO_PASSWORD" \
    SANDBOX_SECONDARY_DEMO_EMAIL="${SANDBOX_SECONDARY_DEMO_EMAIL:-}" \
    SANDBOX_SECONDARY_DEMO_PASSWORD="${SANDBOX_SECONDARY_DEMO_PASSWORD:-}" \
    SANDBOX_SECONDARY_DEMO_RECRUITER_TOKEN="${SANDBOX_SECONDARY_DEMO_RECRUITER_TOKEN:-}" \
    pnpm smoke:sandbox
  else
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
  fi
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
