import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: '../wrangler.toml' },
        miniflare: {
          // Inject placeholder secrets so fetchMock-based tests can reach the
          // fetch() call without throwing "API key tidak tersedia".
          // Values are arbitrary non-empty strings — real API calls are
          // intercepted by fetchMock before they leave the workerd runtime.
          bindings: {
            ANTHROPIC_API_KEY: 'test-anthropic-key-for-mocked-tests',
            MAYAR_API_KEY_SANDBOX: 'test-mayar-sandbox-key',
            MAYAR_API_KEY: 'test-mayar-production-key',
            BYPASS_PAYMENT_SECRET: 'test-bypass-secret',
          },
        },
      },
    },
  },
});
