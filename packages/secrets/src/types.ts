export interface SecretVersion {
  id: string;
  secretId: string;
  version: number;
  encryptedValue: string;
  status: 'active' | 'rotated' | 'revoked';
  createdAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
}

export interface SecretsProvider {
  get(secretId: string): Promise<SecretVersion | null>;
  put(secretId: string, plaintext: string): Promise<SecretVersion>;
  rotate(secretId: string, newPlaintext: string): Promise<SecretVersion>;
  revoke(secretId: string): Promise<void>;
  listVersions(secretId: string): Promise<SecretVersion[]>;
  getActiveVersion(secretId: string): Promise<SecretVersion | null>;
}
