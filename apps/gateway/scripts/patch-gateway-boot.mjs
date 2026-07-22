import fs from 'node:fs';
import path from 'node:path';

const file = path.join(process.cwd(), 'src', 'server.ts');
let text = fs.readFileSync(file, 'utf8');

const oldText = `    // Auto-boot G0DM0D3 in relay mode on startup so \`auto-free\` works
    // immediately without a manual /godmode/server/start. Reuses DMR-X's own
    // provider vault (no OpenRouter key required). Skipped when the proxy is
    // already initialized or disabled via DMRX_GODMODE_AUTOSTART=false.
    try {
      const { getGodmodeService } = await import('@dmr-x/godmode');
      const { setGodmodeConfig } = await import('@dmr-x/godmode');
      if ((process.env.DMRX_GODMODE_AUTOSTART ?? 'true') !== 'false' && !getGodmodeService().isInitialized()) {
        const { serverManager } = await import('@dmr-x/server-manager');
        const live = serverManager.getRunningInstance();
        const liveHealthy = live?.url
          ? await serverManager.healthCheck({ url: live.url, timeoutMs: 2500 }).catch(() => false)
          : false;
        if (liveHealthy) {
          logger.info({ url: live!.url }, 'G0DM0D3 already running and healthy — proxy ready');
        } else {
          const gatewayUrl = process.env.DMRX_GATEWAY_URL || \`http://localhost:${process.env.PORT || 47113}\`;
          // Always relay through DMR-X's own provider vault (no separate
          // OpenRouter key required). Pass an empty openrouterApiKey so the
          // child never tries to route through openrouter.ai, and force
          // llmBaseUrl so it runs in LOCAL/relay mode (auth disabled).
          const started = await serverManager.start({
            openrouterApiKey: ***
            llmBaseUrl: \`\${gatewayUrl}/v1\`,
          });
          setGodmodeConfig({
            baseUrl: started.url ?? 'http://localhost:7860',
            openrouterApiKey: ***
            llmBaseUrl: started.llm_base_url ?? \`\${gatewayUrl}/v1\`,
            llmApiKey: started.llm_api_key ?? undefined,
          });
          await getGodmodeService().initialize();
          logger.info({ url: started.url, relay: true }, 'Auto-booted G0DM0D3 proxy (relay mode → DMR-X vault)');
        }
      }
    } catch (bootErr) {
      logger.warn({ err: bootErr }, 'G0DM0D3 auto-boot failed; auto-free will fall back to a concrete model until /godmode/server/start');
    }

`;

if (!text.includes(oldText)) {
  console.error('auto-boot block not found');
  process.exit(1);
}

text = text.replace(oldText, '');
fs.writeFileSync(file, text);
console.log('Removed pre-listen auto-boot from server.ts');
