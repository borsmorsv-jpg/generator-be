import {getAllBlocks, createBlock, deleteBlock} from "./handlers.js";
import {getAllBlocksSchema, createBlockSchema, deleteBlockSchema} from "./schema.js";
import multipart from "@fastify/multipart";

const routes = async (fastify) => {
  fastify.register(multipart, {
    attachFieldsToBody: true, // <-- this is the fix
    limits: {
      fileSize: 100 * 1024 * 1024,
    },
  });

  fastify.get("/", {
    handler: getAllBlocks,
    schema: getAllBlocksSchema,
  });
  fastify.post("/", {
    handler: createBlock,
    schema: createBlockSchema,
  });
  fastify.delete("/:id", {
    handler: deleteBlock,
    schema: deleteBlockSchema,
  });
};

export default routes;
