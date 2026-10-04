import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = join(packageRoot, "dist", "server.js");

async function withClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: packageRoot,
    stderr: "pipe",
  });
  const client = new Client(
    { name: "bugbounty-report-mcp-test-client", version: "1.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

test("supports MCP tools, resources, and prompts over stdio", async () => {
  await withClient(async (client) => {
    const tools = await client.listTools();
    const toolNames = tools.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("render_pdf"));
    assert.ok(toolNames.includes("calculate_cvss"));

    const resources = await client.listResources();
    assert.ok(resources.resources.some((resource) => resource.uri === "bugbounty://schemas/finding.schema.json"));
    assert.ok(resources.resources.some((resource) => resource.uri === "bugbounty://templates/intigriti/generic.md"));

    const template = await client.readResource({ uri: "bugbounty://templates/google-vrp/generic.md" });
    assert.match(String(template.contents[0]?.text), /Issue Summary/u);

    const prompts = await client.listPrompts();
    assert.ok(prompts.prompts.some((prompt) => prompt.name === "generate_report"));
    const prompt = await client.getPrompt({
      name: "generate_report",
      arguments: { platform: "hackerone", finding_summary: "An IDOR exposes another user's invoice." },
    });
    const promptContent = prompt.messages[0]?.content;
    const promptText =
      typeof promptContent === "string"
        ? promptContent
        : promptContent && "text" in promptContent
          ? String(promptContent.text)
          : JSON.stringify(promptContent);
    assert.match(promptText, /Do not invent facts/u);
  });
});

test("returns structured tool results and protocol errors", async () => {
  await withClient(async (client) => {
    const cvss = await client.callTool({
      name: "calculate_cvss",
      arguments: { vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" },
    });
    assert.equal(cvss.isError, undefined);
    assert.match(String(cvss.content[0]?.text), /"score": 9.8/u);

    const invalid = await client.callTool({
      name: "get_template",
      arguments: { platform: "not-a-platform" },
    });
    assert.equal(invalid.isError, true);
    assert.match(String(invalid.content[0]?.text), /Unknown template/u);
  });
});