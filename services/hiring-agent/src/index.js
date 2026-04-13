import postgres from "postgres";
import {
  createManagementStore,
  createPoolRegistry
} from "../../../packages/access-context/src/index.js";
import { createHiringAgentApp } from "./app.js";
import { createHiringAgentServer } from "./http-server.js";

const port = Number(process.env.PORT ?? 3100);
const managementSql = process.env.MANAGEMENT_DATABASE_URL ? postgres(process.env.MANAGEMENT_DATABASE_URL) : null;
const managementStore = managementSql ? createManagementStore(managementSql) : null;
const poolRegistry = createPoolRegistry();
const app = createHiringAgentApp({ demoMode: !managementSql });

createHiringAgentServer(app, {
  managementSql,
  managementStore,
  poolRegistry,
  appEnv: process.env.APP_ENV ?? "local"
}).listen(port, () => {
  console.log(`hiring-agent listening on :${port} mode=${managementSql ? "management-auth" : "demo"}`);
});
