// .wrangler/tmp/bundle-z9sz3A/checked-fetch.js
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
        "Access-Control-Allow-Headers": "Content-Type"
      };
      if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders2 });
      }
      if (url.pathname === "/api/vapidPublicKey" && request.method === "GET") {
        return new Response(
          JSON.stringify({ publicKey: env.VAPID_PUBLIC_KEY }),
          { headers: { "Content-Type": "application/json", ...corsHeaders2 } }
        );
      }
      if (url.pathname === "/api/subscribe" && request.method === "POST") {
        const subscription = await request.json();
        if (!subscription || !subscription.endpoint) {
          return new Response(JSON.stringify({ error: "Invalid subscription" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders2 }
          });
        }
        await env.SUBSCRIPTIONS.put(
          subscription.endpoint,
          JSON.stringify({
            subscription,
            createdAt: (/* @__PURE__ */ new Date()).toISOString(),
            lastUsed: (/* @__PURE__ */ new Date()).toISOString()
          })
        );
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Content-Type": "application/json", ...corsHeaders2 }
        });
      }
      if (url.pathname === "/api/notify" && request.method === "POST") {
        const { message } = await request.json();
        const subscriptionList = await env.SUBSCRIPTIONS.list();
        const results = [];
        const now = (/* @__PURE__ */ new Date()).getTime();
        for (const key of subscriptionList.keys) {
          const data = await env.SUBSCRIPTIONS.get(key.name, "json");
          if (!data)
            continue;
          const createdAt = new Date(data.createdAt).getTime();
          if (now - createdAt > MAX_SUBSCRIPTION_AGE) {
            await env.SUBSCRIPTIONS.delete(key.name);
            results.push({
              success: false,
              endpoint: key.name,
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
              key.name,
              JSON.stringify({
                ...data,
                lastUsed: (/* @__PURE__ */ new Date()).toISOString()
              })
            );
            results.push({ success: true, endpoint: key.name });
          } catch (error) {
            results.push({ success: false, endpoint: key.name, error: error.message });
            await env.SUBSCRIPTIONS.delete(key.name);
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
  const header = {
    typ: "JWT",
    alg: "ES256"
  };
  const now = Math.floor(Date.now() / 1e3);
  const payload = {
    aud: new URL(audience).origin,
    exp: now + 12 * 3600,
    // 12 hours
    sub: "mailto:admin@barzo.app"
  };
  const encodedHeader = btoa(JSON.stringify(header));
  const encodedPayload = btoa(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const privateKeyArray = urlBase64ToUint8Array(privateKey);
  const keyPair = await crypto.subtle.importKey(
    "raw",
    privateKeyArray,
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: { name: "SHA-256" }
    },
    keyPair,
    new TextEncoder().encode(unsignedToken)
  );
  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `${unsignedToken}.${encodedSignature}`;
}
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
var MAX_SUBSCRIPTION_AGE = 180 * 24 * 60 * 60 * 1e3;

// ../../../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = async (request, env, _ctx, middlewareCtx) => {
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
};
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
var jsonError = async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
};
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-z9sz3A/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
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
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}

// .wrangler/tmp/bundle-z9sz3A/middleware-loader.entry.ts
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
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  };
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      };
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
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
