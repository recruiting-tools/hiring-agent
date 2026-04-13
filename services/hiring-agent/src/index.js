import { createHiringAgentApp } from "./app.js";
import { createHiringAgentServer } from "./http-server.js";

const port = Number(process.env.PORT ?? 3100);
const app = createHiringAgentApp();

createHiringAgentServer(app).listen(port, () => {
  console.log(`hiring-agent listening on :${port}`);
});
