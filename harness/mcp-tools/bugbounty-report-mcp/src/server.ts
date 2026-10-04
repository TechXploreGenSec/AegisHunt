import {
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  CallToolRequestSchema,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { calculateCvss } from "./cvss.js";
import { renderPdf } from "./pdf.js";
import { renderMarkdown } from "./renderMarkdown.js";
import { saveReport } from "./storage.js";
import { getTemplate, listTemplates } from "./templates/index.js";
import { validateFinding } from "./schema/validateFinding.js";
import { PLATFORMS, type Finding, type Platform } from "./types.js";
import { validateReport } from "./validateReport.js";

const server = new Server(
  { name: "bugbounty-report-mcp", version: "0.2.0" },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    tool("list_platforms", "List available report platforms and template variants.", {
      type: "object",
      properties: {},
    }),
    tool("get_template", "Get a platform report template and its field requirements.", {
      type: "object",
      properties: {
        platform: { type: "string", enum: [...PLATFORMS] },
        variant: { type: "string", default: "generic" },
      },
      required: ["platform"],
    }),
    tool("validate_finding", "Validate a canonical finding object before report rendering.", {
      type: "object",
      properties: { finding: { type: "object" } },
      required: ["finding"],
    }),
    tool("validate_report", "Validate report Markdown against a platform template.", {
      type: "object",
      properties: {
        platform: { type: "string", enum: [...PLATFORMS] },
        variant: { type: "string", default: "generic" },
        report_markdown: { type: "string" },
      },
      required: ["platform", "report_markdown"],
    }),
    tool("render_markdown", "Render a canonical finding into platform-specific Markdown.", {
      type: "object",
      properties: {
        platform: { type: "string", enum: [...PLATFORMS] },
        variant: { type: "string", default: "generic" },
        finding: { type: "object" },
      },
      required: ["platform", "finding"],
    }),
    tool("calculate_cvss", "Calculate a CVSS 3.1 base score from a vector.", {
      type: "object",
      properties: { vector: { type: "string" } },
      required: ["vector"],
    }),
    tool("render_pdf", "Render report Markdown as a local PDF without calling an LLM.", {
      type: "object",
      properties: {
        report_markdown: { type: "string" },
        style: { type: "string", enum: ["platform", "plain"], default: "plain" },
        finding_id: { type: "string", default: "rendered-report" },
      },
      required: ["report_markdown"],
    }),
    tool("save_report", "Save report Markdown to the configured local report directory.", {
      type: "object",
      properties: {
        finding_id: { type: "string" },
        markdown: { type: "string" },
        pdf_path: { type: "string" },
      },
      required: ["finding_id", "markdown"],
    }),
  ],
}));

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    ...listTemplates().map((template) => ({
      uri: resourceUri(template.metadata.platform, template.metadata.variant),
      name: template.metadata.title,
      description: template.metadata.description,
      mimeType: "text/markdown",
    })),
    {
      uri: "bugbounty://schemas/finding.schema.json",
      name: "Canonical finding JSON schema",
      description: "Schema consumed by the rendering and validation tools.",
      mimeType: "application/schema+json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  if (params.uri === "bugbounty://schemas/finding.schema.json") {
    return {
      contents: [{ uri: params.uri, mimeType: "application/schema+json", text: JSON.stringify((await import("./schema/finding.schema.json", { with: { type: "json" } })).default, null, 2) }],
    };
  }
  const match = params.uri.match(/^bugbounty:\/\/templates\/([^/]+)\/([^/]+)\.md$/u);
  if (!match) throw new Error(`Unknown resource URI: ${params.uri}`);
  const template = getTemplate(match[1], match[2]);
  if (!template) throw new Error(`Unknown template: ${match[1]}/${match[2]}`);
  return {
    contents: [{ uri: params.uri, mimeType: "text/markdown", text: template.markdown }],
  };
});

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [{
    name: "generate_report",
    description: "Guide a host LLM to draft a report without inventing facts.",
    arguments: [
      { name: "platform", description: "Target report platform.", required: true },
      { name: "finding_summary", description: "Facts supplied by the researcher.", required: true },
    ],
  }],
}));

server.setRequestHandler(GetPromptRequestSchema, async ({ params }) => {
  if (params.name !== "generate_report") throw new Error(`Unknown prompt: ${params.name}`);
  const platform = params.arguments?.["platform"] ?? "generic";
  const findingSummary = params.arguments?.["finding_summary"] ?? "";
  return {
    description: `Draft a ${platform} bug bounty report from supplied facts.`,
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: [
          `You are drafting a ${platform} bug bounty report.`,
          "Use the platform template and required fields as the structure.",
          "Do not invent facts, impact, affected users, or reproduction details.",
          "If a required field is missing, ask for it or clearly flag it instead of guessing.",
          "Return Markdown suitable for validate_report.",
          "",
          "Researcher-provided finding summary:",
          findingSummary,
        ].join("\n"),
      },
    }],
  };
});

server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    return await handleTool(params.name, (params.arguments ?? {}) as Record<string, unknown>);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Unknown tool error");
  }
});

async function handleTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  switch (name) {
    case "list_platforms":
      return jsonResult(listTemplates().map((template) => ({
        platform: template.metadata.platform,
        variant: template.metadata.variant,
        version: template.metadata.version,
        title: template.metadata.title,
      })));
    case "get_template": {
      const template = requireTemplate(args.platform, args.variant);
      return jsonResult({ ...template.metadata, template_markdown: template.markdown });
    }
    case "validate_finding": {
      const result = validateFinding(args.finding);
      return jsonResult(result);
    }
    case "validate_report": {
      const template = requireTemplate(args.platform, args.variant);
      return jsonResult(validateReport(String(args.report_markdown ?? ""), template));
    }
    case "render_markdown": {
      const template = requireTemplate(args.platform, args.variant);
      const findingResult = validateFinding(args.finding);
      if (!findingResult.valid) return jsonResult({ valid: false, errors: findingResult.errors });
      return jsonResult({ markdown: renderMarkdown(args.finding as Finding, template), template: template.metadata });
    }
    case "calculate_cvss":
      return jsonResult(calculateCvss(String(args.vector ?? "")));
    case "render_pdf":
      return jsonResult(await renderPdf(
        String(args.report_markdown ?? ""),
        args.style === "platform" ? "platform" : "plain",
        String(args.finding_id ?? "rendered-report"),
      ));
    case "save_report":
      return jsonResult(await saveReport(String(args.finding_id ?? ""), String(args.markdown ?? ""), args.pdf_path as string | undefined));
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

function requireTemplate(platform: unknown, variant: unknown) {
  const platformName = String(platform ?? "");
  const templateVariant = variant === undefined || variant === null || variant === ""
    ? platformName === "generic" ? "vdp" : "generic"
    : String(variant);
  const template = getTemplate(platformName, templateVariant);
  if (!template) throw new Error(`Unknown template: ${platformName}/${templateVariant}`);
  return template;
}

function resourceUri(platform: Platform, variant: string): string {
  return `bugbounty://templates/${platform}/${variant}.md`;
}

function tool(name: string, description: string, inputSchema: Record<string, unknown>) {
  return { name, description, inputSchema };
}

function jsonResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value as Record<string, unknown> };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

const transport = new StdioServerTransport();
await server.connect(transport);