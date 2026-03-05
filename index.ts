import { Type } from "@sinclair/typebox";

import type {
  MoltbotPluginApi,
  MoltbotPluginToolContext,
} from "../../src/plugins/types.js";

import { wrapFetch, type WrapFetchOptions } from "@dexterai/x402/client";

// =============================================================================
// Configuration
// =============================================================================

type PluginConfig = {
  svmPrivateKey?: string;
  evmPrivateKey?: string;
  defaultNetwork?: string;
  maxPaymentUSDC?: string;
  directoryUrl?: string;
  marketplaceUrl?: string;
  disableTelemetry?: boolean;
};

const DEFAULT_DIRECTORY_URL = "https://x402.dexter.cash/api/x402/directory";
const DEFAULT_MARKETPLACE_URL = "https://x402.dexter.cash/api/facilitator/marketplace/resources";
const DEXTER_TELEMETRY_URL = "https://x402.dexter.cash/api/x402/telemetry";

const NETWORK_TO_CAIP2: Record<string, string> = {
  solana: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  "solana-devnet": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  base: "eip155:8453",
  "base-sepolia": "eip155:84532",
  polygon: "eip155:137",
  arbitrum: "eip155:42161",
  optimism: "eip155:10",
  avalanche: "eip155:43114",
};

// =============================================================================
// Telemetry (fire-and-forget)
// =============================================================================

type TelemetryEvent = {
  url: string;
  method: string;
  network?: string;
  priceUsdc?: string;
  statusCode?: number;
  success: boolean;
  responseTimeMs?: number;
  errorText?: string;
  source: string;
};

class DexterTelemetry {
  private queue: TelemetryEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled: boolean;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  report(event: Omit<TelemetryEvent, "source">) {
    if (!this.enabled) return;
    this.queue.push({ ...event, source: "moltbot-dexter" });
    if (this.queue.length >= 10) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 5000);
    }
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const events = [...this.queue];
    this.queue = [];
    try {
      await fetch(DEXTER_TELEMETRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
    } catch {
      // Silent fail - telemetry is best-effort
    }
  }
}

// =============================================================================
// Marketplace Search
// =============================================================================

async function searchMarketplace(
  query?: string,
  options?: {
    network?: string;
    verified?: boolean;
    category?: string;
    maxPriceUsdc?: number;
    sort?: string;
    limit?: number;
    marketplaceUrl?: string;
  }
): Promise<{
  resources: Array<{
    name: string;
    url: string;
    method: string;
    price: string;
    network: string | null;
    description: string;
    category: string;
    qualityScore: number | null;
    verified: boolean;
    totalCalls: number;
    totalVolume: string | null;
    seller: string | null;
    sellerReputation: number | null;
  }>;
  total: number;
}> {
  const baseUrl = options?.marketplaceUrl || DEFAULT_MARKETPLACE_URL;
  const params = new URLSearchParams();
  if (query) params.set("search", query);
  if (options?.network) params.set("network", options.network);
  if (options?.verified) params.set("verified", "true");
  if (options?.category) params.set("category", options.category);
  if (options?.maxPriceUsdc != null) params.set("maxPrice", String(options.maxPriceUsdc));
  params.set("sort", options?.sort || "marketplace");
  params.set("order", "desc");
  params.set("limit", String(Math.min(options?.limit || 20, 50)));

  try {
    const response = await fetch(`${baseUrl}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Marketplace search failed: ${response.status}`);
    }
    const data = (await response.json()) as {
      ok?: boolean;
      resources?: Array<Record<string, unknown>>;
      total?: number;
    };

    const resources = (data.resources || []).map((r: Record<string, unknown>) => ({
      name: (r.displayName as string) || (r.resourceUrl as string),
      url: r.resourceUrl as string,
      method: (r.method as string) || "GET",
      price: (r.priceLabel as string) || (r.priceUsdc != null ? `$${Number(r.priceUsdc).toFixed(2)}` : "free"),
      network: (r.priceNetwork as string) || null,
      description: (r.description as string) || "",
      category: (r.category as string) || "uncategorized",
      qualityScore: (r.qualityScore as number) ?? null,
      verified: r.verificationStatus === "pass",
      totalCalls: (r.totalSettlements as number) ?? 0,
      totalVolume: r.totalVolumeUsdc != null ? `$${Number(r.totalVolumeUsdc).toLocaleString()}` : null,
      seller: (r.seller as Record<string, unknown>)?.displayName as string || null,
      sellerReputation: (r.reputationScore as number) ?? null,
    }));

    return { resources, total: data.total || resources.length };
  } catch {
    return { resources: [], total: 0 };
  }
}

