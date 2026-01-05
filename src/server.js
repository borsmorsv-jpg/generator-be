import Fastify from "fastify";
import blocksRoutes from "./routes/blocks/index.js";
import templatesRoutes from "./routes/templates/index.js";
import authRoutes from "./routes/auth/index.js";
import usersRoutes from "./routes/users/index.js";
import sitesRoutes from "./routes/sites/index.js";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config/index.js";
import corsPlugin from "./plugins/cors.js";

const fastify = Fastify({
  logger: true,
});

await fastify.register(corsPlugin);
await fastify.register(swagger, {
  openapi: {
    info: { title: "WP Generator API", version: "0.0.1" },
  },
});

await fastify.register(swaggerUi, { routePrefix: "/docs" });

fastify.register(blocksRoutes, { prefix: "api/v1/blocks" });
fastify.register(templatesRoutes, { prefix: "api/v1/templates" });
fastify.register(usersRoutes, { prefix: "api/v1/users" });
fastify.register(authRoutes, { prefix: "api/v1/auth" });
fastify.register(sitesRoutes, { prefix: "api/v1/sites" });

try {
  await fastify.listen({
    port: config.port,
    host: config.host,
  });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
