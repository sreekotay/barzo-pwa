var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-5AUzdH/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// worker/index.js
var worker_default = {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      const corsHeaders2 = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      };
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            ...corsHeaders2,
            "Access-Control-Max-Age": "86400"
          }
        });
      }
      const isPWA = url.searchParams.has("pwa");
      const authToken = url.searchParams.get("authToken");
      if (isPWA && !authToken) {
        const currentUrl = encodeURIComponent(request.url);
        return Response.redirect(`https://barzo.work?redirect=${currentUrl}`);
      }
      if (authToken) {
        try {
          console.log("Auth token received:", {
            length: authToken.length,
            sample: authToken.substring(0, 20) + "..."
          });
          const userInfo = JSON.parse(decodeURIComponent(authToken));
          console.log("Parsed user info:", userInfo);
          const subscriptionKey = `subscription:${userInfo?.token?.identity.userId}`;
          let subscription = await env.SUBSCRIPTIONS.get(subscriptionKey);
          if (!subscription) {
            const newSubscription = {
              userId: userInfo.id,
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              lastUsed: (/* @__PURE__ */ new Date()).toISOString()
            };
            await env.SUBSCRIPTIONS.put(subscriptionKey, JSON.stringify(newSubscription));
            subscription = JSON.stringify(newSubscription);
          }
        } catch (error) {
          console.error("Auth token parsing error:", {
            error: error.message,
            errorType: error.name,
            tokenLength: authToken?.length
          });
        }
      }
      if (url.pathname === "/api/vapidPublicKey" && request.method === "GET") {
        try {
          if (!env.VAPID_PUBLIC_KEY) {
            throw new Error("VAPID_PUBLIC_KEY not configured");
          }
          return new Response(
            JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }),
            {
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders2
              }
            }
          );
        } catch (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json",
                ...corsHeaders2
              }
            }
          );
        }
      }
      if (url.pathname === "/api/subscribe" && request.method === "POST") {
        const subscription = await request.json();
        if (!subscription || !subscription.endpoint) {
          return new Response(JSON.stringify({ error: "Invalid subscription" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders2 }
          });
        }
        const authToken2 = request.headers.get("Authorization")?.split("Bearer ")?.[1];
        let subscriptionKey = subscription.endpoint;
        let userId = "anonymous";
        if (authToken2) {
          try {
            console.log("Auth token:", authToken2);
            const userInfo = JSON.parse(decodeURIComponent(authToken2));
            userId = userInfo?.token?.identity.userId;
            subscriptionKey = `subscription:${userId}`;
          } catch (error) {
            console.error("Invalid auth token:", error);
          }
        }
        await env.SUBSCRIPTIONS.put(
          subscriptionKey,
          JSON.stringify({
            subscription,
            userId,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            lastUsed: (/* @__PURE__ */ new Date()).toISOString()
          })
        );
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders2 }
        });
      }
      if (url.pathname === "/api/notify" && request.method === "POST") {
        const { message, key } = await request.json();
        if (key) {
          const data = await env.SUBSCRIPTIONS.get(key, "json");
          if (!data) {
            return new Response(JSON.stringify({
              error: "Subscription not found"
            }), {
              status: 404,
              headers: { "Content-Type": "application/json", ...corsHeaders2 }
            });
          }
          console.log("Data from KV:", data);
          console.log("Subscription:", data.subscription);
          console.log("Endpoint:", data.subscription.endpoint);
          try {
            const token = await createVAPIDToken(
              data.subscription.endpoint,
              env.VAPID_PUBLIC_KEY,
              env.VAPID_PRIVATE_KEY
            );
            const response = await fetch(data.subscription.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `vapid ${token}`,
                "TTL": "86400"
              },
              body: JSON.stringify({
                title: "Barzo",
                body: message || "Test notification!",
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                data: {
                  url: "/?source=push"
                }
              })
            });
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            await env.SUBSCRIPTIONS.put(key, JSON.stringify({
              ...data,
              lastUsed: (/* @__PURE__ */ new Date()).toISOString()
            }));
            return new Response(JSON.stringify({
              success: true,
              message: "Notification sent"
            }), {
              headers: { "Content-Type": "application/json", ...corsHeaders2 }
            });
          } catch (error) {
            return new Response(JSON.stringify({
              error: error.message
            }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...corsHeaders2 }
            });
          }
        }
        const subscriptionList = await env.SUBSCRIPTIONS.list();
        const results = [];
        const now = (/* @__PURE__ */ new Date()).getTime();
        for (const key2 of subscriptionList.keys) {
          const data = await env.SUBSCRIPTIONS.get(key2.name, "json");
          if (!data)
            continue;
          const createdAt = new Date(data.createdAt).getTime();
          if (now - createdAt > MAX_SUBSCRIPTION_AGE) {
            await env.SUBSCRIPTIONS.delete(key2.name);
            results.push({
              success: false,
              endpoint: key2.name,
              error: "Subscription expired"
            });
            continue;
          }
          try {
            const token = await createVAPIDToken(
              data.subscription.endpoint,
              env.VAPID_PUBLIC_KEY,
              env.VAPID_PRIVATE_KEY
            );
            const response = await fetch(data.subscription.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `vapid ${token}`,
                "TTL": "86400"
              },
              body: JSON.stringify({
                title: "Barzo",
                body: message || "You have a new message!",
                icon: "/icon-192.png",
                badge: "/icon-192.png",
                data: {
                  url: "/?source=push"
                }
              })
            });
            if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
            }
            await env.SUBSCRIPTIONS.put(
              key2.name,
              JSON.stringify({
                ...data,
                lastUsed: (/* @__PURE__ */ new Date()).toISOString()
              })
            );
            results.push({ success: true, endpoint: key2.name });
          } catch (error) {
            results.push({ success: false, endpoint: key2.name, error: error.message });
            await env.SUBSCRIPTIONS.delete(key2.name);
          }
        }
        return new Response(JSON.stringify({
          results,
          activeSubscriptions: results.filter((r) => r.success).length
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders2 }
        });
      }
      return new Response("Not found", { status: 404, headers: corsHeaders2 });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
  }
};
async function createVAPIDToken(audience, publicKey, privateKey) {
  console.log("1. Starting VAPID token creation with inputs:", {
    audience,
    publicKeyLength: publicKey?.length,
    privateKeyLength: privateKey?.length,
    publicKeyStart: publicKey?.substring(0, 10),
    privateKeyStart: privateKey?.substring(0, 10)
  });
  const header = {
    typ: "JWT",
    alg: "ES256"
  };
  console.log("2. Created JWT header:", header);
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    aud: new URL(audience).origin,
    exp: now + 12 * 3600,
    sub: "mailto:admin@barzo.app"
  };
  console.log("3. Created JWT payload:", payload);
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  console.log("4. Created unsigned token:", {
    encodedHeader,
    encodedPayload,
    unsignedToken
  });
  try {
    console.log("5. Starting key conversion process");
    const keyData = urlBase64ToUint8Array(privateKey);
    console.log("6. Converted private key to Uint8Array:", {
      originalLength: privateKey.length,
      processedLength: keyData.length,
      firstBytes: Array.from(keyData.slice(0, 5)),
      isTypical: keyData.length === 32
    });
    const jwk = {
      kty: "EC",
      crv: "P-256",
      d: btoa(String.fromCharCode.apply(null, keyData)),
      ext: true
    };
    console.log("7. Created JWK:", {
      kty: jwk.kty,
      crv: jwk.crv,
      hasD: !!jwk.d,
      dLength: jwk.d?.length
    });
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      {
        name: "ECDSA",
        namedCurve: "P-256",
        hash: { name: "SHA-256" }
      },
      true,
      // Make extractable to verify the key
      ["sign"]
    );
    console.log("8. Private key imported successfully");
    console.log("9. Preparing to sign token");
    const encoder = new TextEncoder();
    const signatureInput = encoder.encode(unsignedToken);
    console.log("10. Token encoded for signing:", {
      inputLength: signatureInput.length,
      firstBytes: Array.from(signatureInput.slice(0, 5))
    });
    console.log("11. Signing token");
    const signature = await crypto.subtle.sign(
      {
        name: "ECDSA",
        hash: { name: "SHA-256" }
      },
      key,
      signatureInput
    );
    console.log("12. Token signed successfully");
    const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
    console.log("13. Signature encoded:", {
      signatureLength: encodedSignature.length,
      signatureStart: encodedSignature.substring(0, 10)
    });
    const finalToken = `${unsignedToken}.${encodedSignature}`;
    console.log("14. Final token created:", {
      length: finalToken.length,
      start: finalToken.substring(0, 20)
    });
    return finalToken;
  } catch (error) {
    console.error("VAPID token creation failed:", {
      step: error.step || "unknown",
      error: error.message,
      name: error.name,
      stack: error.stack,
      privateKeyFormat: {
        length: privateKey?.length,
        isBase64: /^[A-Za-z0-9+/=]+$/.test(privateKey),
        containsUrlSafeChars: /^[A-Za-z0-9\-_]+$/.test(privateKey),
        sample: privateKey?.substring(0, 10)
      },
      keyData: Array.from(urlBase64ToUint8Array(privateKey).slice(0, 5))
    });
    throw error;
  }
}
__name(createVAPIDToken, "createVAPIDToken");
function urlBase64ToUint8Array(base64String) {
  console.log("a. Starting base64 conversion:", {
    input: base64String.substring(0, 10) + "...",
    length: base64String.length
  });
  const base64 = base64String.replace(/-/g, "+").replace(/_/g, "/");
  console.log("b. Converted to standard base64:", {
    converted: base64.substring(0, 10) + "..."
  });
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const padded = base64 + padding;
  console.log("c. Added padding:", {
    paddingLength: padding.length,
    finalLength: padded.length,
    final: padded.substring(0, 10) + "..."
  });
  const rawData = atob(padded);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  console.log("d. Converted to Uint8Array:", {
    length: outputArray.length,
    firstBytes: Array.from(outputArray.slice(0, 5))
  });
  return outputArray;
}
__name(urlBase64ToUint8Array, "urlBase64ToUint8Array");
var MAX_SUBSCRIPTION_AGE = 180 * 24 * 60 * 60 * 1e3;

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-5AUzdH/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-5AUzdH/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
