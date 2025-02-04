// Types are removed since Cloudflare Workers use regular JavaScript

const envURL = {
  dev: 'https://api.dev.barzo.com',
  prod: 'https://api.public.barzo.com'
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function createToken(userId, jwtSecret, user_metadata) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iat: now,
    exp: now + 3600,
    iss: 'twxkuwesyfbvcywgnlfe',
    user_metadata
  };

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function createSessionToken(token) {
  // Simple base64 decode for JWT parts
  const [, payloadBase64] = token.split('.');
  const decoded = JSON.parse(atob(payloadBase64));

  const expiresAt = decoded.exp;
  const expiresIn = decoded.exp - decoded.iat;

  const user = {
    id: decoded.sub,
  };

  return {
    access_token: token,
    refresh_token: 'dummy_refresh_token',
    user,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: expiresAt,
  };
}

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    try {
      if (request.method !== 'POST') {
        throw new Error('Method not allowed');
      }

      const { externalToken } = await request.json();

      if (!externalToken || typeof externalToken !== 'object') {
        throw new Error('External token is required');
      }

      if (!('id' in externalToken) || !('bearer' in externalToken)) {
        throw new Error('Invalid token format');
      }

      const environment = (externalToken.env || 'prod');
      if (!envURL[environment]) {
        throw new Error('Invalid environment');
      }

      // Verify the external token with your service
      const verificationResponse = await fetch(`${envURL[environment]}/v1/users/${externalToken.id}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${externalToken.bearer}`
        }
      });

      if (!verificationResponse.ok) {
        const errorText = await verificationResponse.text();
        throw new Error(`External service error (${verificationResponse.status}): ${errorText}`);
      }

      const authResponse = await verificationResponse.json();

      if (!authResponse || typeof authResponse !== 'object') {
        throw new Error('Invalid response from external service');
      }

      if (!authResponse.id || !authResponse.phone) {
        throw new Error('Invalid user data from external service');
      }

      // Generate a unique ID for the user
      const userId = crypto.randomUUID();

      const token = createSessionToken(await createToken(
        userId,
        env.JWT_SECRET_TOKEN_SB,
        { phone: authResponse.phone, email: authResponse.email }
      ));

      return new Response(
        JSON.stringify({
          user: { id: userId },
          access_token: token,
          expires_in: 3600,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
          status: 200,
        }
      );

    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error.message,
        }),
        {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
          status: 400,
        }
      );
    }
  }
}; 