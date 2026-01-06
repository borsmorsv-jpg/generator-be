import { registerNewUser } from './handlers.js';
import { registerNewUserSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.post('/sign-up', {
		handler: registerNewUser,
		schema: registerNewUserSchema,
	});
};

export default routes;
