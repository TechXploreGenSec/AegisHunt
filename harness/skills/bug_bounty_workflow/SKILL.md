---
name: bug-bounty-workflow
description: Standard operating procedure for bug bounty reconnaissance, vulnerability identification, PoC capture, and report generation.
---

# Bug Bounty Standard Operating Procedure

## Phase 1: Reconnaissance & Mapping
1. Use `sudo_bash` in the Kali Docker container to run nmap, subfinder, or recon tools:
   ```bash
   sudo_bash({ command: "nmap -sV -sC -T4 target.com" })
   ```
2. Inspect frontend web pages using native Playwright / Chrome DevTools MCP tools to bypass WAF bot checks.

## Phase 2: Vulnerability Analysis
- Test for OWASP Top 10 vulnerabilities (XSS, SQLi, SSRF, IDOR, Auth bypass).
- Intercept HTTP traffic via `mitmproxy` MCP.

## Phase 3: Evidence Capture & Reporting
- Capture PoC artifacts using `poc-capture-mcp`.
- Generate structured report using `bugbounty-report-mcp`.
