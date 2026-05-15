# The proposition

You've spent thirty years building a platform that financial institutions trust with their most important data. TimeScape EDM+ runs the Gold Copy that downstream risk, valuation, and reporting depend on at HSBC, Mizuho Americas, Rabobank, Mediobanca, AllianzGI risklab — and dozens more.

The platform is excellent.

**The presentation hasn't kept up with the platform.**

Today the EDM space is being reshaped by AI-fluent tooling: KX shipped a built-in MCP server with KDB-X; GoldenSource v8.8 ships an LLM chatbot; FINBOURNE LUSID/EDM+ positions on cloud-native API-first lines. Xenomorph's own posture has the right thesis — Matt Pick's *"AI is only as good as the underlying data"* — but the surface that lets AI agents consume the platform doesn't yet exist publicly.

**Our proposal**: build that surface. Wrap TimeScape's CPython binding in a Model Context Protocol server. Surface the value DCO already creates but doesn't expose. Bring the engineering of the last thirty years to the buyers of the next ten.

**Hard rail**: never modify Xenomorph's code. The platform stays exactly as it is. Everything we build is *atop* — a polished overlay that surfaces the strength of what's already there.

<!--
Notes:
This is the thesis slide. Frame it as collaborative, not corrective.
The "presentation hasn't kept up" line is the only mildly critical note in the deck — handle gently in delivery. It's true (per James's read of the situation) but it's said with respect: the engineering excellence is the asset, the marketing/UI is just where we add value.
Cite the KX MCP / GoldenSource / FINBOURNE moves as table-stakes signals — this isn't us inventing a need, the market has already moved.
The "never modify Xenomorph's code" line is the load-bearing trust commitment. Repeat it.
Pacing: ~60 seconds. This sets the whole rest of the deck.
-->
