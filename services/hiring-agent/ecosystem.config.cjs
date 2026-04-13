module.exports = {
  apps: [{
    name: "hiring-agent",
    script: "./src/cli.js",
    cwd: "/opt/hiring-agent/services/hiring-agent",
    listen_timeout: 15000,
    kill_timeout: 5000,
    env_production: {
      NODE_ENV: "production",
      PORT: 3101,
      // MANAGEMENT_DATABASE_URL is loaded via `source .env` in deploy-hiring-agent.sh
      // PM2 does not auto-read .env files
    }
  }]
};
