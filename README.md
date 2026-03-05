<p align="center">
  <img src="https://raw.githubusercontent.com/Dexter-DAO/dexter-x402-sdk/main/assets/dexter-wordmark.svg" alt="Dexter" width="360">
</p>

<h1 align="center">@dexterai/clawdexter</h1>

<p align="center">
  <strong>x402 payments and marketplace for <a href="https://github.com/openclaw/openclaw">OpenClaw</a> agents.</strong><br>
  Search 5,000+ paid APIs, preview pricing, and auto-pay with USDC across 6 chains.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dexterai/clawdexter"><img src="https://img.shields.io/npm/v/@dexterai/clawdexter.svg" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E=18-brightgreen.svg" alt="Node"></a>
  <a href="https://dexter.cash/marketplace"><img src="https://img.shields.io/badge/Marketplace-dexter.cash-blueviolet" alt="Marketplace"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License"></a>
</p>

<p align="center">
  <a href="https://dexter.cash/opendexter"><strong>Browse paid APIs →</strong></a>
</p>

---

## What is x402?

[x402](https://www.x402.org) is an open protocol for HTTP-native micropayments. When a server returns **402 Payment Required**, the client signs a USDC payment and retries — the server verifies and serves the response. No API keys, no subscriptions, no invoices.

ClawDexter brings x402 to every OpenClaw agent. It ships 5 tools that let agents discover paid APIs, check prices, pay automatically, and track spending — all with a single wallet configuration.

## Install

ClawDexter is an OpenClaw plugin. Install it from the OpenClaw plugin registry or add it directly:

```bash
openclaw plugins install @dexterai/clawdexter
```

Then configure your wallet in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "clawdexter": {
      "svmPrivateKey": "base58_solana_private_key",
      "evmPrivateKey": "0x_hex_evm_private_key",
      "maxPaymentUSDC": "0.50"
    }
  }
}
```

You can configure one wallet or both. Solana keys are base58-encoded, EVM keys are hex with `0x` prefix.

## Tools

### x402_search

Search the Dexter marketplace for x402-enabled paid APIs. Returns quality-ranked results with pricing, verification status, seller reputation, and settlement volume.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search term (e.g. "token analysis", "image generation") |
| `network` | string | No | Filter by network: `solana`, `base`, `polygon`, `arbitrum`, `optimism`, `avalanche` |
| `verified` | boolean | No | Only show quality-verified endpoints |
| `category` | string | No | Filter by category (e.g. "api", "creative") |
| `maxPriceUsdc` | number | No | Maximum price per call in USDC |
| `sort` | string | No | Sort: `marketplace` (default), `relevance`, `quality_score`, `settlements`, `volume`, `recent` |
| `limit` | number | No | Max results (default 20, max 50) |

```
"Search for Solana analytics APIs under $0.10"
```

### x402_fetch

Call any x402-protected endpoint with automatic payment. This is the recommended tool for making paid API calls — the agent gets the response directly along with a payment receipt.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | The x402 resource URL |
| `method` | string | No | HTTP method (default `GET`) |
| `body` | string | No | JSON body for POST/PUT requests |

```
"Use x402_fetch to call https://x402.dexter.cash/api/tools/solscan/trending"
```

**How it works:**

1. Sends the request to the URL
2. Receives `402 Payment Required` with payment terms
3. Signs a USDC payment matching the requested amount and chain
4. Retries with the payment proof header
5. Returns the API response and spend receipt

### x402_pay

Lower-level version of `x402_fetch` with full control over request construction.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | The x402 endpoint URL |
| `method` | string | No | HTTP method (default `GET`) |
| `params` | object | No | Query params (GET) or JSON body (POST) |
| `headers` | object | No | Custom HTTP headers |

Use `x402_fetch` for most calls. Use `x402_pay` when you need custom headers, query parameters on GET requests, or non-JSON payloads.

### x402_check

Probe an endpoint for payment requirements without paying. Returns pricing per chain, accepted networks, pay-to addresses, and the x402 protocol version.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | The URL to check |
| `method` | string | No | HTTP method to probe (default `GET`) |

```
"Use x402_check to see what https://x402.dexter.cash/api/jupiter/quote costs"
```

Returns `requiresPayment: false` for free endpoints, or a list of `paymentOptions` with per-chain pricing.

### x402_wallet

Show which wallets are configured, the default network, and the per-call spending limit.

No parameters. Returns configured wallet types, active network, and `maxPaymentUsdc`.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `svmPrivateKey` | string | — | Solana private key (base58) for Solana payments |
| `evmPrivateKey` | string | — | EVM private key (hex, `0x`-prefixed) for Base/Polygon/Arbitrum/Optimism/Avalanche |
| `defaultNetwork` | string | `"solana"` | Preferred payment network |
| `maxPaymentUSDC` | string | `"0.50"` | Maximum USDC per request (e.g. `"1.00"` = $1) |
| `marketplaceUrl` | string | Dexter API | Override marketplace search endpoint |
| `directoryUrl` | string | Dexter API | Override x402 directory endpoint |
| `disableTelemetry` | boolean | `false` | Disable anonymous usage telemetry |

## Supported Networks

| Network | Chain ID (CAIP-2) | Asset |
|---------|-------------------|-------|
| Solana | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | USDC (SPL) |
| Base | `eip155:8453` | USDC (ERC-20) |
| Polygon | `eip155:137` | USDC (ERC-20) |
| Arbitrum | `eip155:42161` | USDC (ERC-20) |
| Optimism | `eip155:10` | USDC (ERC-20) |
| Avalanche | `eip155:43114` | USDC (ERC-20) |

Solana requires `svmPrivateKey`. All EVM chains share `evmPrivateKey`.

## Architecture

```
┌───────────────┐         ┌──────────────────────┐
│   OpenClaw    │         │  x402-enabled APIs   │
│   Agent       │────────►│  (5,000+ endpoints)  │
│               │  fetch  │                      │
└───────┬───────┘         └──────────┬───────────┘
        │                            │
        │  402 Payment Required      │  200 OK + data
        │◄───────────────────────────│
        │                            │
        │  USDC payment signature    │
        │───────────────────────────►│
        │                            │
        ▼                            ▼
