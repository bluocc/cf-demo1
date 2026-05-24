import { checkRateLimit } from './rate-limit.js';

const EXPIRATION_TTL = 7 * 24 * 60 * 60; // 7 days
const MAX_CONTENT_SIZE = 64 * 1024; // 64KB

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // API routes
    if (path.startsWith('/api/clipboard')) {
      return handleClipboardAPI(request, env, ctx, path);
    }

    // Static assets will be handled by the assets binding
    return env.ASSETS.fetch(request);
  },
};

async function handleClipboardAPI(request, env, ctx, path) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Extract clipboard ID from path
  const match = path.match(/^\/api\/clipboard\/?([a-zA-Z0-9]*)$/);
  if (!match) {
    return jsonResponse({ error: 'Invalid path' }, 400, corsHeaders);
  }

  const id = match[1];
  const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

  try {
    // POST /api/clipboard - Create new clipboard
    if (request.method === 'POST' && !id) {
      // Rate limit: 10 creates per hour per IP
      const rateLimitResult = await checkRateLimit(env, clientIP, 'create', 10, 3600);
      if (!rateLimitResult.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
          429,
          corsHeaders
        );
      }

      const body = await request.json();
      const content = body.content;

      if (!content && content !== '') {
        return jsonResponse({ error: 'Content is required' }, 400, corsHeaders);
      }

      if (typeof content !== 'string') {
        return jsonResponse({ error: 'Content must be a string' }, 400, corsHeaders);
      }

      if (new TextEncoder().encode(content).length > MAX_CONTENT_SIZE) {
        return jsonResponse({ error: 'Content exceeds 64KB limit' }, 400, corsHeaders);
      }

      const clipboardId = generateId();
      const data = {
        id: clipboardId,
        content,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await env.CLIPBOARD.put(`clipboard:${clipboardId}`, JSON.stringify(data), {
        expirationTtl: EXPIRATION_TTL,
      });

      return jsonResponse({ id: clipboardId, ...data }, 201, corsHeaders);
    }

    // GET /api/clipboard/:id - Get clipboard content
    if (request.method === 'GET' && id) {
      const rateLimitResult = await checkRateLimit(env, clientIP, 'read', 60, 60);
      if (!rateLimitResult.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
          429,
          corsHeaders
        );
      }

      const data = await env.CLIPBOARD.get(`clipboard:${id}`, { type: 'json' });
      if (!data) {
        return jsonResponse({ error: 'Clipboard not found' }, 404, corsHeaders);
      }

      return jsonResponse(data, 200, corsHeaders);
    }

    // PUT /api/clipboard/:id - Update clipboard content
    if (request.method === 'PUT' && id) {
      const rateLimitResult = await checkRateLimit(env, clientIP, 'update', 30, 60);
      if (!rateLimitResult.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
          429,
          corsHeaders
        );
      }

      const existing = await env.CLIPBOARD.get(`clipboard:${id}`, { type: 'json' });
      if (!existing) {
        return jsonResponse({ error: 'Clipboard not found' }, 404, corsHeaders);
      }

      const body = await request.json();
      const content = body.content;

      if (!content && content !== '') {
        return jsonResponse({ error: 'Content is required' }, 400, corsHeaders);
      }

      if (typeof content !== 'string') {
        return jsonResponse({ error: 'Content must be a string' }, 400, corsHeaders);
      }

      if (new TextEncoder().encode(content).length > MAX_CONTENT_SIZE) {
        return jsonResponse({ error: 'Content exceeds 64KB limit' }, 400, corsHeaders);
      }

      const data = {
        ...existing,
        content,
        updatedAt: Date.now(),
      };

      await env.CLIPBOARD.put(`clipboard:${id}`, JSON.stringify(data), {
        expirationTtl: EXPIRATION_TTL,
      });

      return jsonResponse(data, 200, corsHeaders);
    }

    // DELETE /api/clipboard/:id - Delete clipboard
    if (request.method === 'DELETE' && id) {
      const rateLimitResult = await checkRateLimit(env, clientIP, 'delete', 10, 60);
      if (!rateLimitResult.allowed) {
        return jsonResponse(
          { error: 'Rate limit exceeded', retryAfter: rateLimitResult.retryAfter },
          429,
          corsHeaders
        );
      }

      await env.CLIPBOARD.delete(`clipboard:${id}`);
      return jsonResponse({ success: true }, 200, corsHeaders);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  } catch (error) {
    console.error('API Error:', error);
    return jsonResponse({ error: 'Internal server error' }, 500, corsHeaders);
  }
}

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
}

function generateId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(8);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 8; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}