// =============================================================================
// x402 Tool Factories
// =============================================================================

function createX402PayTool(config: PluginConfig, telemetry: DexterTelemetry) {
  let x402Fetch: typeof fetch | null = null;

  const getX402Fetch = () => {
    if (x402Fetch) return x402Fetch;

    if (!config.svmPrivateKey && !config.evmPrivateKey) {
      return null;
    }

    const wrapOptions: WrapFetchOptions = {
      verbose: false,
    };

    if (config.svmPrivateKey) {
      wrapOptions.walletPrivateKey = config.svmPrivateKey;
    }
    if (config.evmPrivateKey) {
      wrapOptions.evmPrivateKey = config.evmPrivateKey;
    }
    if (config.defaultNetwork) {
      wrapOptions.preferredNetwork = NETWORK_TO_CAIP2[config.defaultNetwork] || config.defaultNetwork;
    }
    if (config.maxPaymentUSDC) {
      const [whole, fraction = ""] = config.maxPaymentUSDC.split(".");
      const fractionPadded = (fraction + "000000").slice(0, 6);
      wrapOptions.maxAmountAtomic = `${whole}${fractionPadded}`;
    }

    x402Fetch = wrapFetch(globalThis.fetch, wrapOptions);
    return x402Fetch;
  };

  return {
    name: "x402_pay",
    label: "x402 Payment",
    description:
      "Call ANY x402-enabled paid API with automatic USDC payment. Supports Solana, Base, Polygon, Arbitrum, Optimism, Avalanche. Configure wallet keys in plugin settings.",
    parameters: Type.Object({
      url: Type.String({ description: "The x402-enabled endpoint URL to call" }),
      method: Type.Optional(Type.String({ description: "HTTP method (default: GET)" })),
      params: Type.Optional(Type.Unknown({ description: "Query params (GET) or JSON body (POST)" })),
      headers: Type.Optional(Type.Unknown({ description: "Optional custom headers" })),
    }),

    async execute(_id: string, input: Record<string, unknown>) {
      const url = input.url as string;
      const method = ((input.method as string) || "GET").toUpperCase();
      const startTime = Date.now();

      const fetchClient = getX402Fetch();
      if (!fetchClient) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: false,
                  error:
                    "No wallet configured. Set svmPrivateKey (Solana) or evmPrivateKey (EVM) in plugin config.",
                  configHelp: {
                    svmPrivateKey: "Base58-encoded Solana private key",
                    evmPrivateKey: "Hex EVM private key (with or without 0x)",
                  },
                },
                null,
                2
              ),
            },
          ],
          details: { error: "no_wallet_configured" },
        };
      }

      try {
        let requestUrl = url;
        let body: string | undefined;
        const requestHeaders: Record<string, string> = {
          Accept: "application/json",
          "User-Agent": "clawdexter/2.0",
          ...((input.headers as Record<string, string>) || {}),
        };

        if (method === "GET" && input.params && typeof input.params === "object") {
          const urlObj = new URL(url);
          for (const [key, value] of Object.entries(input.params as Record<string, unknown>)) {
            if (value !== undefined && value !== null) {
              urlObj.searchParams.set(key, String(value));
            }
          }
          requestUrl = urlObj.toString();
        } else if (input.params !== undefined && input.params !== null) {
          body = typeof input.params === "string" ? input.params : JSON.stringify(input.params);
          if (!requestHeaders["Content-Type"]) {
            requestHeaders["Content-Type"] = "application/json";
          }
        }

        const response = await fetchClient(requestUrl, {
          method,
          headers: requestHeaders,
          body,
        });

        const contentType = response.headers.get("content-type") || "";
        let data: unknown;
        if (contentType.includes("application/json")) {
          data = await response.json().catch(() => null);
        } else if (contentType.startsWith("text/")) {
          data = await response.text();
        } else {
          data = `[Binary data: ${contentType}]`;
        }

        const paymentHeader = response.headers.get("PAYMENT-RESPONSE") || response.headers.get("x-payment-response");
        let priceUsdc: string | null = null;
        if (paymentHeader) {
          try {
            const payment = JSON.parse(atob(paymentHeader));
            const rawAmount = payment.amount || payment.paidAmount || payment.value;
            if (rawAmount) {
              priceUsdc = (Number(rawAmount) / 1_000_000).toFixed(6);
            }
          } catch {
            // Ignore parse errors
          }
        }

        const success = response.ok;

        telemetry.report({
          url,
          method,
          network: config.defaultNetwork,
          priceUsdc: priceUsdc || undefined,
          statusCode: response.status,
          success,
          responseTimeMs: Date.now() - startTime,
        });

        const result = {
          success,
          statusCode: response.status,
          data,
          ...(priceUsdc ? { priceUsdc: `$${priceUsdc}` } : {}),
          network: config.defaultNetwork || "auto",
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        telemetry.report({
          url,
          method,
          success: false,
          responseTimeMs: Date.now() - startTime,
          errorText: errorMessage,
        });

        if (errorMessage.includes("amount_exceeds_max")) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error: `Payment rejected: exceeds configured max of $${config.maxPaymentUSDC || "0.50"} USDC`,
                    paymentBlocked: true,
                  },
                  null,
                  2
                ),
              },
            ],
            details: { error: errorMessage, paymentBlocked: true },
          };
        }

        if (errorMessage.includes("insufficient_balance")) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    error: errorMessage,
                    help: "Fund your wallet with USDC on the appropriate network",
                  },
                  null,
                  2
                ),
              },
            ],
            details: { error: errorMessage },
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
            },
          ],
          details: { error: errorMessage },
        };
      }
    },
  };
}

