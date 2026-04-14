import postgres from "postgres";
import {
  createManagementStore,
  createPoolRegistry
} from "../../../packages/access-context/src/index.js";
import { OpenRouterAdapter } from "./openrouter-adapter.js";
import { createHiringAgentApp } from "./app.js";
import { createHiringAgentServer } from "./http-server.js";

export function resolveHiringAgentRuntime(env = process.env) {
  const appMode = env.APP_MODE ?? null;
  const appEnv = env.APP_ENV ?? null;
  const port = Number(env.PORT ?? 3100);
  const managementDatabaseUrl = env.MANAGEMENT_DATABASE_URL ?? null;
  const openRouterApiKey = env.OPENROUTER_API_KEY ?? null;
  const openRouterModel = env.OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
  const setupCommunicationPlanModel = env.OPENROUTER_SETUP_COMMUNICATION_PLAN_MODEL ?? "openai/gpt-5.4-mini";
  const setupCommunicationExamplesModel = env.OPENROUTER_SETUP_COMMUNICATION_EXAMPLES_MODEL ?? "google/gemini-2.5-flash";
  const createVacancyApplicationStepsExtractModel = env.OPENROUTER_CREATE_VACANCY_APPLICATION_STEPS_MODEL ?? "openai/gpt-5.4-mini";
  const deploySha = env.DEPLOY_SHA ?? env.GITHUB_SHA ?? "unknown";
  const startedAt = new Date().toISOString();

  if (appMode === "demo") {
    return {
      port,
      appEnv: appEnv ?? "local",
      deploySha,
      startedAt,
      demoMode: true,
      managementSql: null,
      managementStore: null,
      llmAdapter: openRouterApiKey ? new OpenRouterAdapter({ apiKey: openRouterApiKey, model: openRouterModel }) : null,
      communicationPlanLlmConfig: {
        planModel: setupCommunicationPlanModel,
        examplesModel: setupCommunicationExamplesModel
      },
      createVacancyLlmConfig: {
        applicationStepsExtractModel: createVacancyApplicationStepsExtractModel
      },
      poolRegistry: createPoolRegistry(),
      startupMode: "demo"
    };
  }

  if (!appEnv) {
    throw new Error("APP_ENV is required unless APP_MODE=demo");
  }

  if (!managementDatabaseUrl) {
    throw new Error("MANAGEMENT_DATABASE_URL is required unless APP_MODE=demo");
  }

  const managementSql = postgres(managementDatabaseUrl);
  return {
    port,
    appEnv,
    deploySha,
    startedAt,
    demoMode: false,
    managementSql,
    managementStore: createManagementStore(managementSql),
    llmAdapter: openRouterApiKey ? new OpenRouterAdapter({ apiKey: openRouterApiKey, model: openRouterModel }) : null,
    communicationPlanLlmConfig: {
      planModel: setupCommunicationPlanModel,
      examplesModel: setupCommunicationExamplesModel
    },
    createVacancyLlmConfig: {
      applicationStepsExtractModel: createVacancyApplicationStepsExtractModel
    },
    poolRegistry: createPoolRegistry(),
    startupMode: "management-auth"
  };
}

export function startHiringAgent(env = process.env) {
  const runtime = resolveHiringAgentRuntime(env);
  const app = createHiringAgentApp({
    demoMode: runtime.demoMode,
    appEnv: runtime.appEnv,
    deploySha: runtime.deploySha,
    startedAt: runtime.startedAt,
    port: runtime.port,
    managementSql: runtime.managementSql,
    llmAdapter: runtime.llmAdapter,
    communicationPlanLlmConfig: runtime.communicationPlanLlmConfig,
    createVacancyLlmConfig: runtime.createVacancyLlmConfig
  });
  const server = createHiringAgentServer(app, {
    managementSql: runtime.managementSql,
    managementStore: runtime.managementStore,
    poolRegistry: runtime.poolRegistry,
    appEnv: runtime.appEnv
  });

  return server.listen(runtime.port, () => {
    console.log(`hiring-agent listening on :${runtime.port} mode=${runtime.startupMode}`);
  });
}

if (isMainModule(import.meta.url)) {
  startHiringAgent();
}

function isMainModule(moduleUrl) {
  return moduleUrl === new URL(`file://${process.argv[1]}`).href;
}
