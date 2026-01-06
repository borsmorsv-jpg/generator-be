import { createSite, getAllSites, getOneSite } from './handlers.js';
import { createSiteSchema, getAllSitesSchema, getSiteSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.post('/', {
		handler: createSite,
		schema: createSiteSchema,
	});

	fastify.get('/', {
		handler: getAllSites,
		schema: getAllSitesSchema,
	});
	fastify.get('/:siteId', {
		handler: getOneSite,
		schema: getSiteSchema,
	});
};

export default routes;
