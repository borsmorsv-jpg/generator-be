import { getUsersOptions } from "./handlers.js";
import { getUsersOptionsSchema } from "./schema.js";

const routes = async (fastify) => {
  fastify.get("/options", {
    handler: getUsersOptions,
    schema: getUsersOptionsSchema,
  });
};

export default routes;
