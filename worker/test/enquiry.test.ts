/// <reference path="../worker-configuration.d.ts" />

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/index';

const origin = 'https://whewaydrones.co.uk';

const validFields = {
  name: 'Kwame Wheway',
  email: 'visitor@example.com',
  location: 'Taunton, Somerset',
  phone: '',
  service: 'Mapped site',
  message: 'I need an orthomosaic and a visual model of a small property.',
  'cf-turnstile-response': 'valid-token',
};

const makeRequest = (
  fields: Record<string, string> = validFields,
  options: { origin?: string; ip?: string; accept?: string } = {},
) => new Request('https://forms.whewaydrones.co.uk/enquiry', {
  method: 'POST',
  headers: {
    Origin: options.origin ?? origin,
    'CF-Connecting-IP': options.ip ?? '203.0.113.4',
    Accept: options.accept ?? 'application/json',
  },
  body: new URLSearchParams(fields),
});

const makeEnv = () => {
  const attempts = new Map<string, number>();
  const send = vi.fn().mockResolvedValue({ messageId: 'message-id' });
  const limit = vi.fn(async ({ key }: { key: string }) => {
    const count = (attempts.get(key) ?? 0) + 1;
    attempts.set(key, count);
    return { success: count <= 3 };
  });

  return {
    env: {
      ALLOWED_ORIGINS: 'https://whewaydrones.co.uk,https://www.whewaydrones.co.uk',
      TURNSTILE_HOSTNAME: 'whewaydrones.co.uk',
      TURNSTILE_SECRET_KEY: 'turnstile-secret',
      IP_HASH_SECRET: 'ip-hash-secret',
      EMAIL: { send },
      FORM_RATE_LIMITER: { limit },
    } as unknown as Env,
    send,
    limit,
  };
};

const successfulTurnstile = vi.fn(async () => Response.json({
  success: true,
  hostname: 'whewaydrones.co.uk',
  action: 'enquiry',
})) as unknown as typeof fetch;

describe('WhewayAerial enquiry Worker', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('sends a structured email for a valid enquiry', async () => {
    const { env, send } = makeEnv();
    const response = await handleRequest(makeRequest(), env, successfulTurnstile);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      from: 'website@whewaydrones.co.uk',
      to: 'kwame.whe@gmail.com',
      replyTo: 'visitor@example.com',
      subject: 'Mapped site enquiry — Taunton, Somerset',
    }));
  });

  it('redirects a valid native form submission to the thanks page', async () => {
    const { env } = makeEnv();
    const response = await handleRequest(
      makeRequest(validFields, { accept: 'text/html' }),
      env,
      successfulTurnstile,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://whewaydrones.co.uk/thanks/');
  });

  it('silently accepts the honeypot without rate limiting or email', async () => {
    const { env, send, limit } = makeEnv();
    const response = await handleRequest(
      makeRequest({ ...validFields, 'company-website': 'spam.example' }),
      env,
      successfulTurnstile,
    );

    expect(response.status).toBe(200);
    expect(limit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a disallowed origin without a CORS allowance', async () => {
    const { env, send } = makeEnv();
    const response = await handleRequest(
      makeRequest(validFields, { origin: 'https://attacker.example' }),
      env,
      successfulTurnstile,
    );

    expect(response.status).toBe(403);
    expect(response.headers.has('access-control-allow-origin')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects invalid fields and unknown services', async () => {
    const { env, send } = makeEnv();
    const response = await handleRequest(
      makeRequest({ ...validFields, service: 'Anything at all', email: 'not-an-email' }),
      env,
      successfulTurnstile,
    );

    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects missing, invalid and unavailable Turnstile validation', async () => {
    const { env, send } = makeEnv();
    const invalidTurnstile = vi.fn(async () => Response.json({
      success: false,
      hostname: 'whewaydrones.co.uk',
      action: 'enquiry',
    })) as unknown as typeof fetch;
    const unavailableTurnstile = vi.fn(async () => {
      throw new Error('unavailable');
    }) as unknown as typeof fetch;

    const missing = await handleRequest(
      makeRequest({ ...validFields, 'cf-turnstile-response': '' }),
      env,
      successfulTurnstile,
    );
    const invalid = await handleRequest(makeRequest(), env, invalidTurnstile);
    const unavailable = await handleRequest(makeRequest(), env, unavailableTurnstile);

    expect([missing.status, invalid.status, unavailable.status]).toEqual([400, 400, 400]);
    expect(send).not.toHaveBeenCalled();
  });

  it('rate limits the fourth same-IP attempt but not a different IP', async () => {
    const { env, send } = makeEnv();
    const responses = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      responses.push(await handleRequest(makeRequest(), env, successfulTurnstile));
    }
    const otherIp = await handleRequest(
      makeRequest(validFields, { ip: '198.51.100.9' }),
      env,
      successfulTurnstile,
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 429]);
    expect(otherIp.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('rejects bodies over 16 KiB before rate limiting or email', async () => {
    const { env, send, limit } = makeEnv();
    const response = await handleRequest(
      makeRequest({ ...validFields, message: 'x'.repeat(20_000) }),
      env,
      successfulTurnstile,
    );

    expect(response.status).toBe(413);
    expect(limit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns a retry response without clearing data when email delivery fails', async () => {
    const { env, send } = makeEnv();
    send.mockRejectedValueOnce(new Error('delivery failed'));
    const response = await handleRequest(makeRequest(), env, successfulTurnstile);
    const body = await response.json() as { message: string };

    expect(response.status).toBe(502);
    expect(body.message).toContain('form details are still on this page');
  });
});
