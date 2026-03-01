<p align="center">
  <img src="https://raw.githubusercontent.com/Dexter-DAO/dexter-x402-sdk/main/assets/dexter-wordmark.svg" alt="Dexter" width="360">
</p>

<h1 align="center">@dexterai/clawdexter</h1>

<p align="center">
  <strong>x402 payments + marketplace for OpenClaw agents. Search, price-check, and pay for any paid API.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dexterai/clawdexter"><img src="https://img.shields.io/npm/v/@dexterai/clawdexter.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E=18-brightgreen.svg" alt="Node"></a>
  <a href="https://dexter.cash/marketplace"><img src="https://img.shields.io/badge/Marketplace-dexter.cash-blueviolet" alt="Marketplace"></a>
</p>

<p align="center">
  <a href="https://dexter.cash/opendexter"><strong>Browse paid APIs →</strong></a>
</p>

---

## Overview

### Generic x402 Tools (No Auth Required)

Configure your wallet keys and start making paid API calls immediately:

- **`x402_search`** - Search the marketplace for 5,000+ paid APIs with quality scores and ranking
- **`x402_fetch`** - Call any x402 API with automatic payment (recommended)
- **`x402_pay`** - Call any x402 API with manual payment control
- **`x402_check`** - Preview endpoint pricing without paying
- **`x402_wallet`** - View wallet address and balances

### Dexter MCP Tools (OAuth Required)

Connect to Dexter's 59+ Solana DeFi tools via OAuth:

- **`dexter_x402`** - Gateway to wallet management, trading, analytics, games, and more

## Quick Start

### Option A: Generic x402 (No Auth - Config Only)

Add your wallet keys to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "dexter-x402": {
      "svmPrivateKey": "YOUR_SOLANA_PRIVATE_KEY",
      "evmPrivateKey": "0xYOUR_EVM_PRIVATE_KEY",
      "maxPaymentUSDC": "0.50"
    }
  }
}
```

Then use:
```bash
# Search for paid APIs
openclaw agent -m "Use x402_search to find weather APIs"

# Call a paid endpoint
openclaw agent -m "Use x402_pay to call https://example.com/api/data"
```

### Option B: Dexter Tools (OAuth Required)

#### 1. Authenticate

```bash
openclaw models auth login --provider dexter-x402
```

This opens OAuth flow in your browser. Sign in with your Dexter account and authorize OpenClaw.

### 2. Use Tools

The plugin exposes a single gateway tool `dexter_x402` that provides access to all 59+ Dexter capabilities:

```bash
# List available tools
openclaw agent --local --session-id demo -m "Use dexter_x402 with action='list'"

# Call a specific tool
openclaw agent --local --session-id demo -m "Use dexter_x402 to check trending Solana tokens"
```

Or simply ask naturally:

```bash
openclaw agent --local --session-id demo -m "What's trending on Solana right now?"
```

## Available Tools (59+)

### 💼 Wallet Management
| Tool | Description |
|------|-------------|
| `resolve_wallet` | Resolve the effective managed wallet for this session |
| `list_my_wallets` | List all wallets linked to your Dexter account |
| `set_session_wallet_override` | Override wallet for the current session |
| `auth_info` | Diagnostics for wallet resolution and token state |

### 💱 Solana Trading
| Tool | Description |
|------|-------------|
| `solana_resolve_token` | Resolve token metadata by name, ticker, or address |
| `solana_send` | Transfer SOL, USDC, DEXTER, PAYAI, or any SPL token |
| `solana_swap_preview` | Preview a token swap before execution |
| `solana_swap_execute` | Execute a previewed swap |
| `jupiter_quote_preview` | Get Jupiter DEX swap quote |
| `jupiter_quote_pro` | Jupiter quote with pro-tier features |

### 📊 Analytics & Research
| Tool | Description |
|------|-------------|
| `search` | Web search with real-time results |
| `fetch` | Retrieve and summarize web pages |
| `pumpstream_live_summary` | Live pump.fun stream analytics |
| `markets_fetch_ohlcv` | Birdeye OHLCV candle data |
| `onchain_activity_overview` | On-chain analytics for tokens/wallets |
| `onchain_entity_insight` | Deep analysis of wallets, tokens, or signatures |
| `solscan_trending_tokens` | Solscan trending tokens snapshot |
| `slippage_sentinel` | Volatility analysis & optimal slippage calculation |
| `twitter_topic_analysis` | Twitter sentiment and conversation analysis |

### 🎬 Creative & Media (x402 Paid)
| Tool | Description |
|------|-------------|
| `sora_video_job` | Generate video clips with OpenAI Sora |
| `meme_generator_job` | AI-powered meme and image generation |
| `studio_breaking_news` | Create newscast videos and infographics |
| `studio_news_status` | Check breaking news job status |

### 🎮 Games
| Tool | Description |
|------|-------------|
| `pokedexter_create_challenge` | Create wagered Pokémon battle ($1-$25) |
| `pokedexter_accept_challenge` | Accept a battle challenge |
| `pokedexter_make_move` | Submit battle action |
| `pokedexter_get_battle_state` | Get current battle state |
| `pokedexter_join_queue` | Join quick match queue |
| `games_king_usurp` | Become King of Dexter ($0.01) |
| `games_king_state` | View current King state |
| `games_story_append` | Add to the Infinite Story ($0.01) |
| `games_story_read` | Read the Infinite Story |

### 🚀 Hyperliquid (Perpetuals)
| Tool | Description |
|------|-------------|
| `hyperliquid_markets` | List tradable perp symbols |
| `hyperliquid_opt_in` | Provision agent wallet for perp trading |
| `hyperliquid_fund` | Bridge SOL → USDC → Hyperliquid |
| `hyperliquid_bridge_deposit` | Deposit from Arbitrum |
| `hyperliquid_perp_trade` | Submit perpetual orders |

### 🔧 Codex Sessions
| Tool | Description |
|------|-------------|
| `codex_start` | Begin a new Codex conversation |
| `codex_reply` | Follow-up to existing Codex session |
| `codex_exec` | Run Codex with optional JSON schema |

### 🏭 Studio (Superadmin)
| Tool | Description |
|------|-------------|
| `studio_create` | Start a Studio agent task |
| `studio_status` | Check job status |
| `studio_cancel` | Cancel running job |
| `studio_inspect` | Full job details |
| `studio_list` | List recent jobs |

### 📺 Stream Engagement
| Tool | Description |
|------|-------------|
| `stream_public_shout` | Submit shout-out for live stream |
| `stream_shout_feed` | Get latest public shouts |

## Architecture

```
┌─────────────────┐     OAuth 2.0 + PKCE      ┌──────────────────┐
│    OpenClaw      │◄─────────────────────────►│  Dexter OAuth    │
│  (dexter-x402    │                           │  (dexter-api)    │
│    plugin)      │                           └──────────────────┘
└────────┬────────┘
         │
         │  MCP Protocol (JSON-RPC over HTTP)
         │  - tools/list
         │  - tools/call
         ▼
