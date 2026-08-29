import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const ZapeeraNew = service("Zapeera-New", {
    source: github("MuhammadMajidWarraich/Zapeera-New", { branch: "main", rootDirectory: "backend-zapeera-v1-main" }),
    build: "npm run build:prod:force",
    start: "node dist/server.js",
    healthcheck: "/api/health",
    replicas: { "us-west2": 1 },
    networking: { privateNetworkEndpoint: "zapeera-new" },
    env: { DATABASE_URL: preserve(), JWT_SECRET: preserve(), NODE_ENV: preserve(), Neon: preserve() },
  });

  return project("zapeera", {
    resources: [ZapeeraNew],
  });
});
