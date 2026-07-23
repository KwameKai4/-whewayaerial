/// <reference path="../worker-configuration.d.ts" />

const MAX_BODY_BYTES = 16_384;
const FORM_ORIGIN = 'https://whewaydrones.co.uk';
const THANKS_URL = `${FORM_ORIGIN}/thanks/`;
const FALLBACK_EMAIL = 'job@whewaydrones.co.uk';
const SENDER_EMAIL = 'website@whewaydrones.co.uk';
const DESTINATION_EMAIL = 'kwame.whe@gmail.com';
const ALLOWED_SERVICES = new Set([
  'Building capture',
  'Visual 3D twin',
  'Mapped site',
  'Progress monitoring',
  'Not sure yet',
]);

type Enquiry = {
  name: string;
  email: string;
  location: string;
  phone: string;
  service: string;
  message: string;
};

type TurnstileResult = {
  success: boolean;
  hostname?: string;
  action?: string;
};

type Outcome =
  | 'accepted'
  | 'honeypot'
  | 'invalid_origin'
  | 'invalid_method'
  | 'invalid_content_type'
  | 'payload_too_large'
  | 'invalid_fields'
  | 'rate_limited'
  | 'turnstile_failed'
  | 'delivery_failed'
  | 'not_found';

type Fetcher = typeof fetch;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const logOutcome = (requestId: string, outcome: Outcome, status: number) => {
  console.log(JSON.stringify({ requestId, outcome, status }));
};

const corsHeaders = (origin: string): Record<string, string> => origin
  ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    }
  : { 'Vary': 'Origin' };

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[character] ?? character));

const sanitiseSubject = (value: string) => value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();

const wantsJson = (request: Request) => request.headers.get('accept')?.includes('application/json') ?? false;

const errorPage = (message: string) => `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Enquiry not sent | WhewayDrones</title>
    <style>
      :root{color-scheme:dark}body{margin:0;background:#080c0e;color:#f0f2ee;font:16px/1.6 system-ui,sans-serif}
      main{max-width:42rem;margin:12vh auto;padding:2rem}p{color:#bdc3be}a{color:#dfff00}
    </style>
  </head>
  <body><main><h1>Your enquiry was not sent.</h1><p>${escapeHtml(message)}</p><p><a href="${FORM_ORIGIN}/#contact">Return to the form</a> or <a href="mailto:${FALLBACK_EMAIL}">email ${FALLBACK_EMAIL}</a>.</p></main></body>
</html>`;

const respond = (
  request: Request,
  origin: string,
  status: number,
  message: string,
  requestId: string,
  outcome: Outcome,
) => {
  logOutcome(requestId, outcome, status);
  if (wantsJson(request)) {
    return Response.json(
      { ok: status >= 200 && status < 300, message, requestId },
      { status, headers: { ...corsHeaders(origin), ...securityHeaders } },
    );
  }

  if (status >= 200 && status < 300) {
    return Response.redirect(THANKS_URL, 303);
  }

  return new Response(errorPage(message), {
    status,
    headers: {
      ...securityHeaders,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
};

const readLimitedBody = async (request: Request) => {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new RangeError('payload_too_large');
  }

  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError('payload_too_large');
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const parseForm = async (request: Request) => {
  const body = await readLimitedBody(request);
  const formResponse = new Response(body, {
    headers: { 'Content-Type': request.headers.get('content-type') ?? '' },
  });
  return formResponse.formData();
};

const getField = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const validateEnquiry = (form: FormData): Enquiry | null => {
  const enquiry = {
    name: getField(form, 'name'),
    email: getField(form, 'email').toLowerCase(),
    location: getField(form, 'location'),
    phone: getField(form, 'phone'),
    service: getField(form, 'service'),
    message: getField(form, 'message'),
  };

  if (
    enquiry.name.length < 2 || enquiry.name.length > 100
    || enquiry.email.length > 254 || !emailPattern.test(enquiry.email)
    || enquiry.location.length < 2 || enquiry.location.length > 200
    || enquiry.phone.length > 50
    || !ALLOWED_SERVICES.has(enquiry.service)
    || enquiry.message.length < 10 || enquiry.message.length > 4_000
  ) return null;

  return enquiry;
};

const hmacIp = async (ip: string, secret: string) => {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
};

const validateTurnstile = async (
  token: string,
  ip: string,
  env: Env,
  fetcher: Fetcher,
) => {
  if (!token) return false;
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
    remoteip: ip,
  });
  const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) return false;
  const result = await response.json<TurnstileResult>();
  return result.success
    && result.hostname === env.TURNSTILE_HOSTNAME
    && result.action === 'enquiry';
};

