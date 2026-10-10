// Enforced Tor/proxy bypass for researcher→target traffic.
//
// The operator shell commonly routes through Tor (http_proxy/https_proxy).
// Targets behind Akamai-style edge deny Tor exits outright (HTTP 403
// "Access Denied"), so any target-bound tool inheriting those vars is dead
// on arrival. Every spawn/launch site for target work builds its env through
// this module — proxy vars are ALWAYS unset. No escape hatch: if traffic
// must intentionally chain through a proxy, configure scope.upstreamProxy
// (ffuf -x / mitmdump upstream mode carry it explicitly); env can never
// silently hijack target routing.
//
// Deliberately NOT applied to operator infrastructure (Telegram, bot
// callbacks, interactsh-client): those must reach the public internet over
// whatever network the operator has.
const PROXY_ENV_KEYS = ["http_proxy", "https_proxy", "all_proxy", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY"] as const

export function stripProxyEnv<T extends Record<string, string | undefined>>(env: T): T {
  const clean = { ...env }
  for (const key of PROXY_ENV_KEYS) delete clean[key]
  return clean
}

export function unproxiedEnv(): NodeJS.ProcessEnv {
  return stripProxyEnv({ ...process.env })
}
