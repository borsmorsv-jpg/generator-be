export const getPromptSchema = {
	tags: ['Prompts'],
	summary: 'Get prompt details',
	description: 'Get prompt details',
	params: {
		type: 'object',
		properties: {
			promptId: { type: 'integer' },
		},
		required: ['promptId'],
	},
};

export const postPromptSchema = {
	tags: ['Prompts'],
	summary: 'Create new prompt',
	description: 'Create new prompt',
	body: {
		type: 'object',
		required: ['promptValue'],
		properties: {
			promptValue: {
				type: 'string',
				maxLength: 1000,
			},
		},
	},
};

export const putPromptSchema = {
	tags: ['Prompts'],
	summary: 'Update prompt value',
	description: 'Update prompt value',
	params: {
		type: 'object',
		required: ['promptId'],
		properties: {
			promptId: { type: 'integer' },
		},
	},
	body: {
		type: 'object',
		required: ['promptValue'],
		properties: {
			promptValue: {
				type: 'string',
				maxLength: 1000,
			},
		},
	},
};
