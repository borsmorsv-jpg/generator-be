import {createTemplate, getAllTemplates, deleteTemplate, updateTemplate} from "./handlers.js";
import {
  getAllTemplatesSchema,
  deleteTemplateSchema,
  updateTemplateSchema,
  createTemplateSchema
} from "./schema.js";
import multipart from "@fastify/multipart";

const routes = async (fastify) => {
  fastify.register(multipart, {
    attachFieldsToBody: true,
    limits: {
      fileSize: 100 * 1024 * 1024,
    },
  });

  fastify.get("/", {
    handler: getAllTemplates,
    schema: getAllTemplatesSchema,
  });
  fastify.post("/", {
    handler: createTemplate,
    schema: createTemplateSchema,
  });
  fastify.put("/:id", {
    handler: updateTemplate,
    schema: updateTemplateSchema,
  });
  fastify.delete("/:id", {
    handler: deleteTemplate,
    schema: deleteTemplateSchema,
  });
};

export default routes;
