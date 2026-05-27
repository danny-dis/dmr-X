import axios from 'axios';
import { UnifiedRequest, UnifiedResponse } from '@dmr-x/core';

export class TestClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string = 'http://localhost:3000', apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async request<T = UnifiedResponse>(path: string, requestBody: UnifiedRequest): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await axios.post(`${this.baseUrl}${path}`, requestBody, { headers });
    return response.data;
  }

  async getModels() {
    const response = await axios.get(`${this.baseUrl}/v1/models`);
    return response.data;
  }
}