const enquiryText = (enquiry: Enquiry, requestId: string) => [
  'New WhewayDrones website enquiry',
  '',
  `Request ID: ${requestId}`,
  `Name: ${enquiry.name}`,
  `Email: ${enquiry.email}`,
  `Phone: ${enquiry.phone || 'Not provided'}`,
  `Project location: ${enquiry.location}`,
  `Service: ${enquiry.service}`,
  '',
  'Project details:',
  enquiry.message,
].join('\n');

const enquiryHtml = (enquiry: Enquiry, requestId: string) => {
  const row = (label: string, value: string) => `<tr><th align="left" style="padding:6px 14px 6px 0">${escapeHtml(label)}</th><td style="padding:6px 0">${escapeHtml(value)}</td></tr>`;
  return `<h1>New WhewayDrones website enquiry</h1>
<table>
${row('Request ID', requestId)}
${row('Name', enquiry.name)}
${row('Email', enquiry.email)}
${row('Phone', enquiry.phone || 'Not provided')}
${row('Project location', enquiry.location)}
${row('Service', enquiry.service)}
</table>
<h2>Project details</h2>
<p style="white-space:pre-wrap">${escapeHtml(enquiry.message)}</p>`;
};

export const handleRequest = async (
  request: Request,
  env: Env,
  fetcher: Fetcher = fetch,
): Promise<Response> => {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);
  const origin = request.headers.get('origin') ?? '';
  const allowedOrigins = new Set(env.ALLOWED_ORIGINS.split(',').map((item) => item.trim()));

  if (url.pathname !== '/enquiry') {
    return respond(request, '', 404, 'That form endpoint does not exist.', requestId, 'not_found');
  }

  if (!allowedOrigins.has(origin)) {
    return respond(request, '', 403, 'This submission origin is not allowed.', requestId, 'invalid_origin');
  }

  if (request.method === 'OPTIONS') {
    logOutcome(requestId, 'accepted', 204);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return respond(request, origin, 405, 'Only form submissions are accepted.', requestId, 'invalid_method');
  }

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (
    !contentType.startsWith('application/x-www-form-urlencoded')
    && !contentType.startsWith('multipart/form-data')
  ) {
    return respond(request, origin, 415, 'The form used an unsupported format.', requestId, 'invalid_content_type');
  }

  let form: FormData;
  try {
    form = await parseForm(request);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : 400;
    const outcome = error instanceof RangeError ? 'payload_too_large' : 'invalid_fields';
    return respond(request, origin, status, 'The form payload could not be read.', requestId, outcome);
  }

  if (getField(form, 'company-website')) {
    return respond(request, origin, 200, 'Thanks. Your enquiry has been received.', requestId, 'honeypot');
  }

  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return respond(request, origin, 400, 'The request could not be verified. Please try again.', requestId, 'invalid_fields');
  }
  const limiterKey = await hmacIp(ip, env.IP_HASH_SECRET);
  const rateLimit = await env.FORM_RATE_LIMITER.limit({ key: limiterKey });
  if (!rateLimit.success) {
    return respond(request, origin, 429, 'Too many attempts. Wait a minute, then try again.', requestId, 'rate_limited');
  }

  const enquiry = validateEnquiry(form);
  if (!enquiry) {
    return respond(request, origin, 400, 'Please check every field and try again.', requestId, 'invalid_fields');
  }

  const turnstileToken = getField(form, 'cf-turnstile-response');
  let turnstileValid = false;
  try {
    turnstileValid = await validateTurnstile(turnstileToken, ip, env, fetcher);
  } catch {
    turnstileValid = false;
  }
  if (!turnstileValid) {
    return respond(request, origin, 400, 'The spam check expired or failed. Please try again.', requestId, 'turnstile_failed');
  }

  const subjectService = sanitiseSubject(enquiry.service).slice(0, 60);
  const subjectLocation = sanitiseSubject(enquiry.location).slice(0, 90);
  try {
    await env.EMAIL.send({
      from: SENDER_EMAIL,
      to: DESTINATION_EMAIL,
      subject: `${subjectService} enquiry — ${subjectLocation}`,
      text: enquiryText(enquiry, requestId),
      html: enquiryHtml(enquiry, requestId),
      replyTo: enquiry.email,
      headers: {
        'X-WhewayDrones-Request-ID': requestId,
      },
    });
  } catch {
    return respond(request, origin, 502, 'Delivery is temporarily unavailable. Your form details are still on this page; please retry or use the email link.', requestId, 'delivery_failed');
  }

  return respond(request, origin, 200, 'Thanks. Your enquiry has been received.', requestId, 'accepted');
};

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