┌─────────────────┐     Internal      ┌──────────────────┐
│   Dexter x402    │◄─────────────────►│  Dexter Backend  │
│    Server       │                   │  (59+ tools)     │
│ mcp.dexter.cash │                   │                  │
└─────────────────┘                   └──────────────────┘
```

### Authentication Flow

**Primary (Desktop/CLI):**
1. **Link Request**: Plugin creates a tracking code via `api.dexter.cash/api/openclaw/link/create`
2. **DCR**: Plugin registers with Dexter's OAuth server using remote callback (`dexter.cash/openclaw/link/callback`)
3. **PKCE Authorization**: Browser-based OAuth with S256 code challenge
4. **Remote Callback**: OAuth redirects to `dexter.cash`, backend stores tokens
5. **Poll Completion**: Plugin polls for tokens, retrieves them when ready
6. **Automatic Refresh**: Tokens refreshed automatically before expiry

**Fallback (Telegram/Remote):**
1. **Device Code**: Plugin creates link code, displays to user
2. **Manual Auth**: User visits `dexter.cash/openclaw/link?code=XXXX`, signs in
3. **Poll Completion**: Plugin polls until user completes auth

### MCP Integration

The plugin uses the official `@modelcontextprotocol/sdk` to:

1. Establish `StreamableHTTPClientTransport` connection to `mcp.dexter.cash/mcp`
2. Send `tools/list` JSON-RPC requests to discover available tools
3. Execute `tools/call` JSON-RPC requests for tool invocation
4. Handle response content (text, JSON, images)

## Configuration

Full configuration in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "dexter-x402": {
      "svmPrivateKey": "base58_solana_private_key",
      "evmPrivateKey": "0x_hex_evm_private_key",
      "defaultNetwork": "solana",
      "maxPaymentUSDC": "0.50",
      "baseUrl": "https://mcp.dexter.cash/mcp",
      "directoryUrl": "https://api.dexter.cash/api/x402/directory",
      "autoRefreshTools": true,
      "disableTelemetry": false
    }
  }
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `svmPrivateKey` | string | - | Solana private key (base58) for x402 payments |
| `evmPrivateKey` | string | - | EVM private key (hex) for Base/Polygon/etc payments |
| `defaultNetwork` | string | `"solana"` | Preferred network: solana, base, polygon, arbitrum, optimism, avalanche |
| `maxPaymentUSDC` | string | `"0.50"` | Maximum payment per request (e.g., "0.50" = $0.50) |
| `baseUrl` | string | `https://mcp.dexter.cash/mcp` | Dexter MCP server (for authenticated tools) |
| `directoryUrl` | string | `https://x402.dexter.cash/api/x402/directory` | x402 directory API |
| `autoRefreshTools` | boolean | `true` | Refresh Dexter tool list on connection |
| `disableTelemetry` | boolean | `false` | Disable anonymous usage telemetry |

## Tools Reference

### x402_pay (Generic Payments)

Call ANY x402-enabled paid API with automatic USDC payment. No authentication required - just configure wallet keys.