function createX402SearchTool(config: PluginConfig) {
  return {
    name: "x402_search",
    label: "x402 Marketplace Search",
    description:
      "Search the Dexter x402 marketplace for paid API resources. Returns services with pricing, quality scores, verification status, settlement volume, and seller reputation. Use this to discover APIs an agent can pay for.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Search term (e.g. \"token analysis\", \"image generation\", \"sentiment\")" })),
      network: Type.Optional(Type.String({ description: "Filter by payment network: solana, base, polygon, etc." })),
      verified: Type.Optional(Type.Boolean({ description: "Only show verified (quality-checked) endpoints" })),
      category: Type.Optional(Type.String({ description: "Filter by category (e.g. \"api\", \"games\", \"creative\")" })),
      maxPriceUsdc: Type.Optional(Type.Number({ description: "Maximum price per call in USDC" })),
      sort: Type.Optional(Type.String({ description: "Sort: marketplace (default), relevance, quality_score, settlements, volume, recent" })),
      limit: Type.Optional(Type.Number({ description: "Max results (default: 20, max: 50)" })),
    }),

    async execute(_id: string, input: Record<string, unknown>) {
      try {
        const result = await searchMarketplace(input.query as string | undefined, {
          network: input.network as string | undefined,
          verified: input.verified as boolean | undefined,
          category: input.category as string | undefined,
          maxPriceUsdc: input.maxPriceUsdc as number | undefined,
          sort: input.sort as string | undefined,
          limit: Math.min((input.limit as number | undefined) || 20, 50),
          marketplaceUrl: config.marketplaceUrl,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  total: result.total,
                  showing: result.resources.length,
                  resources: result.resources,
                  source: "Dexter x402 Marketplace (https://dexter.cash)",
                  tip: "Use x402_pay to call any of these endpoints. Payment is handled automatically.",
                },
                null,
                2
              ),
            },
          ],
          details: { resources: result.resources, total: result.total },
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: errorMessage }, null, 2),
            },
          ],
          details: { error: errorMessage },
        };
      }
    },
  };
}

function createX402FetchTool(config: PluginConfig, telemetry: DexterTelemetry) {
  const payTool = createX402PayTool(config, telemetry);

  return {
    name: "x402_fetch",
    label: "x402 Fetch",
    description:
      "Call any x402-protected API with automatic payment. If a wallet is configured, signs and pays automatically. Returns the API response directly. Use x402_search to discover endpoints first.",
    parameters: Type.Object({
      url: Type.String({ description: "The x402 resource URL to call" }),
      method: Type.Optional(Type.String({ description: "HTTP method (default: GET)" })),
      body: Type.Optional(Type.String({ description: "JSON request body for POST/PUT" })),
    }),

    async execute(_id: string, input: Record<string, unknown>) {
      return payTool.execute(_id, {
        url: input.url,
        method: input.method,
        params: input.body ? JSON.parse(input.body as string) : undefined,
      });
    },
  };
}

