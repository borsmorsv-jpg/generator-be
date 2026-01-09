import { eq } from 'drizzle-orm';
import { db } from '../../db/connection.js';
import { prompts } from '../../db/schema.js';

export const getPrompt = async (request, reply) => {
	try {
		const { promptId } = request.params;

		const [prompt] = await db
			.select()
			.from(prompts)
			.where(eq(prompts.id, parseInt(promptId)));
		reply.send({
			success: true,
			data: {
				...prompt,
			},
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};

export const postPrompt = async (request, reply) => {
	try {
		const { promptValue } = request.body;

		if (!promptValue.trim()) {
			return reply.status(404).send({ error: 'Enter correct data' });
		}

		const [promptData] = await db
			.insert(prompts)
			.values({
				promptValue,
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.returning();

		return reply.status(201).send({
			data: {
				...promptData,
			},
			success: true,
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};

export const putPrompt = async (request, reply) => {
	try {
		const { promptId } = request.params;
		const { promptValue } = request.body;

		if (!promptValue.trim()) {
			return reply.status(404).send({ error: 'Enter correct data' });
		}

		const [promptData] = await db
			.update(prompts)
			.set({
				promptValue: promptValue,
				createdBy: '67366103-2833-41a8-aea2-10d589a0705c',
				updatedBy: '67366103-2833-41a8-aea2-10d589a0705c',
			})
			.where(eq(prompts.id, promptId))
			.returning();

		if (promptData) {
			return reply.status(404).send({ error: 'Prompt not found' });
		}

		return reply.status(200).send({
			data: {
				...promptData,
			},
			success: true,
		});
	} catch (error) {
		reply.code(400).send({
			success: false,
			error: error.message,
		});
	}
};
