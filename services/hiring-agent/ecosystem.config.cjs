module.exports = {
  apps: [{
    name: "hiring-agent",
    script: "./src/index.js",
    cwd: "/opt/hiring-agent/services/hiring-agent",
    env_production: {
      NODE_ENV: "production",
      PORT: 3100
      // DATABASE_URL is loaded via `source .env` in deploy-hiring-agent.sh
      // PM2 does not auto-read .env files
    }
  }]
};