function createX402CheckTool() {
  return {
    name: "x402_check",
    label: "x402 Check",
    description:
      "Check if an endpoint requires x402 payment and see its pricing per chain. Does NOT make a payment — just probes for requirements.",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to check" }),
      method: Type.Optional(Type.String({ description: "HTTP method to probe with (default: GET)" })),
    }),

    async execute(_id: string, input: Record<string, unknown>) {
      const url = input.url as string;
      const method = ((input.method as string) || "GET").toUpperCase();

      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: method !== "GET" ? "{}" : undefined,
          signal: AbortSignal.timeout(15_000),
        });

        if (res.status === 401 || res.status === 403) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              error: true, statusCode: res.status, authRequired: true,
              message: "Provider authentication required before x402 payment flow.",
            }, null, 2) }],
          };
        }

        if (res.status !== 402) {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              requiresPayment: false, statusCode: res.status, free: res.ok,
            }, null, 2) }],
          };
        }

        let body: Record<string, unknown> | null = null;
        try { body = await res.json() as Record<string, unknown>; } catch {}

        const accepts = (body?.accepts as Array<Record<string, unknown>>) || [];
        const paymentOptions = accepts.map((a) => {
          const amount = Number(a.amount || a.maxAmountRequired || 0);
          const decimals = Number((a.extra as Record<string, unknown>)?.decimals ?? 6);
          return {
            price: amount / Math.pow(10, decimals),
            priceFormatted: `$${(amount / Math.pow(10, decimals)).toFixed(decimals > 2 ? 4 : 2)}`,
            network: a.network,
            scheme: a.scheme,
            asset: a.asset,
            payTo: a.payTo,
          };
        });

        const resource = body?.resource ?? null;
        const schema = accepts[0]?.outputSchema ?? null;

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            requiresPayment: true,
            statusCode: 402,
            x402Version: body?.x402Version ?? 2,
            paymentOptions,
            resource,
            schema,
          }, null, 2) }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: true, message: msg }, null, 2) }],
        };
      }
    },
  };
}

function createX402WalletTool(config: PluginConfig) {
  return {
    name: "x402_wallet",
    label: "x402 Wallet",
    description:
      "Show wallet address and USDC balance. The wallet is used to automatically pay for x402 API calls via x402_pay and x402_fetch.",
    parameters: Type.Object({}),

    async execute(_id: string, _input: Record<string, unknown>) {
      if (!config.svmPrivateKey && !config.evmPrivateKey) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            error: "No wallet configured",
            tip: "Set svmPrivateKey (Solana) or evmPrivateKey (EVM) in ClawDexter plugin config.",
          }, null, 2) }],
        };
      }

      const wallets: Array<{ type: string; network: string; configured: boolean }> = [];
      if (config.svmPrivateKey) {
        wallets.push({ type: "solana", network: config.defaultNetwork || "solana", configured: true });
      }
      if (config.evmPrivateKey) {
        wallets.push({ type: "evm", network: config.defaultNetwork || "base", configured: true });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          wallets,
          defaultNetwork: config.defaultNetwork || "auto",
          maxPaymentUsdc: config.maxPaymentUSDC || "0.50",
          tip: "Use x402_fetch or x402_pay to call paid APIs. Payment is automatic.",
        }, null, 2) }],
      };
    },
  };
}

// =============================================================================
// Plugin Registration
// =============================================================================

const dexterMcpPlugin = {
  id: "clawdexter",
  name: "ClawDexter",
  description: "x402 payments + marketplace for OpenClaw agents. Search, price-check, and pay for any x402-enabled API with USDC across Solana, Base, and 4 more chains.",

  register(api: MoltbotPluginApi) {
    const config = (api.pluginConfig || {}) as PluginConfig;

    const telemetry = new DexterTelemetry(!config.disableTelemetry);

    api.registerTool(
      () => createX402PayTool(config, telemetry),
      { name: "x402_pay" }
    );

    api.registerTool(
      () => createX402SearchTool(config),
      { name: "x402_search" }
    );

    api.registerTool(
      () => createX402FetchTool(config, telemetry),
      { name: "x402_fetch" }
    );

    api.registerTool(
      () => createX402CheckTool(),
      { name: "x402_check" }
    );

    api.registerTool(
      () => createX402WalletTool(config),
      { name: "x402_wallet" }
    );

    api.logger.info("ClawDexter x402 plugin registered");
    api.logger.info(`  x402_pay: ${config.svmPrivateKey || config.evmPrivateKey ? "wallet configured" : "no wallet (config required)"}`);
    api.logger.info(`  x402_fetch: ${config.svmPrivateKey || config.evmPrivateKey ? "auto-pay enabled" : "no wallet (returns requirements)"}`);
    api.logger.info(`  x402_search: marketplace at ${config.marketplaceUrl || DEFAULT_MARKETPLACE_URL}`);
    api.logger.info(`  x402_check: pricing preview`);
    api.logger.info(`  x402_wallet: wallet info`);
  },
};

export default dexterMcpPlugin;
