import { getHealth } from './handlers.js';

const routes = async (fastify) => {
	fastify.get('/', {
		handler: getHealth,
	});
};

export default routes;
