const envProduction = {
  NODE_ENV: "production",
  PORT: Number(process.env.PORT ?? 3101)
};

if (process.env.APP_ENV) {
  envProduction.APP_ENV = process.env.APP_ENV;
}

if (process.env.DEPLOY_SHA) {
  envProduction.DEPLOY_SHA = process.env.DEPLOY_SHA;
}

if (process.env.MANAGEMENT_DATABASE_URL) {
  envProduction.MANAGEMENT_DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
}

module.exports = {
  apps: [{
    name: "hiring-agent",
    script: "./src/cli.js",
    cwd: "/opt/hiring-agent/services/hiring-agent",
    listen_timeout: 15000,
    kill_timeout: 5000,
    env_production: envProduction
  }]
};
