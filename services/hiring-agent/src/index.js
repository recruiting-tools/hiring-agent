import postgres from "postgres";
import { createHiringAgentApp } from "./app.js";
import { createHiringAgentServer } from "./http-server.js";

const port = Number(process.env.PORT ?? 3100);
const sql = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL) : null;
const app = createHiringAgentApp(sql);

createHiringAgentServer(app).listen(port, () => {
  console.log(`hiring-agent listening on :${port} mode=${sql ? "db" : "demo"}`);
});
