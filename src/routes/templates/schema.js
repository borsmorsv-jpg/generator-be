export const createTemplateSchema = {
  tags: ["Templates"],
  summary: "Create new template",
  description: "Create new template",
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

export const getAllTemplatesSchema = {
  tags: ["Templates"],
  summary: "Get all templates with pagination, filtering, search and sorting",
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
          "isActive",
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

export const deleteTemplateSchema = {
  tags: ["Templates"],
  summary: "Delete template by id",
  description: "Delete a template by ID and remove associated files",
  params: {
    type: "object",
    properties: {
      id: { type: "integer" },
    },
    required: ["id"],
  },
};

export const updateTemplateSchema = {
  tags: ["Templates"],
  summary: "Update template",
  description: "Update existing template",
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
