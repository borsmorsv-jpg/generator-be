import Fastify from "fastify";
import blocksRoutes from "./routes/blocks/index.js";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
// import multipart from "@fastify/multipart";

const fastify = Fastify({
  logger: true,
});

await fastify.register(swagger, {
  openapi: {
    info: { title: "Test API", version: "1.0.0" },
  },
});

// fastify.register(multipart, {
//   attachFieldsToBody: true, // <-- this is the fix
//   // sharedSchemaId: "MultipartFileType",
//   addToBody: true,
//   limits: {
//     fileSize: 100 * 1024 * 1024,
//   },
// });

await fastify.register(swaggerUi, { routePrefix: "/docs" });

fastify.register(blocksRoutes, { prefix: "api/v1/blocks" });

try {
  await fastify.listen({ port: 3000 });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
