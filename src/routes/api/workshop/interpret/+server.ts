import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { AIPipe, OpenRouterProvider } from '$lib/ai-pipe';
import { interpretCardPhoto } from '$lib/workshop/interpret';
import { interpretArrangement } from '$lib/workshop/interpret';
import { CardArrangementSchema } from '$lib/workshop/card-schemas';

export async function POST({ request }: { request: Request }) {
    const apiKey = env.OPENROUTER_API_KEY;
    if (!apiKey) {
        return json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
    }

    const body = await request.json();
    const { imageBase64, mediaType, mode } = body as {
        imageBase64?: string;
        mediaType?: string;
        mode?: 'photo' | 'arrangement';
    };

    // Mode: interpret a pre-built arrangement (no API call needed)
    if (mode === 'arrangement' && body.arrangement) {
        const parsed = CardArrangementSchema.safeParse(body.arrangement);
        if (!parsed.success) {
            return json({ error: 'Invalid arrangement', details: parsed.error.issues }, { status: 400 });
        }
        const result = interpretArrangement(parsed.data);
        return json(result);
    }

    // Mode: interpret a photo via vision API
    if (!imageBase64) {
        return json({ error: 'imageBase64 is required' }, { status: 400 });
    }

    try {
        // Use a vision-capable model via OpenRouter
        const provider = new OpenRouterProvider({
            apiKey,
            model: 'anthropic/claude-sonnet-4',
        });
        const pipe = new AIPipe(provider);

        const result = await interpretCardPhoto(
            imageBase64,
            mediaType || 'image/jpeg',
            pipe,
        );

        return json(result);
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return json({ error: message }, { status: 500 });
    }
}
