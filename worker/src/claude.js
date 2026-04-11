export async function callClaude(env, systemPrompt, userContent, maxTokens = 2000, model = null) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('API key tidak tersedia');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 40000);

  const messages = [];

  // Build message content
  if (typeof userContent === 'string') {
    messages.push({ role: 'user', content: userContent });
  } else if (userContent && userContent.type && userContent.data) {
    if (userContent.type === 'txt') {
      // Plain text — send directly as text message
      messages.push({ role: 'user', content: userContent.data });
    } else {
      // PDF document block (DOCX is handled before reaching callClaude)
      messages.push({
        role: 'user',
        content: [{
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: userContent.data }
        }]
      });
    }
  }

  const selectedModel = model || (env.ENVIRONMENT === 'production' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001');

  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    // Only send PDF beta header for models that support it (not Haiku extraction calls)
    ...(selectedModel !== 'claude-haiku-4-5-20251001' ? { 'anthropic-beta': 'pdfs-2024-09-25' } : {}),
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: maxTokens,
        temperature: 0,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const event = res.status === 429 ? 'claude_rate_limited' : 'claude_api_error';
      console.error(JSON.stringify({
        event,
        ts: Date.now(),
        status: res.status,
        message: err.error?.message || '',
        model: selectedModel,
      }));
      throw new Error(err.error?.message || `Claude API error: ${res.status}`);
    }

    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Analisis timeout. Coba lagi.');
    throw e;
  }
}
