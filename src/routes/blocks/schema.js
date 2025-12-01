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
      description: {
        type: "object",
        properties: {
          value: { type: "string" },
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
  summary: "Get all blocks with pagination, filtering, search and sorting",
  querystring: {
    type: "object",
    properties: {
      page: { type: "integer", minimum: 1, default: 1 },
      limit: { type: "integer", minimum: 1, maximum: 250, default: 20 },
      searchByName: { type: "string" },
      searchById: { type: "string" },
      sortBy: {
        type: "string",
        enum: [
          "id",
          "name",
          "category",
          "isActive",
          "archiveUrl",
          "createdAt",
          "updatedAt",
          "createdByEmail",
          "createdByUsername",
          "updatedByEmail",
          "updatedByUsername",
        ],
        default: "createdAt",
      },

      sortOrder: {
        type: "string",
        enum: ["asc", "desc"],
        default: "desc",
      },

      category: { type: "string" },
      isActive: {
        type: "string",
        enum: ["true", "false"],
      },
      createdBy: { type: "string", format: "uuid" },
      updatedBy: { type: "string", format: "uuid" },
      createdAtFrom: { type: "string", format: "date-time" },
      createdAtTo: { type: "string", format: "date-time" },
      updatedAtFrom: { type: "string", format: "date-time" },
      updatedAtTo: { type: "string", format: "date-time" },
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

export const updateBlockSchema = {
  tags: ["Blocks"],
  summary: "Update block",
  description: "Update existing block",
  consumes: ["multipart/form-data"],
  params: {
    type: "object",
    properties: {
      id: { type: "integer" },
    },
    required: ["id"],
  },
  body: {
    type: "object",
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
        properties: { value: { type: "string" } },
      },
      description: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      },
      name: {
        type: "object",
        properties: { value: { type: "string" } },
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
