import { logger } from '@dmr-x/utils';
export class EmbeddingsService {
    defaultModel = 'text-embedding-3-small';
    dimensions = 1536;
    getDefaultModel() {
        return this.defaultModel;
    }
    getDimensions() {
        return this.dimensions;
    }
    async embed(text) {
        const apiKey = process.env.OPENAI_API_KEY;
        if (apiKey) {
            return this.embedOpenAI(text, apiKey);
        }
        const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
        try {
            return await this.embedOllama(text, ollamaUrl);
        }
        catch {
            logger.warn('Ollama embedding unavailable, using hash-based fallback');
            return this.hashEmbed(text);
        }
    }
    async embedOpenAI(text, apiKey) {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: this.defaultModel,
                input: text,
                dimensions: this.dimensions,
            }),
        });
        if (!response.ok) {
            throw new Error(`OpenAI embedding failed: ${response.status}`);
        }
        const data = await response.json();
        return data.data[0].embedding;
    }
    async embedOllama(text, baseUrl) {
        const response = await fetch(`${baseUrl}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'nomic-embed-text',
                prompt: text,
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama embedding failed: ${response.status}`);
        }
        const data = await response.json();
        return data.embedding;
    }
    hashEmbed(text) {
        const dim = this.dimensions;
        const emb = new Array(dim);
        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);
        for (let i = 0; i < dim; i++) {
            let hash = 0;
            for (let j = 0; j < bytes.length; j++) {
                hash = ((hash << 5) - hash + bytes[(j + i * 7) % bytes.length]) | 0;
            }
            emb[i] = (Math.sin(hash * 0.001) + 1) / 2;
        }
        const norm = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
        return emb.map(v => v / (norm || 1));
    }
}
//# sourceMappingURL=embeddings.js.map