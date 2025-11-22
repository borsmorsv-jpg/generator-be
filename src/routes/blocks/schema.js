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
  response: {
    201: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        data: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            isActive: { type: "boolean" },
            archiveUrl: { type: "string" },
            definition: {
              type: "object",
              properties: {
                files: {
                  type: "object",
                  properties: {
                    script: {
                      type: "object",
                      properties: {
                        size: { type: "number" },
                        lines: { type: "number" }
                      }
                    },
                    styles: {
                      type: "object",
                      properties: {
                        size: { type: "number" },
                        lines: { type: "number" }
                      }
                    },
                    template: {
                      type: "object",
                      properties: {
                        size: { type: "number" },
                        lines: { type: "number" }
                      }
                    }
                  }
                },
                mimeType: { type: "string" },
                template: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    author: { type: "string" },
                    preview: { type: ["string", "null"] },
                    version: { type: "string" },
                    description: { type: "string" }
                  }
                },
                validation: {
                  type: "object",
                  properties: {
                    isValid: { type: "boolean" },
                    totalFiles: { type: "number" },
                    validatedAt: { type: "string", format: "date-time" }
                  }
                },
                archiveSize: { type: "number" },
                originalArchive: { type: "string" }
              }
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        }
      },
      required: ["success", "data"]
    },
  }
};

export const getAllBlocksSchema = {
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
      search: { type: 'string', default: '' },
      sortBy: { type: 'string', enum: ['name', 'createdAt', 'updatedAt'], default: 'name' },
      sortOrder: { type: 'string', enum: ['asc', 'desc'], default: 'asc' }
    }
  },
  response: {
    200: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              isActive: { type: 'boolean' },
              archiveUrl: { type: 'string' },
              definition: {
                type: 'object',
                properties: {
                  files: {
                    type: 'object',
                    properties: {
                      script: {
                        type: 'object',
                        properties: {
                          size: { type: 'number' },
                          lines: { type: 'number' }
                        }
                      },
                      styles: {
                        type: 'object',
                        properties: {
                          size: { type: 'number' },
                          lines: { type: 'number' }
                        }
                      },
                      template: {
                        type: 'object',
                        properties: {
                          size: { type: 'number' },
                          lines: { type: 'number' }
                        }
                      }
                    }
                  },
                  mimeType: { type: 'string' },
                  template: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      author: { type: 'string' },
                      preview: {
                        type: ['string', 'null']
                      },
                      version: { type: 'string' },
                      description: { type: 'string' }
                    }
                  },
                  validation: {
                    type: 'object',
                    properties: {
                      isValid: { type: 'boolean' },
                      totalFiles: { type: 'number' },
                      validatedAt: { type: 'string', format: 'date-time' }
                    }
                  },
                  archiveSize: { type: 'number' },
                  originalArchive: { type: 'string' }
                }
              },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          }
        },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalCount: { type: 'integer' },
            totalPages: { type: 'integer' },
            hasNext: { type: 'boolean' },
            hasPrev: { type: 'boolean' }
          },
          required: ['page', 'limit', 'totalCount', 'totalPages', 'hasNext', 'hasPrev']
        }
      },
      required: ['success', 'data', 'pagination']
    },
    400: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        error: { type: 'string' }
      },
      required: ['success', 'error']
    }
  }
};


export const deleteBlockSchema = {
  tags: ["Blocks"],
  summary: "Delete a block",
  description: "Delete a block by ID and remove associated files",
  params: {
    type: "object",
    properties: {
      id: { type: "integer" }
    },
    required: ["id"]
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        data: {
          type: "object",
          properties: {
            id: { type: "number" },
            name: { type: "string" },
            isActive: { type: "boolean" },
            archiveUrl: { type: "string" },
            definition: {
              type: "object",
              properties: {
                files: {
                  type: "object",
                  properties: {
                    script: {
                      type: "object",
                      properties: {
                        size: { type: "number" },
                        lines: { type: "number" }
                      }
                    },
                    styles: {
                      type: "object",
                      properties: {
                        size: { type: "number" },
                        lines: { type: "number" }
                      }
                    },
                    template: {
                      type: "object",
                      properties: {
                        size: { type: "number" },
                        lines: { type: "number" }
                      }
                    }
                  }
                },
                mimeType: { type: "string" },
                template: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    author: { type: "string" },
                    preview: { type: ["string", "null"] },
                    version: { type: "string" },
                    description: { type: "string" }
                  }
                },
                validation: {
                  type: "object",
                  properties: {
                    isValid: { type: "boolean" },
                    totalFiles: { type: "number" },
                    validatedAt: { type: "string", format: "date-time" }
                  }
                },
                archiveSize: { type: "number" },
                originalArchive: { type: "string" }
              }
            },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" }
          }
        },
        message: { type: "string" }
      },
      required: ["success", "data", "message"]
    },
    400: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" }
      },
      required: ["success", "error"]
    },
    404: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        error: { type: "string" }
      },
      required: ["success", "error"]
    }
  }
};