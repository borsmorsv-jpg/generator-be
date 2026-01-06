import { activateSite, createSite, getAllSites, getOneSite } from './handlers.js';
import { activateSiteSchema, createSiteSchema, getAllSitesSchema, getSiteSchema } from './schema.js';

const routes = async (fastify) => {
	fastify.post('/', {
		handler: createSite,
		schema: createSiteSchema,
	});
	fastify.patch('/:siteId', {
		handler: activateSite,
		schema: activateSiteSchema,
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
