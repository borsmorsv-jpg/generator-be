import {createSite, getAllSites} from "./handlers.js";
import {
  createSiteSchema, getAllSitesSchema
} from "./schema.js";

const routes = async (fastify) => {

  fastify.post("/", {
    handler: createSite,
    schema: createSiteSchema,
  });

  fastify.get("/", {
    handler: getAllSites,
    schema: getAllSitesSchema,
  });

};

export default routes;
