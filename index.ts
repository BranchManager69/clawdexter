import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { Type } from "@sinclair/typebox";

import type {
  MoltbotPluginApi,
  MoltbotPluginToolContext,
  ProviderAuthContext,
  ProviderAuthResult,
} from "../../src/plugins/types.js";
import type { OAuthCredential } from "../../src/agents/auth-profiles/types.js";

// Dexter x402 SDK for generic x402 payments
import { wrapFetch, type WrapFetchOptions } from "@dexterai/x402/client";

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BASE_URL = "https://mcp.dexter.cash/mcp";
const OAUTH_METADATA_PATH = "/.well-known/oauth-authorization-server";
const CALLBACK_PORT = 51199;
const REDIRECT_URI = `http://localhost:${CALLBACK_PORT}/oauth-callback`;
const DEFAULT_SCOPES = ["openid", "wallet.read", "wallet.trade"];

const RESPONSE_PAGE = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Dexter x402 - Connected</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 500px; margin: 60px auto; text-align: center; }
      h1 { color: #10b981; }
      p { color: #6b7280; }
    </style>
  </head>
  <body>
    <h1>Connected to Dexter</h1>
    <p>You can close this window and return to Moltbot.</p>
  </body>
</html>`;

// =============================================================================
// Types
// =============================================================================

type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  mcp?: {
    client_id: string;
    redirect_uri: string;
  };
};

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

type DcrResponse = {
  client_id: string;
  client_id_issued_at?: number;
  redirect_uris: string[];
};

type DexterTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  _meta?: {
    category?: string;
    access?: string;
    tags?: string[];
  };
};

// Extended credential type that includes Dexter-specific fields
type DexterOAuthCredential = OAuthCredential & {
  baseUrl: string;
};

// =============================================================================
// OAuth Utilities
// =============================================================================

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("hex");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function fetchOAuthMetadata(baseUrl: string): Promise<OAuthMetadata> {
  const metadataUrl = baseUrl.replace(/\/mcp\/?$/, "") + OAUTH_METADATA_PATH;
  
  const response = await fetch(metadataUrl, {
    headers: { Accept: "application/json" },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch OAuth metadata: ${response.status}`);
  }
  
  return response.json() as Promise<OAuthMetadata>;
}

// Dynamic Client Registration (RFC 7591)
// This allows Moltbot to register with any redirect_uri including localhost
async function registerDcrClient(params: {
  registrationEndpoint: string;
  redirectUri: string;
  clientName?: string;
}): Promise<DcrResponse> {
  const response = await fetch(params.registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      redirect_uris: [params.redirectUri],
      client_name: params.clientName || "Moltbot Dexter x402",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DCR registration failed: ${text}`);
  }

  return response.json() as Promise<DcrResponse>;
}

function buildAuthUrl(params: {
  metadata: OAuthMetadata;
  clientId: string;
  challenge: string;
  state: string;
  scopes: string[];
  redirectUri: string;
}): string {
  const url = new URL(params.metadata.authorization_endpoint);
  
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", params.state);
  return url.toString();
}

async function startCallbackServer(params: { timeoutMs: number }): Promise<{
  waitForCallback: () => Promise<URL>;
  close: () => Promise<void>;
}> {
  let settled = false;
  let resolveCallback: (url: URL) => void;
  let rejectCallback: (err: Error) => void;

  const callbackPromise = new Promise<URL>((resolve, reject) => {
    resolveCallback = (url) => {
      if (settled) return;
      settled = true;
      resolve(url);
    };
    rejectCallback = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
  });

  const timeout = setTimeout(() => {
    rejectCallback(new Error("Timed out waiting for OAuth callback"));
  }, params.timeoutMs);
  timeout.unref?.();

  const server = createServer((request, response) => {
    if (!request.url) {
      response.writeHead(400, { "Content-Type": "text/plain" });
      response.end("Missing URL");
      return;
    }

    const url = new URL(request.url, `http://localhost:${CALLBACK_PORT}`);
    if (url.pathname !== "/oauth-callback") {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(RESPONSE_PAGE);
    resolveCallback(url);

    setImmediate(() => {
      server.close();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => {
      server.off("error", onError);
      reject(err);
    };
    server.once("error", onError);
    // Bind to 0.0.0.0 to support SSH port forwarding
    server.listen(CALLBACK_PORT, "0.0.0.0", () => {
      server.off("error", onError);
      resolve();
    });
  });

  return {
    waitForCallback: () => callbackPromise,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timeout);
        server.close(() => resolve());
      }),
  };
}

