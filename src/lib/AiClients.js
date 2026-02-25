import OpenAI from 'openai';
import { fal } from '@fal-ai/client';

export const openai = new OpenAI({
	apiKey: process.env.OPEN_AI_KEY,
});

fal.config({
	credentials: process.env.FAL_KEY,
});

export { fal };
