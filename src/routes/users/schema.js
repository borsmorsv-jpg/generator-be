export const getUsersOptionsSchema = {
  tags: ["Users"],
  summary: "Get users options",
  description: "Get users options for selection cases",
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              username: { type: "string" },
              email: { type: "string", format: "email" },
            },
            required: ["id", "username", "email"],
          },
        },
      },
      required: ["success", "data"],
    },
  },
};
