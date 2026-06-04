export class VectorSearch {
    cosineSimilarity(a, b) {
        if (a.length !== b.length || a.length === 0)
            return 0;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        return denom === 0 ? 0 : dot / denom;
    }
    topK(query, vectors, k) {
        const scored = vectors.map(v => ({
            id: v.id,
            score: this.cosineSimilarity(query, v.embedding),
        }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, k);
    }
}
//# sourceMappingURL=vector-search.js.map