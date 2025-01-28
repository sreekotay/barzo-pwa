export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      
      // CORS headers
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // Route handling
      if (url.pathname === '/api/vapidPublicKey' && request.method === 'GET') {
        return new Response(
          JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }), 
          { headers: { 'Content-Type': 'application/json', ...corsHeaders } }
        );
      }

      if (url.pathname === '/api/subscribe' && request.method === 'POST') {
        const subscription = await request.json();
        if (!subscription || !subscription.endpoint) {
          return new Response(JSON.stringify({ error: 'Invalid subscription' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Store subscription in KV with metadata
        await env.SUBSCRIPTIONS.put(
          subscription.endpoint,
          JSON.stringify({
            subscription,
            createdAt: new Date().toISOString(),
            lastUsed: new Date().toISOString()
          })
        );

        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      if (url.pathname === '/api/notify' && request.method === 'POST') {
        const { message } = await request.json();
        
        // List all subscriptions
        const subscriptionList = await env.SUBSCRIPTIONS.list();
        const results = [];
        const now = new Date().getTime();

        for (const key of subscriptionList.keys) {
          const data = await env.SUBSCRIPTIONS.get(key.name, 'json');
          if (!data) continue;

          // Check if subscription is too old
          const createdAt = new Date(data.createdAt).getTime();
          if (now - createdAt > MAX_SUBSCRIPTION_AGE) {
            await env.SUBSCRIPTIONS.delete(key.name);
            results.push({ 
              success: false, 
              endpoint: key.name, 
              error: 'Subscription expired' 
            });
            continue;
          }

          try {
            // Create VAPID JWT token
            const token = await createVAPIDToken(
              data.subscription.endpoint,
              env.VAPID_PUBLIC_KEY,
              env.VAPID_PRIVATE_KEY
            );

            const response = await fetch(data.subscription.endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `vapid ${token}`,
                'TTL': '86400'
              },
              body: JSON.stringify({
                title: 'Barzo',
                body: message || 'You have a new message!',
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                data: {
                  url: '/?source=push'
                }
              })
            });

            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }

            // Update last used timestamp
            await env.SUBSCRIPTIONS.put(
              key.name,
              JSON.stringify({
                ...data,
                lastUsed: new Date().toISOString()
              })
            );

            results.push({ success: true, endpoint: key.name });
          } catch (error) {
            results.push({ success: false, endpoint: key.name, error: error.message });
            // Remove failed subscription
            await env.SUBSCRIPTIONS.delete(key.name);
          }
        }

        return new Response(JSON.stringify({ 
          results,
          activeSubscriptions: results.filter(r => r.success).length 
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      return new Response('Not found', { status: 404, headers: corsHeaders });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};

// VAPID JWT helper functions
async function createVAPIDToken(audience, publicKey, privateKey) {
  const header = {
    typ: 'JWT',
    alg: 'ES256'
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: new URL(audience).origin,
    exp: now + 12 * 3600, // 12 hours
    sub: 'mailto:admin@barzo.app'
  };

  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  
  // Convert VAPID keys from base64 to Uint8Array
  const privateKeyArray = urlBase64ToUint8Array(privateKey);
  const keyPair = await crypto.subtle.importKey(
    'raw',
    privateKeyArray,
    {
      name: 'ECDSA',
      namedCurve: 'P-256'
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    keyPair,
    new TextEncoder().encode(unsignedToken)
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${unsignedToken}.${encodedSignature}`;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Add at the top with other constants
const MAX_SUBSCRIPTION_AGE = 180 * 24 * 60 * 60 * 1000; // 180 days in milliseconds 