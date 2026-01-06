import { profiles } from '../../db/schema.js';
import { db } from '../../db/connection.js';

export const getUsersOptions = async (request, reply) => {
	try {
		const data = await db
			.select({
				id: profiles.userId,
				username: profiles.username,
				email: profiles.email,
			})
			.from(profiles);

		return reply.code(200).send({
			success: true,
			data,
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};