**Supported Networks:** Solana, Base, Polygon, Arbitrum, Optimism, Avalanche

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | Yes | The x402-enabled endpoint URL |
| `method` | string | No | HTTP method (default: GET) |
| `params` | object | No | Query params (GET) or JSON body (POST) |
| `headers` | object | No | Custom HTTP headers |

**Example:**
```bash
openclaw agent -m "Use x402_pay to call https://x402.dexter.cash/api/onchain/activity/overview with params {\"entityId\": \"SOL\"}"
```

**How it works:**
1. Makes request to the URL
2. If 402 returned, SDK automatically signs USDC payment
3. Retries request with payment proof
4. Returns response data

### x402_search (Directory Search)

Search the aggregated directory of x402-enabled paid APIs. Combines Dexter's catalog with external sources.

**Parameters:**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | No | Search term (searches url, description) |
| `network` | string | No | Filter: solana, base, polygon, arbitrum, optimism, avalanche |
| `verified` | boolean | No | Only show verified endpoints |
| `limit` | number | No | Max results (default: 10, max: 50) |

**Example:**
```bash
openclaw agent -m "Use x402_search to find Solana analytics APIs"
```

**Response includes:**
- Endpoint URL and method
- Network and pricing
- Description and verification status
- Success rate (when available)

### x402_fetch (Auto-Pay)

Call any x402 endpoint with automatic payment from your configured wallet.

```
"Use x402_fetch to call https://x402.dexter.cash/api/jupiter/quote"
```

| Parameter | Type   | Description                    |
|-----------|--------|--------------------------------|
| url       | string | The x402 resource URL to call  |
| method    | string | HTTP method (default: GET)     |
| body      | string | JSON request body for POST/PUT |

### x402_check (Pricing Preview)

Probe an endpoint to see payment requirements per chain without paying.

```
"Use x402_check to see what https://x402.dexter.cash/api/jupiter/quote costs"
```

| Parameter | Type   | Description                         |
|-----------|--------|-------------------------------------|
| url       | string | The URL to check                    |
| method    | string | HTTP method to probe with (GET)     |

### x402_wallet (Wallet Info)

Show configured wallet info and balances.

```
"Use x402_wallet to check my balance"
```

### dexter_x402 (Authenticated Dexter Tools)

## How It Works

### The `dexter_x402` Gateway

Rather than registering 59+ individual tools (which would overwhelm the agent's context), this plugin exposes a single `dexter_x402` gateway with two actions:

```typescript
{
  action: "list" | "call",
  tool?: string,      // Tool name (required for "call")
  args?: string       // JSON arguments for the tool
}
```

**List tools:**
```json
{ "action": "list" }
```

**Call a tool:**
```json
{ 
  "action": "call", 
  "tool": "solscan_trending_tokens",
  "args": "{\"limit\": 10}"
}
```

### Credential Storage

OAuth credentials are stored in:
```
~/.openclaw/auth-profiles.json
# or legacy location:
~/.clawdbot/agents/main/agent/auth-profiles.json
```

Format:
```json
{
  "version": 1,
  "profiles": {
    "dexter-x402:default": {
      "type": "oauth",
      "provider": "dexter-x402",
      "access": "eyJ...",
      "refresh": "...",
      "expires": 1769639417118,
      "baseUrl": "https://mcp.dexter.cash/mcp"
    }
  }
}
```

## Troubleshooting

### "Not connected to Dexter"

The tool couldn't find valid credentials. Run:
```bash
openclaw models auth login --provider dexter-x402
```

### OAuth on Telegram or remote server

The plugin automatically uses device code flow for Telegram and remote environments:

1. Plugin displays a link code (e.g., `ABC12345`)
2. Visit `dexter.cash/openclaw/link?code=ABC12345` in any browser
3. Sign in to Dexter and click "Connect"
4. Return to OpenClaw - it will detect the auth automatically

No localhost or port forwarding needed.

### Token expired

Tokens auto-refresh. If refresh fails, re-authenticate:
```bash
openclaw models auth login --provider dexter-x402
```

### MCP connection errors

Check that `mcp.dexter.cash` is accessible:
```bash
curl https://mcp.dexter.cash/mcp/health
```

### Tools not appearing

Ensure the plugin is enabled:
```bash
cat ~/.openclaw/openclaw.json | jq '.plugins'
```

## Development

### Building

```bash
cd /path/to/openclaw-research
pnpm build
```

### Testing OAuth Flow

```bash
./openclaw.mjs models auth login --provider dexter-x402
```

### Testing Tool Execution

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
./openclaw.mjs agent --local --session-id test -m "Use dexter_x402 with action='list'"
```

## Dependencies

- `@modelcontextprotocol/sdk` - Official MCP client SDK
- `@sinclair/typebox` - Runtime type validation

## Links

- [Dexter](https://dexter.cash) - Main website
- [Dexter x402](https://mcp.dexter.cash) - MCP server
- [MCP Specification](https://modelcontextprotocol.io) - Protocol documentation
- [Discord](https://discord.gg/dexter) - Community support

## License

MIT
