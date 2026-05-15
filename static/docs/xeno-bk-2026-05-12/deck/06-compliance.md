# The compliance lane

Regulatory data infrastructure is what Xenomorph is *for*. Not a feature, not a module — the whole platform was architected around the requirements that BCBS 239 codified and that FRTB / IPV-MCC / BaFin / DORA / T+1 continue to extend.

## The frameworks TimeScape EDM+ supports

| Framework | What it demands | What TimeScape provides |
| --- | --- | --- |
| **BCBS 239** | Risk data aggregation: accuracy, completeness, timeliness, adaptability. Full lineage. Principles 3, 4, 5, 6. | Full source-to-Gold lineage automatically. Configurable validation. Maker-Checker (four-eyes). Exception workflows with time-stamped audit. |
| **FRTB** | 10-year daily history for risk-factor eligibility under IMA. Demonstrable real-price observations. Point-in-time data reconstruction. | Native time-series across all frequencies + asset classes. Point-in-time queries reconstruct any historical date. Risk factor management + eligibility testing produce auditable output. |
| **IPV / MCC** | Independent Price Verification: at least monthly, daily for material positions. Independent of Front Office. Tolerance management + escalation. | IPV workflow engine, consensus pricing, tolerance automation. Maker-Checker escalation records. Auditor-ready output. |
| **BaFin / MaRisk** | German regulatory data governance + audit. Mirrors and in places exceeds BCBS 239. | Deployed at Helaba and others. MaRisk-aligned workflows. |

## The regulatory tailwinds — 2025-2026

| Driver | Status | Implication for buyers |
| --- | --- | --- |
| **ECB** *Guide on Effective Risk Data Aggregation and Risk Reporting* (RDARR) | Published May 2024. **SSM 2025-27 supervisory priority.** | Attribute-level lineage demanded. EDM is no longer optional infrastructure. |
| **DORA** (Digital Operational Resilience Act) | **Live Jan 2025.** | Vendor risk + data resilience under EU supervisory framework. |
| **T+1 settlement** | US: live May 2024. EU: proposal Feb 2025. UK: Oct 2027. | Real-time security-master + SSI updates become structural. |

Every one of these tightens the requirement for what TimeScape EDM+ already does. The platform isn't catching up to compliance — compliance is catching up to the platform.

<!--
Notes:
This is the slide where BK should be nodding. He's lived through BCBS 239 since principles came out in 2013. He knows MaRisk inside-out from the German deployments. FRTB has been on his roadmap for years.

The "regulatory tailwinds" framing matters. It's the *forward-looking* part — the ECB RDARR being a 2025-27 supervisory priority isn't widely understood yet, and it tilts the buying conversation Xeno is in. Bring that home.

Closing line "The platform isn't catching up to compliance — compliance is catching up to the platform" is the punch. It positions Xeno as ahead of where the regulators have just landed.

Pacing: ~75 seconds. The tables do the work.
-->