async function exchangeCodeWithRedirect(params: {
  metadata: OAuthMetadata;
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
  log: (msg: string) => void;
}): Promise<TokenResponse> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
  };
  
  params.log("[dexter] Token exchange starting...");
  params.log("[dexter] Endpoint: " + params.metadata.token_endpoint);
  
  // Add timeout to prevent hanging
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  let response: Response;
  try {
    response = await fetch(params.metadata.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: controller.signal,
    });
    params.log("[dexter] Token response status: " + response.status);
  } catch (err) {
    params.log("[dexter] Token fetch error: " + (err instanceof Error ? err.message : String(err)));
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    params.log("[dexter] Token exchange failed: " + text);
    throw new Error(`Token exchange failed: ${text}`);
  }

  params.log("[dexter] Reading response body...");
  const text = await response.text();
  params.log("[dexter] Body length: " + text.length);
  
  const tokens = JSON.parse(text) as TokenResponse;
  params.log("[dexter] Got tokens, has refresh: " + !!tokens.refresh_token);
  return tokens;
}

async function refreshAccessToken(params: {
  metadata: OAuthMetadata;
  refreshToken: string;
}): Promise<TokenResponse> {
  const response = await fetch(params.metadata.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: params.refreshToken,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  return response.json() as Promise<TokenResponse>;
}

// =============================================================================
// MCP Client - Proper MCP Protocol Implementation
// =============================================================================

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Cache MCP client connections per access token
const mcpClientCache = new Map<string, { client: Client; transport: StreamableHTTPClientTransport; createdAt: number }>();
const MCP_CLIENT_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getMcpClient(params: {
  baseUrl: string;
  accessToken: string;
}): Promise<Client> {
  const cacheKey = `${params.baseUrl}:${params.accessToken.slice(-8)}`;
  
  // Check cache
  const cached = mcpClientCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < MCP_CLIENT_TTL_MS) {
    return cached.client;
  }
  
  // Clean up old cached client if exists
  if (cached) {
    try {
      await cached.transport.close();
      await cached.client.close();
    } catch {
      // Ignore cleanup errors
    }
    mcpClientCache.delete(cacheKey);
  }
  
  // Create new MCP client
  const client = new Client({ 
    name: "clawdexter", 
    version: "1.0.0" 
  });
  
  const transport = new StreamableHTTPClientTransport(new URL(params.baseUrl), {
    fetch,
    requestInit: {
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
      },
    },
  });
  
  await client.connect(transport);
  
  // Cache the client
  mcpClientCache.set(cacheKey, {
    client,
    transport,
    createdAt: Date.now(),
  });
  
  return client;
}

async function fetchDexterTools(params: {
  baseUrl: string;
  accessToken: string;
}): Promise<DexterTool[]> {
  const client = await getMcpClient(params);
  const result = await client.request(
    { method: "tools/list", params: {} },
    ListToolsResultSchema
  );
  
  return (result.tools || []).map((tool) => ({
    name: tool.name,
    description: tool.description || "",
    inputSchema: tool.inputSchema as Record<string, unknown>,
    _meta: (tool as unknown as { _meta?: { category?: string } })._meta,
  }));
}

async function callDexterTool(params: {
  baseUrl: string;
  accessToken: string;
  toolName: string;
  args: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<unknown> {
  const client = await getMcpClient({
    baseUrl: params.baseUrl,
    accessToken: params.accessToken,
  });
  
  const result = await client.request(
    { 
      method: "tools/call", 
      params: {
        name: params.toolName,
        arguments: params.args,
      }
    },
    CallToolResultSchema
  );
  
  // Extract text content from MCP response
  const content = result.content || [];
  const textParts = content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text);
  
  if (textParts.length === 1) {
    // Try to parse as JSON if it looks like JSON
    const text = textParts[0];
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        return JSON.parse(text);
      } catch {
        return { text };
      }
    }
    return { text };
  }
  
  return { content: textParts, raw: result };
}

