import { activateSite, createSite, getAllSites, getOneSite, regenerateSite } from './handlers.js';
import {
	activateSiteSchema,
	createSiteSchema,
	getAllSitesSchema,
	getSiteSchema,
	regenerateSiteSchema,
} from './schema.js';

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
	fastify.put('/:siteId', {
		handler: regenerateSite,
		schema: regenerateSiteSchema,
	});
};

export default routes;
