export const createSiteSchema = {
	tags: ['Sites'],
	summary: 'Create new site',
	description: 'Create new site',
	body: {
		type: 'object',
		required: ['templatesIds'],
		properties: {
			templatesIds: {
				type: 'array',
				items: {
					type: 'number',
				},
				minItems: 1,
				uniqueItems: true,
			},
			prompt: {
				type: 'string',
				maxLength: 5000,
			},
			isActive: {
				type: 'boolean',
			},
			name: {
				type: 'string',
				maxLength: 100,
			},
			trafficSource: {
				type: 'string',
				maxLength: 50,
			},
			country: {
				type: 'string',
				maxLength: 50,
			},
			language: {
				type: 'string',
				maxLength: 50,
			},
		},
	},
};

export const getAllSitesSchema = {
	tags: ['Sites'],
	summary: 'Get all sites with pagination, filtering, search and sorting',
	querystring: {
		type: 'object',
		properties: {
			page: { type: 'integer', minimum: 1, default: 1 },
			limit: { type: 'integer', minimum: 1, maximum: 250, default: 20 },
			searchByName: { type: 'string' },
			createdByUserId: { type: 'string' },
			updatedByUserId: { type: 'string' },
			searchById: { type: 'string' },
			sortBy: {
				type: 'string',
				enum: [
					'id',
					'name',
					'category',
					'isActive',
					'archiveUrl',
					'createdAt',
					'updatedAt',
					'createdByEmail',
					'createdByUsername',
					'updatedByEmail',
					'updatedByUsername',
				],
				default: 'createdAt',
			},

			sortOrder: {
				type: 'string',
				enum: ['asc', 'desc'],
				default: 'desc',
			},

			isActive: {
				type: 'string',
				enum: ['true', 'false'],
			},
			createdBy: { type: 'string', format: 'uuid' },
			updatedBy: { type: 'string', format: 'uuid' },
			createdAtFrom: { type: 'string', format: 'date-time' },
			createdAtTo: { type: 'string', format: 'date-time' },
			updatedAtFrom: { type: 'string', format: 'date-time' },
			updatedAtTo: { type: 'string', format: 'date-time' },
		},
	},
};
export const getSiteSchema = {
	tags: ['Sites'],
	summary: 'Get site details',
	description: 'Get site details',
	params: {
		type: 'object',
		properties: {
			siteId: { type: 'integer' },
		},
		required: ['siteId'],
	},
};

export const activateSiteSchema = {
	tags: ['Sites'],
	summary: 'Activate generated site',
	description: 'Activate generated site',
	params: {
		type: 'object',
		properties: {
			siteId: { type: 'integer' },
		},
		required: ['siteId'],
	},
};
