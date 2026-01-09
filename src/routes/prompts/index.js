import { getPrompt, postPrompt, putPrompt } from './handlers.js';
import { getPromptSchema, postPromptSchema, putPromptSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.get('/:promptId', {
		handler: getPrompt,
		schema: getPromptSchema,
	});
	fastify.post('/', {
		handler: postPrompt,
		schema: postPromptSchema,
	});
	fastify.put('/:promptId', {
		handler: putPrompt,
		schema: putPromptSchema,
	});
};

export default routes;
