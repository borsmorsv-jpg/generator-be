import { db, supabase } from '../../db/connection.js';
import { profiles } from '../../db/schema.js';

export const registerNewUser = async (request, reply) => {
	try {
		const { email, password, username } = request.body;

		const { data, error } = await supabase.auth.admin.createUser({
			email,
			password,
			email_confirm: true,
		});

		if (error) {
			return reply.status(400).send({
				success: false,
				error: error.message || 'Failed to register user',
			});
		}

		const user = data.user;

		await db.insert(profiles).values({
			userId: user.id,
			email: user.email,
			username,
		});

		return reply.status(201).send({
			success: true,
			data: {
				id: user.id,
				email: user.email,
				username,
				createdAt: new Date().toISOString(),
			},
		});
	} catch (error) {
		console.error('Register error:', error);

		return reply.status(400).send({
			success: false,
			error: error.message || 'Unexpected error',
		});
	}
};
