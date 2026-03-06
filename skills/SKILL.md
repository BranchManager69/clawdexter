---
name: clawdexter
description: "Use ClawDexter for x402 paid API access inside OpenClaw. Search paid APIs on the OpenDexter marketplace, preview endpoint pricing, and call any x402 endpoint with automatic USDC payment across Solana, Base, Polygon, Arbitrum, Optimism, and Avalanche. Trigger whenever the user wants to find paid APIs, call an x402 endpoint, check pricing, see wallet info, or make any USDC-paid API call."
---

# ClawDexter — x402 Plugin for OpenClaw

ClawDexter gives your OpenClaw agent access to x402 paid APIs. Search the Dexter marketplace, preview pricing, and call any x402 endpoint with automatic USDC payment from the wallet configured in plugin settings.

## Tools

### `x402_search` — Find paid APIs

Search the Dexter marketplace for x402 endpoints. Returns quality-ranked results with pricing, verification status, seller reputation, and usage volume. Always start here when the user wants to find a paid API.

Results include quality scores (0-100, AI-verified), verification badges, prices per call, network info, and seller names. Highlight verified endpoints when presenting results.

### `x402_fetch` — Call and pay automatically

Call any x402 endpoint with automatic payment from the configured wallet. This is the recommended tool for making paid API calls — the user gets the response directly along with a payment receipt.

Requires a funded wallet (USDC on Solana or EVM). If the wallet is not configured, tell the user to set `svmPrivateKey` or `evmPrivateKey` in the ClawDexter plugin config.

### `x402_pay` — Call with manual payment control

Lower-level version of `x402_fetch` with full control over request construction (custom headers, query params, non-JSON payloads). Most users should use `x402_fetch` instead.

### `x402_check` — Preview pricing

Probes an endpoint and returns payment options per chain without paying. Use before `x402_fetch` to show the user what a call will cost. Reports `requiresPayment: false` for free endpoints.

### `x402_wallet` — View wallet info

Shows which wallets are configured (Solana, EVM), the default network, and the per-call spending limit. Use when the user asks about their wallet setup or before attempting a fetch.

## Workflow Patterns

### "Find me an API for X"

1. `x402_search` with their query
2. Present top results with prices and quality scores
3. `x402_check` on their chosen endpoint
4. `x402_fetch` to call it

### "Call this URL"

1. `x402_check` to show the price
2. `x402_fetch` to call and pay

### "How much does X cost?"

1. `x402_check` on the endpoint URL
2. Present per-chain pricing options

## Tips

- Search is fuzzy — typos and partial matches work. Searches match across names, descriptions, categories, URLs, and seller names.
- Quality scores: 75+ is verified good, 50-74 is mediocre, below 50 is untested or poor.
- `maxPaymentUSDC` in config limits per-call spending. Default is $0.50.
- Most endpoints cost $0.01-$0.10 per call.
- Supported networks: Solana, Base, Polygon, Arbitrum, Optimism, Avalanche. Solana uses `svmPrivateKey`, all EVM chains share `evmPrivateKey`.
