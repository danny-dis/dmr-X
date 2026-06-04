import { generateCodeVerifier, generateCodeChallenge } from './pkce.js';
import { oauthStateStore } from './state-store.js';
export class OAuthService {
    /**
     * Generate an authorization URL for the authorization_code flow.
     */
    generateAuthorizationUrl(providerId, oauthConfig, gatewayBaseUrl) {
        if (oauthConfig.flow !== 'authorization_code') {
            throw new Error(`Provider ${providerId} does not use authorization_code flow`);
        }
        const clientId = process.env[oauthConfig.clientIdEnvKey];
        if (!clientId) {
            throw new Error(`Missing OAuth client ID env var: ${oauthConfig.clientIdEnvKey}`);
        }
        const redirectUri = `${gatewayBaseUrl}${oauthConfig.redirectPath.replace(':id', providerId)}`;
        let codeVerifier;
        let codeChallenge;
        if (oauthConfig.usePKCE) {
            codeVerifier = generateCodeVerifier();
            codeChallenge = generateCodeChallenge(codeVerifier);
        }
        const state = oauthStateStore.set(providerId, codeVerifier);
        const params = new URLSearchParams({
            response_type: 'code',
            client_id: clientId,
            redirect_uri: redirectUri,
            state,
            scope: oauthConfig.scopes.join(' '),
        });
        if (codeChallenge) {
            params.set('code_challenge', codeChallenge);
            params.set('code_challenge_method', 'S256');
        }
        if (oauthConfig.audience) {
            params.set('audience', oauthConfig.audience);
        }
        const authorizationUrl = `${oauthConfig.authorizationUrl}?${params.toString()}`;
        return { authorizationUrl, state };
    }
    /**
     * Exchange an authorization code for tokens.
     */
    async handleAuthorizationCode(providerId, oauthConfig, code, state, gatewayBaseUrl) {
        if (oauthConfig.flow !== 'authorization_code') {
            throw new Error(`Provider ${providerId} does not use authorization_code flow`);
        }
        const stateEntry = oauthStateStore.consume(state);
        if (!stateEntry || stateEntry.providerId !== providerId) {
            throw new Error('Invalid or expired OAuth state parameter');
        }
        const clientId = process.env[oauthConfig.clientIdEnvKey];
        if (!clientId) {
            throw new Error(`Missing OAuth client ID env var: ${oauthConfig.clientIdEnvKey}`);
        }
        const redirectUri = `${gatewayBaseUrl}${oauthConfig.redirectPath.replace(':id', providerId)}`;
        const body = {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
        };
        if (oauthConfig.clientSecretEnvKey) {
            const clientSecret = process.env[oauthConfig.clientSecretEnvKey];
            if (clientSecret) {
                body.client_secret = clientSecret;
            }
        }
        if (stateEntry.codeVerifier) {
            body.code_verifier = stateEntry.codeVerifier;
        }
        return this.exchangeToken(oauthConfig.tokenUrl, body, oauthConfig.tokenResponseType);
    }
    /**
     * Get tokens via client credentials flow.
     */
    async handleClientCredentials(providerId, oauthConfig) {
        if (oauthConfig.flow !== 'client_credentials') {
            throw new Error(`Provider ${providerId} does not use client_credentials flow`);
        }
        const clientId = process.env[oauthConfig.clientIdEnvKey];
        const clientSecret = oauthConfig.clientSecretEnvKey
            ? process.env[oauthConfig.clientSecretEnvKey]
            : undefined;
        if (!clientId) {
            throw new Error(`Missing OAuth client ID env var: ${oauthConfig.clientIdEnvKey}`);
        }
        if (!clientSecret && oauthConfig.clientSecretEnvKey) {
            throw new Error(`Missing OAuth client secret env var: ${oauthConfig.clientSecretEnvKey}`);
        }
        const body = {
            grant_type: 'client_credentials',
            client_id: clientId,
        };
        if (clientSecret) {
            body.client_secret = clientSecret;
        }
        if (oauthConfig.scopes.length > 0) {
            body.scope = oauthConfig.scopes.join(' ');
        }
        return this.exchangeToken(oauthConfig.tokenUrl, body, oauthConfig.tokenResponseType);
    }
    /**
     * Initiate device code flow.
     */
    async handleDeviceCode(providerId, oauthConfig) {
        if (oauthConfig.flow !== 'device_code') {
            throw new Error(`Provider ${providerId} does not use device_code flow`);
        }
        const clientId = process.env[oauthConfig.clientIdEnvKey];
        if (!clientId) {
            throw new Error(`Missing OAuth client ID env var: ${oauthConfig.clientIdEnvKey}`);
        }
        const deviceCodeUrl = oauthConfig.deviceCodeUrl || oauthConfig.tokenUrl;
        const body = {
            client_id: clientId,
            scope: oauthConfig.scopes.join(' '),
        };
        const response = await fetch(deviceCodeUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: new URLSearchParams(body).toString(),
            redirect: 'error',
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Device code request failed (${response.status}): ${text}`);
        }
        const data = await response.json();
        return {
            deviceCode: data.device_code,
            userCode: data.user_code,
            verificationUri: data.verification_uri,
            expiresIn: data.expires_in || 600,
        };
    }
    /**
     * Poll for device code authorization.
     */
    async pollDeviceCode(providerId, oauthConfig, deviceCode) {
        if (oauthConfig.flow !== 'device_code') {
            throw new Error(`Provider ${providerId} does not use device_code flow`);
        }
        const clientId = process.env[oauthConfig.clientIdEnvKey];
        if (!clientId) {
            throw new Error(`Missing OAuth client ID env var: ${oauthConfig.clientIdEnvKey}`);
        }
        const body = {
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: clientId,
        };
        if (oauthConfig.clientSecretEnvKey) {
            const clientSecret = process.env[oauthConfig.clientSecretEnvKey];
            if (clientSecret) {
                body.client_secret = clientSecret;
            }
        }
        return this.exchangeToken(oauthConfig.tokenUrl, body, oauthConfig.tokenResponseType);
    }
    /**
     * Refresh an access token using a refresh token.
     */
    async refreshAccessToken(oauthConfig, refreshToken) {
        const clientId = process.env[oauthConfig.clientIdEnvKey];
        if (!clientId) {
            throw new Error(`Missing OAuth client ID env var: ${oauthConfig.clientIdEnvKey}`);
        }
        const body = {
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
        };
        if (oauthConfig.clientSecretEnvKey) {
            const clientSecret = process.env[oauthConfig.clientSecretEnvKey];
            if (clientSecret) {
                body.client_secret = clientSecret;
            }
        }
        return this.exchangeToken(oauthConfig.tokenUrl, body, 'access_refresh');
    }
    /**
     * Exchange a grant for tokens at the token endpoint.
     */
    async exchangeToken(tokenUrl, body, responseType) {
        const response = await fetch(tokenUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
            },
            body: new URLSearchParams(body).toString(),
            redirect: 'error',
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            throw new Error(`Token exchange failed (${response.status}): ${text}`);
        }
        const data = await response.json();
        const accessToken = data.access_token;
        if (!accessToken) {
            throw new Error('Token response missing access_token');
        }
        const refreshToken = responseType === 'access_refresh'
            ? data.refresh_token ?? null
            : null;
        const expiresIn = data.expires_in;
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
        return { accessToken, refreshToken, expiresAt };
    }
}
//# sourceMappingURL=oauth.service.js.map