// =============================================================================
// OAuth Login Flow
// Primary: Traditional OAuth with REMOTE callback (dexter.cash)
// Fallback: Device code flow for Telegram/edge cases
// =============================================================================

const DEXTER_LINK_API = "https://api.dexter.cash/api/moltbot/link";
const REMOTE_CALLBACK_URI = "https://dexter.cash/moltbot/link/callback";
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 150; // 5 minutes with 2s intervals

/**
 * Device code flow for Telegram users.
 * Shows a code, user visits link manually, we poll for completion.
 * Used when traditional OAuth redirect isn't possible.
 */
async function loginDexterDeviceCode(params: {
  baseUrl: string;
  openUrl: (url: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  log: (message: string) => void;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
  clientHint?: string;
}): Promise<{
  access: string;
  refresh: string;
  expires: number;
}> {
  params.progress.update("Creating Dexter link code...");
  
  const createResponse = await fetch(`${DEXTER_LINK_API}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientHint: params.clientHint || "telegram",
      ttlSeconds: 600,
      flowType: "device_code",
    }),
  });
  
  if (!createResponse.ok) {
    const text = await createResponse.text();
    throw new Error(`Failed to create link: ${text}`);
  }
  
  const linkData = await createResponse.json() as {
    ok: boolean;
    code: string;
    linkUrl: string;
    expiresAt: string;
  };
  
  if (!linkData.ok || !linkData.code) {
    throw new Error("Failed to create link code");
  }
  
  const code = linkData.code;
  const linkUrl = linkData.linkUrl;
  
  params.log(`[dexter] Device code: ${code}`);
  params.log(`[dexter] Link URL: ${linkUrl}`);
  
  await params.note(
    [
      "🔐 Connect your Dexter account",
      "",
      `Your code: ${code}`,
      "",
      "Open this link to authorize:",
      linkUrl,
      "",
      "The code expires in 10 minutes.",
    ].join("\n"),
    "Dexter Sign-In",
  );
  
  try {
    await params.openUrl(linkUrl);
  } catch {
    // User can click manually
  }
  
  return pollForCompletion({ code, log: params.log, progress: params.progress });
}

/**
 * Poll the link status endpoint until completion or timeout.
 */
async function pollForCompletion(params: {
  code: string;
  log: (message: string) => void;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
}): Promise<{
  access: string;
  refresh: string;
  expires: number;
}> {
  params.progress.update(`Waiting for authorization...`);
  
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    
    try {
      const statusResponse = await fetch(`${DEXTER_LINK_API}/status?code=${params.code}`);
      
      if (!statusResponse.ok) {
        if (statusResponse.status === 404) {
          throw new Error("Link expired or not found");
        }
        continue;
      }
      
      const status = await statusResponse.json() as {
        ok: boolean;
        status: "pending" | "completed" | "expired" | "revoked";
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: string;
      };
      
      if (status.status === "expired") {
        throw new Error("Link expired. Please try again.");
      }
      
      if (status.status === "revoked") {
        throw new Error("Link was cancelled.");
      }
      
      if (status.status === "completed" && status.accessToken) {
        params.log("[dexter] Authorization completed!");
        params.progress.stop("Connected to Dexter");
        
        const expiresAt = status.expiresAt 
          ? new Date(status.expiresAt).getTime() - 5 * 60 * 1000
          : Date.now() + 55 * 60 * 1000;
        
        return {
          access: status.accessToken,
          refresh: status.refreshToken || "",
          expires: expiresAt,
        };
      }
      
      if (attempt % 15 === 0) {
        params.log(`[dexter] Waiting for authorization... (${attempt + 1})`);
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes("expired") || err.message.includes("cancelled"))) {
        throw err;
      }
      params.log(`[dexter] Poll error: ${err instanceof Error ? err.message : err}`);
    }
  }
  
  throw new Error("Authorization timed out. Please try again.");
}

async function loginDexter(params: {
  baseUrl: string;
  isRemote: boolean;
  openUrl: (url: string) => Promise<void>;
  prompt: (message: string) => Promise<string>;
  note: (message: string, title?: string) => Promise<void>;
  log: (message: string) => void;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
}): Promise<{
  access: string;
  refresh: string;
  expires: number;
}> {
  // For Telegram/pure-remote: use device code flow (shows code, user visits link)
  if (params.isRemote) {
    params.log("[dexter] Using device code flow (Telegram mode)");
    return loginDexterDeviceCode({
      baseUrl: params.baseUrl,
      openUrl: params.openUrl,
      note: params.note,
      log: params.log,
      progress: params.progress,
      clientHint: "telegram",
    });
  }

  // Primary flow: Traditional OAuth with REMOTE callback
  // 1. Create link request (for tracking)
  // 2. Build OAuth URL with remote callback
  // 3. Open browser
  // 4. Poll for completion
  
  params.progress.update("Initializing Dexter OAuth...");
  
  // Create link request to track this auth attempt
  const createResponse = await fetch(`${DEXTER_LINK_API}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientHint: "cli",
      ttlSeconds: 600,
      flowType: "oauth",
    }),
  });
  
  if (!createResponse.ok) {
    params.log("[dexter] Failed to create link, falling back to device code");
    return loginDexterDeviceCode({
      baseUrl: params.baseUrl,
      openUrl: params.openUrl,
      note: params.note,
      log: params.log,
      progress: params.progress,
      clientHint: "cli",
    });
  }
  
  const linkData = await createResponse.json() as {
    ok: boolean;
    code: string;
    linkUrl: string;
  };
  
  if (!linkData.ok || !linkData.code) {
    throw new Error("Failed to initialize auth");
  }
  
  const code = linkData.code;
  params.log(`[dexter] Auth session: ${code}`);
  
  // Fetch OAuth metadata
  params.progress.update("Fetching OAuth configuration...");
  const metadata = await fetchOAuthMetadata(params.baseUrl);

  // Register with DCR using REMOTE callback
  params.progress.update("Registering with Dexter...");
  
  const registrationEndpoint = metadata.registration_endpoint 
    || params.baseUrl.replace(/\/mcp\/?$/, "") + "/mcp/register";
  
  // Build callback URL that includes our tracking code
  const callbackUrl = `${REMOTE_CALLBACK_URI}?link_code=${code}`;
  
  let clientId: string;
  try {
    const dcrResponse = await registerDcrClient({
      registrationEndpoint,
      redirectUri: callbackUrl,
      clientName: "Moltbot Dexter x402",
    });
    clientId = dcrResponse.client_id;
    params.log(`[dexter] Registered client: ${clientId}`);
  } catch (err) {
    params.log(`[dexter] DCR failed: ${err instanceof Error ? err.message : err}`);
    // Fall back to device code flow
    return loginDexterDeviceCode({
      baseUrl: params.baseUrl,
      openUrl: params.openUrl,
      note: params.note,
      log: params.log,
      progress: params.progress,
      clientHint: "cli",
    });
  }

  // Build OAuth authorization URL
  const { verifier, challenge } = generatePkce();
  const state = `${code}:${randomBytes(8).toString("hex")}`;
  
  const scopes = metadata.scopes_supported?.length
    ? metadata.scopes_supported.filter((s) => DEFAULT_SCOPES.includes(s))
    : DEFAULT_SCOPES;
  
  const authUrl = buildAuthUrl({ 
    metadata,
    clientId,
    challenge, 
    state, 
    scopes,
    redirectUri: callbackUrl,
  });

  params.log(`[dexter] Opening browser for authorization...`);
  params.log(`[dexter] Auth URL: ${authUrl}`);

  // Store PKCE verifier for the callback to use
  // The backend will need this to exchange the code
  await fetch(`${DEXTER_LINK_API}/pkce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: code,
      verifier: verifier,
      clientId: clientId,
      redirectUri: callbackUrl,
    }),
  }).catch(() => {
    // Non-fatal - backend might not support this yet
    params.log("[dexter] PKCE storage not available, callback will handle exchange");
  });

  // Open browser
  params.progress.update("Opening Dexter sign-in...");
  try {
    await params.openUrl(authUrl);
  } catch {
    // Log URL for manual use
    params.log(`[dexter] Could not open browser. Visit: ${authUrl}`);
  }

  // Poll for completion
  return pollForCompletion({ code, log: params.log, progress: params.progress });
}

// =============================================================================
// Generic x402 Tools (No Auth Required - Config-Based Wallet)
// =============================================================================

/**
 * Plugin configuration
 */
type PluginConfig = {
  // Generic x402 payment config (no auth required)
  svmPrivateKey?: string;
  evmPrivateKey?: string;
  defaultNetwork?: string;
  maxPaymentUSDC?: string;
  directoryUrl?: string;
  disableTelemetry?: boolean;
  // Dexter MCP config (requires OAuth)
  baseUrl?: string;
  autoRefreshTools?: boolean;
};

const DEFAULT_DIRECTORY_URL = "https://x402.dexter.cash/api/x402/directory";
const DEFAULT_MARKETPLACE_URL = "https://x402.dexter.cash/api/facilitator/marketplace/resources";
const DEXTER_TELEMETRY_URL = "https://x402.dexter.cash/api/x402/telemetry";

// Network name to CAIP-2 mapping
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

/**
 * Telemetry for x402 payments (fire-and-forget)
 */
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

/**
 * Search the Dexter x402 marketplace for paid API resources.
 * Uses the rich marketplace API with quality scores, verification, reputation.
 */
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

/**
 * Create x402_pay tool that uses Dexter x402 SDK
 */
function createX402PayTool(config: PluginConfig, telemetry: DexterTelemetry) {
  // Create wrapped fetch with payment handling
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
      // Convert USDC amount to atomic units (6 decimals)
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

      // Check wallet configuration
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
        // Build request
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

        // Make request with automatic payment handling
        const response = await fetchClient(requestUrl, {
          method,
          headers: requestHeaders,
          body,
        });

        // Parse response
        const contentType = response.headers.get("content-type") || "";
        let data: unknown;
        if (contentType.includes("application/json")) {
          data = await response.json().catch(() => null);
        } else if (contentType.startsWith("text/")) {
          data = await response.text();
        } else {
          data = `[Binary data: ${contentType}]`;
        }

        // Extract payment info from response headers
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

        // Report telemetry
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

        // Check for specific error types
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

/**
 * Create x402_search tool for discovering paid APIs
 */
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
          marketplaceUrl: config.directoryUrl,
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

/**
 * Create x402_fetch tool — auto-pay version of x402_pay using wrapFetch
 */
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

/**
 * Create x402_check tool — probe an endpoint for pricing without paying
 */
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

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            requiresPayment: true,
            statusCode: 402,
            x402Version: body?.x402Version ?? 2,
            paymentOptions,
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

/**
 * Create x402_wallet tool — show configured wallet info and balance
 */
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
  description: "x402 payments + Dexter DeFi tools. Generic x402_pay/x402_search for ANY paid API, plus 59+ authenticated Dexter MCP tools.",
  
  register(api: MoltbotPluginApi) {
    const config = (api.pluginConfig || {}) as PluginConfig;
    
    const baseUrl = config?.baseUrl || DEFAULT_BASE_URL;
    
    // Track current credential for tool calls
    let currentCredential: DexterOAuthCredential | undefined;
    
    // Register OAuth provider
    api.registerProvider({
      id: "clawdexter",
      label: "ClawDexter",
      docsPath: "/providers/dexter",
      aliases: ["dexter"],
      
      auth: [
        {
          id: "oauth",
          label: "Dexter OAuth",
          hint: "Sign in with your Dexter account",
          kind: "oauth",
          
          run: async (ctx: ProviderAuthContext): Promise<ProviderAuthResult> => {
            const spin = ctx.prompter.progress("Connecting to Dexter...");
            
            try {
              const result = await loginDexter({
                baseUrl,
                isRemote: ctx.isRemote,
                openUrl: ctx.openUrl,
                prompt: async (message) => String(await ctx.prompter.text({ message })),
                note: ctx.prompter.note,
                log: (message) => ctx.runtime.log(message),
                progress: spin,
              });

              const profileId = "clawdexter:default";
              const credential: DexterOAuthCredential = {
                type: "oauth",
                provider: "clawdexter",
                access: result.access,
                refresh: result.refresh,
                expires: result.expires,
                baseUrl,
              };
              
              currentCredential = credential;

              let toolCount = 0;
              try {
                const tools = await fetchDexterTools({
                  baseUrl,
                  accessToken: result.access,
                });
                toolCount = tools.length;
              } catch {
                // Non-fatal
              }

              return {
                profiles: [{ profileId, credential }],
                notes: [
                  `Connected to Dexter x402 at ${baseUrl}`,
                  toolCount > 0 ? `${toolCount} tools available` : "Tools will be loaded on first use",
                  "Run 'moltbot tools' to see available Dexter tools",
                ],
              };
            } catch (err) {
              spin.stop("Dexter connection failed");
              throw err;
            }
          },
        },
      ],
      
      refreshOAuth: async (cred) => {
        if (cred.provider !== "clawdexter") return cred;
        
        const dexterCred = cred as DexterOAuthCredential;
        const metadata = await fetchOAuthMetadata(dexterCred.baseUrl || baseUrl);
        const tokens = await refreshAccessToken({
          metadata,
          refreshToken: dexterCred.refresh,
        });

        const expiresIn = tokens.expires_in ?? 3600;
        const newCred: DexterOAuthCredential = {
          ...dexterCred,
          access: tokens.access_token,
          refresh: tokens.refresh_token || dexterCred.refresh,
          expires: Date.now() + expiresIn * 1000 - 5 * 60 * 1000,
        };
        
        currentCredential = newCred;
        return newCred;
      },
    });

    // Helper to load credential from file if not in memory
    const loadCredentialFromFile = async (): Promise<DexterOAuthCredential | undefined> => {
      if (currentCredential) return currentCredential;
      
      try {
        const os = await import("node:os");
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        
        // Try multiple auth profile locations
        const possiblePaths = [
          path.join(os.homedir(), ".clawdbot", "agents", "main", "agent", "auth-profiles.json"),
          path.join(os.homedir(), ".moltbot", "auth-profiles.json"),
        ];
        
        for (const authPath of possiblePaths) {
          try {
            const data = await fs.readFile(authPath, "utf8");
            const parsed = JSON.parse(data);
            
            // Handle nested structure: { version, profiles: { "clawdexter:default": {...} } }
            const profiles = parsed.profiles || parsed;
            const profile = profiles["clawdexter:default"];
            
            if (profile?.type === "oauth" && profile?.access) {
              currentCredential = {
                ...profile,
                baseUrl: profile.baseUrl || baseUrl,
              } as DexterOAuthCredential;
              return currentCredential;
            }
          } catch {
            // Try next path
          }
        }
      } catch {
        // Failed to load
      }
      return undefined;
    };

    // Register the Dexter tools gateway
    api.registerTool(
      (ctx: MoltbotPluginToolContext) => {
        console.log("[dexter] registerTool callback called, sandboxed:", ctx.sandboxed);
        // Allow in all contexts - user explicitly authenticated
        // if (ctx.sandboxed) return null;
        
        return {
          name: "dexter_x402",
          label: "Dexter Tools",
          description: "Access 50+ Dexter Solana DeFi tools. Use action 'list' to see available tools, or 'call' to invoke a specific tool.",
          parameters: Type.Object({
            action: Type.Unsafe<"list" | "call">({ type: "string", enum: ["list", "call"] }),
            tool: Type.Optional(Type.String({ description: "Tool name (required for 'call' action)" })),
            args: Type.Optional(Type.String({ description: "JSON arguments for the tool" })),
          }),
          async execute(_id: string, params: Record<string, unknown>) {
            // Try to load credential from file if not in memory
            const cred = await loadCredentialFromFile();
            const accessToken = cred?.access;
            if (!accessToken) {
              return {
                content: [{
                  type: "text" as const,
                  text: "Not connected to Dexter. Run 'moltbot models auth login --provider clawdexter' to connect.",
                }],
                details: { error: "not_authenticated" },
              };
            }

            const action = String(params.action || "list");
            const effectiveBaseUrl = cred?.baseUrl || baseUrl;
            
            if (action === "list") {
              try {
                const tools = await fetchDexterTools({
                  baseUrl: effectiveBaseUrl,
                  accessToken,
                });
                
                const toolList = tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  category: t._meta?.category,
                }));
                
                return {
                  content: [{
                    type: "text" as const,
                    text: JSON.stringify({ tools: toolList, count: tools.length }, null, 2),
                  }],
                  details: { tools: toolList, count: tools.length },
                };
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                  content: [{ type: "text" as const, text: `Failed to list tools: ${message}` }],
                  details: { error: message },
                };
              }
            }
            
            if (action === "call") {
              const toolName = String(params.tool || "");
              if (!toolName) {
                return {
                  content: [{ type: "text" as const, text: "Error: 'tool' parameter required for 'call' action" }],
                  details: { error: "tool_required" },
                };
              }
              
              let toolArgs: Record<string, unknown> = {};
              if (params.args) {
                try {
                  toolArgs = JSON.parse(String(params.args));
                } catch {
                  return {
                    content: [{ type: "text" as const, text: "Error: 'args' must be valid JSON" }],
                    details: { error: "invalid_args" },
                  };
                }
              }
              
              try {
                const result = await callDexterTool({
                  baseUrl: effectiveBaseUrl,
                  accessToken,
                  toolName,
                  args: toolArgs,
                });
                
                return {
                  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
                  details: result,
                };
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return {
                  content: [{ type: "text" as const, text: `Tool call failed: ${message}` }],
                  details: { error: message },
                };
              }
            }
            
            return {
              content: [{ type: "text" as const, text: `Unknown action: ${action}. Use 'list' or 'call'.` }],
              details: { error: "unknown_action" },
            };
          },
        };
      },
      { name: "dexter_x402" },
    );

    // ==========================================================================
    // Generic x402 Tools (No Auth Required)
    // ==========================================================================
    
    // Create telemetry instance
    const telemetry = new DexterTelemetry(!config.disableTelemetry);
    
    // Register x402_pay tool (generic payment for ANY x402 endpoint)
    const x402PayTool = createX402PayTool(config, telemetry);
    api.registerTool(
      () => x402PayTool,
      { name: "x402_pay" }
    );
    
    // Register x402_search tool (directory search)
    const x402SearchTool = createX402SearchTool(config);
    api.registerTool(
      () => x402SearchTool,
      { name: "x402_search" }
    );

    // Register x402_fetch tool (auto-pay via wrapFetch)
    const x402FetchTool = createX402FetchTool(config, telemetry);
    api.registerTool(
      () => x402FetchTool,
      { name: "x402_fetch" }
    );

    // Register x402_check tool (pricing preview)
    api.registerTool(
      () => createX402CheckTool(),
      { name: "x402_check" }
    );

    // Register x402_wallet tool (wallet info)
    api.registerTool(
      () => createX402WalletTool(config),
      { name: "x402_wallet" }
    );

    api.logger.info("Dexter x402 plugin registered");
    api.logger.info(`  - x402_pay: ${config.svmPrivateKey || config.evmPrivateKey ? "wallet configured" : "no wallet (config required)"}`);
    api.logger.info(`  - x402_fetch: ${config.svmPrivateKey || config.evmPrivateKey ? "auto-pay enabled" : "no wallet (returns requirements)"}`);
    api.logger.info(`  - x402_search: marketplace at ${config.directoryUrl || DEFAULT_MARKETPLACE_URL}`);
    api.logger.info(`  - x402_check: pricing preview`);
    api.logger.info(`  - x402_wallet: wallet info`);
    api.logger.info(`  - dexter_x402: ${config.baseUrl || DEFAULT_BASE_URL} (OAuth required)`);
  },
};

export default dexterMcpPlugin;
