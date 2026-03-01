---
name: clawdexter
description: "Use ClawDexter for x402 marketplace access inside OpenClaw. Search 5,000+ paid APIs, preview pricing, call endpoints with automatic USDC payment, and access 59+ Dexter DeFi tools via OAuth. Trigger whenever the user wants to find paid APIs, call an x402 endpoint, check pricing, see wallet balance, trade tokens via Dexter, or do anything involving x402 payments, the Dexter marketplace, or USDC-paid API calls."
---

# ClawDexter — x402 Plugin for OpenClaw

ClawDexter gives your OpenClaw agent access to the Dexter x402 marketplace and 59+ authenticated Dexter tools. Search paid APIs, preview pricing, and call any x402 endpoint with automatic USDC payment from the wallet configured in your plugin settings.

## x402 Tools (No Auth Required)

These work immediately once wallet keys are configured in plugin settings.

### `x402_search` — Find paid APIs
Search the Dexter marketplace for x402 endpoints. Returns quality-ranked results with pricing, verification status, seller reputation, and usage volume. Always start here when the user wants to find a paid API.

Results include quality scores (0-100, AI-verified), verification badges, prices per call, network info, and seller names. Highlight verified endpoints when presenting results.

### `x402_fetch` — Call and pay automatically
Call any x402 endpoint with automatic payment from the configured wallet. This is the recommended tool for making paid API calls — the user gets the response directly along with a payment receipt.

Requires a funded wallet (USDC on Solana or EVM). If the wallet isn't configured, tell the user to set `svmPrivateKey` or `evmPrivateKey` in the ClawDexter plugin config.

### `x402_pay` — Call with manual payment control
Lower-level version of `x402_fetch`. Same functionality but exposes more payment details. Most users should use `x402_fetch` instead.

### `x402_check` — Preview pricing
Probes an endpoint and returns payment options per chain without paying. Use before `x402_fetch` to show the user what it'll cost. If the endpoint is free, tell them.

### `x402_wallet` — View wallet info
Shows which wallets are configured (Solana, EVM) and the spending limit. Use when the user asks about their wallet setup or before attempting a fetch.

## Dexter Tools (OAuth Required)

### `dexter_x402` — 59+ Dexter DeFi Tools
After authenticating with Dexter OAuth, access the full tool suite: wallet management, Solana trading (Jupiter swaps), on-chain analytics, Twitter analysis, media generation (Sora video, memes), Hyperliquid perps, games (Pokedexter), and more.

Use `dexter_x402` with action `list` to see available tools, or action `call` with a tool name and args to invoke one.

## Workflow Patterns

### "Find me an API for X"
1. `x402_search` with their query
2. Present top results with prices and quality scores
3. `x402_check` on their chosen endpoint
4. `x402_fetch` to call it

### "Call this URL"
1. `x402_check` to show the price
2. `x402_fetch` to call and pay

### "Swap tokens" / "Check balances" / Dexter features
1. Ensure Dexter OAuth is connected
2. Use `dexter_x402` with the appropriate tool

## Tips

- Search is fuzzy — typos work. Searches match across names, descriptions, categories, URLs, seller names.
- Quality scores: 75+ is verified good, 50-74 is mediocre, below 50 is untested or poor.
- `maxPaymentUSDC` in config limits per-call spending. Default is $0.50.
- Most endpoints cost $0.01-$0.10 per call.
