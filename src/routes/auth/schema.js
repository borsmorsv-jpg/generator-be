export const registerNewUserSchema = {
	tags: ['Auth'],
	summary: 'Register new user',
	description: 'Create a new user account',
	body: {
		type: 'object',
		required: ['email', 'password', 'username'],
		properties: {
			email: {
				type: 'string',
				format: 'email',
			},
			password: {
				type: 'string',
				minLength: 6,
			},
			username: {
				type: 'string',
				minLength: 2,
				maxLength: 255,
			},
		},
	},
};
