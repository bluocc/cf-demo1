/**
 * Rate limiting using KV storage
 * @param {object} env - Worker environment with CLIPBOARD KV binding
 * @param {string} ip - Client IP address
 * @param {string} action - Action type (create, read, update, delete)
 * @param {number} maxRequests - Maximum requests allowed in the window
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Promise<{allowed: boolean, retryAfter?: number}>}
 */
export async function checkRateLimit(env, ip, action, maxRequests, windowSeconds) {
  const key = `ratelimit:${ip}:${action}`;
  const now = Math.floor(Date.now() / 1000);

  try {
    const data = await env.CLIPBOARD.get(key, { type: 'json' });

    if (!data) {
      // First request, create new record
      await env.CLIPBOARD.put(
        key,
        JSON.stringify({
          count: 1,
          windowStart: now,
        }),
        { expirationTtl: windowSeconds * 2 }
      );
      return { allowed: true };
    }

    const { count, windowStart } = data;
    const windowElapsed = now - windowStart;

    if (windowElapsed >= windowSeconds) {
      // Window expired, reset
      await env.CLIPBOARD.put(
        key,
        JSON.stringify({
          count: 1,
          windowStart: now,
        }),
        { expirationTtl: windowSeconds * 2 }
      );
      return { allowed: true };
    }

    if (count >= maxRequests) {
      // Rate limit exceeded
      const retryAfter = windowSeconds - windowElapsed;
      return { allowed: false, retryAfter };
    }

    // Increment counter
    await env.CLIPBOARD.put(
      key,
      JSON.stringify({
        count: count + 1,
        windowStart,
      }),
      { expirationTtl: windowSeconds * 2 }
    );
    return { allowed: true };
  } catch (error) {
    // On error, allow the request (fail open)
    console.error('Rate limit check failed:', error);
    return { allowed: true };
  }
}