┌───────────────┐         ┌──────────────────────┐
│  @dexterai/   │         │  Dexter Marketplace  │
│  x402 SDK     │         │  dexter.cash         │
│  (payment     │         │  (search, rankings,  │
│   signing)    │         │   verification)      │
└───────────────┘         └──────────────────────┘
```

The plugin uses [`@dexterai/x402`](https://www.npmjs.com/package/@dexterai/x402) to sign USDC payments client-side. No funds are custodied — the wallet keys stay local and payments are signed on-device.

## Troubleshooting

### "No wallet configured"

Set at least one key in plugin config:

```json
{
  "plugins": {
    "clawdexter": {
      "svmPrivateKey": "your_solana_key"
    }
  }
}
```

### Payment rejected (amount_exceeds_max)

The endpoint costs more than your `maxPaymentUSDC` limit. Increase it:

```json
{
  "maxPaymentUSDC": "1.00"
}
```

### Insufficient balance

Fund your wallet with USDC on the appropriate network. Solana wallets need SPL USDC, EVM wallets need ERC-20 USDC on the target chain.

### Tools not appearing

Verify the plugin is enabled:

```bash
openclaw plugins list
```

## Dependencies

| Package | Purpose |
|---------|---------|
| [`@dexterai/x402`](https://www.npmjs.com/package/@dexterai/x402) | x402 payment signing (client SDK) |
| [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) | Runtime type validation for tool schemas |

## Links

- [OpenDexter Marketplace](https://dexter.cash/opendexter) — Browse and discover paid APIs
- [x402 Protocol](https://www.x402.org) — Protocol specification
- [Dexter](https://dexter.cash) — Dexter AI platform
- [OpenClaw](https://github.com/openclaw/openclaw) — AI agent framework
- [@dexterai/x402 SDK](https://www.npmjs.com/package/@dexterai/x402) — Seller SDK for publishing x402 endpoints
- [@dexterai/opendexter](https://www.npmjs.com/package/@dexterai/opendexter) — Standalone MCP server with session wallets
- [Discord](https://discord.gg/dexter) — Community support

## License

MIT
