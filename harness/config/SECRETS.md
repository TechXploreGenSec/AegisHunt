# Secrets policy — READ THIS BEFORE RUNNING

This repo contains **no live secrets by design**, even though it is private.
Every secret value in `harness/config/` is the placeholder
`REPLACE_ME__see_SECRETS.md`. The structure (keys, hosts, paths) is real;
the values are not.

## Where the real values live

The operator's secure bundle (the versioned `opencode-bb-*.zip`, treated
as a credential store — never shared, never committed). It contains:

- `config/.env.bb` — Neo4j Aura, Supabase, Storj S3, Telegram bot tokens
- `config/opencode.json` — same secrets inline (bot `bash -c` commands,
  `GITHUB_TOKEN`, provider `apiKey`, memory backend keys)

## Restoring secrets on a machine

```bash
# 1. copy the secure files over the placeholders
cp <secure-bundle>/config/.env.bb ~/.config/opencode/.env.bb
cp <secure-bundle>/config/opencode.json ~/.config/opencode/opencode.json
chmod 600 ~/.config/opencode/.env.bb

# 2. rewrite the previous machine's home path to this one
sed -i "s|/home/<old-user>|$HOME|g" ~/.config/opencode/opencode.json ~/.config/opencode/.env.bb

# 3. point the shared scope files at this machine
#    SCOPE_DIR=$HOME/.config/opencode/scopes  (in .env.bb)
#    SCOPE_CONFIG_PATH=$HOME/.config/opencode/scopes/current.json  (gh-runner env in opencode.json)
```

## Why not in git

Tokens in git history are forever — rotation means rewriting history on
every clone. The CI workflow that builds the binary needs **zero**
secrets, so nothing is lost by keeping them out.
