import { logger } from '@dmr-x/utils';

export class EmbeddingsService {
  private defaultModel = 'text-embedding-3-small';
  private dimensions = 1536;

  getDefaultModel(): string {
    return this.defaultModel;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      return this.embedOpenAI(text, apiKey);
    }

    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    try {
      return await this.embedOllama(text, ollamaUrl);
    } catch {
      logger.warn('Ollama embedding unavailable, using hash-based fallback');
      return this.hashEmbed(text);
    }
  }

  private async embedOpenAI(text: string, apiKey: string): Promise<number[]> {
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

    const data = await response.json() as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  }

  private async embedOllama(text: string, baseUrl: string): Promise<number[]> {
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

    const data = await response.json() as { embedding: number[] };
    return data.embedding;
  }

  private hashEmbed(text: string): number[] {
    const dim = this.dimensions;
    const emb = new Array<number>(dim);
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
