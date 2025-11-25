export const createBlockSchema = {
  tags: ["Blocks"],
  summary: "Create new block",
  description: "Create new block",
  consumes: ["multipart/form-data"],
  body: {
    type: "object",
    required: ["file", "name"],
    properties: {
      file: {
        type: "object",
        properties: {
          filename: { type: "string" },
          mimetype: { type: "string" },
          _buf: { type: "object" },
        },
      },
      category: {
        type: "object",
        properties: {
          value: { type: "string", minLength: 1 },
        },
      },
      name: {
        type: "object",
        properties: {
          value: { type: "string", minLength: 1 },
        },
      },
      isActive: {
        type: "object",
        properties: {
          value: { type: "string", enum: ["true", "false"] },
        },
      },
    },
  },
};

export const getAllBlocksSchema = {
  tags: ["Blocks"],
  summary: "Get all blocks",
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 10 },
      search: { type: "string", default: "" },
      sortBy: {
        type: "string",
        enum: ["name", "createdAt", "updatedAt"],
        default: "name",
      },
      sortOrder: { type: "string", enum: ["asc", "desc"], default: "asc" },
    },
  },
};

export const deleteBlockSchema = {
  tags: ["Blocks"],
  summary: "Delete block by id",
  description: "Delete a block by ID and remove associated files",
  params: {
    type: "object",
    properties: {
      id: { type: "integer" },
    },
    required: ["id"],
  },
};
