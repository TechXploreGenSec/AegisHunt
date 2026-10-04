# MCP Man Pages Server

A Model Context Protocol (MCP) server that provides access to Linux man pages using FastMCP. This server allows AI assistants to search, retrieve, and explore system documentation directly from your local machine.

This server is packaged as an MCPB (MCP Bundle) for easy integration with GitHub Copilot in VS Code.

## Features

- **Search man pages**: Find documentation by keyword or command name using `apropos`
- **Retrieve specific pages**: Get complete man page content by name and optional section
- **List sections**: Browse available man page sections (1-9) with descriptions
- **Clean formatting**: Man page content is cleaned and formatted for AI consumption
- **Async operations**: All operations are asynchronous with timeout protection
- **MCP Resources**: Expose man pages as resources with `man://` URIs

## Requirements

- **Operating System**: Linux with standard man page system
- **Python**: 3.10 or higher
- **System Commands**: `man`, `apropos` (usually pre-installed on Linux)
- **Dependencies**: MCP library (bundled in MCPB or installed via package managers)

## Installation

### Quick Start with MCPB Bundle

The easiest way to use this server is with the MCPB bundle, which is supported by Claude Desktop:

```bash
# Clone the repository
git clone https://github.com/guyru/man-mcp.git
cd man-mcp

# Build the MCPB bundle
make build

# This creates dist/man-mcp-{version}.mcpb
```

#### Installing in Claude Desktop

1. Open Claude Desktop settings
2. Navigate to the MCP section
3. Add the generated `dist/man-mcp-{version}.mcpb` bundle file

### Development Installation

#### Using uv (recommended)

```bash
# Clone the repository
git clone https://github.com/guyru/man-mcp.git
cd man-mcp

# Install dependencies
uv sync

# Install with development tools
uv sync --extra dev
```

#### Using pip

```bash
# Clone the repository
git clone https://github.com/guyru/man-mcp.git
cd man-mcp

# Install the package and dependencies from pyproject.toml
pip install .

# Or install in development mode (editable install)
pip install -e .

# For development with optional dependencies
pip install -e .[dev]
```

## Usage

### Running the Server for Development

```bash
# Using uv
uv run python3 server/main.py

# Using python directly
python3 server/main.py

# With MCP development tools
uv run mcp dev server/main.py
```

### Building and Using MCPB Bundle

```bash
# Build the bundle
make build

# Test the bundle
make test

# View bundle information
make info
```

### VS Code Integration

This MCP server can be integrated with VS Code using the GitHub Copilot extension. Since GitHub Copilot does not yet support MCPB bundles, direct configuration is required for VS Code.

#### Configuration for GitHub Copilot

Create a `.vscode/mcp.json` file in your workspace with the following configuration:

```json
{
  "servers": {
    "man-mcp-server": {
      "type": "stdio",
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/path/to/man-mcp",
        "server/main.py"
      ]
    }
  }
}
```

#### Alternative: Using python directly

If you prefer not to use uv, you can configure it with python directly:

```json
{
  "servers": {
    "man-mcp-server": {
      "type": "stdio",
      "command": "python3",
      "args": ["/path/to/man-mcp/server/main.py"],
      "env": {
        "PYTHONPATH": "/path/to/man-mcp/server/lib"
      }
    }
  }
}
```

#### MCP Bundle Support

MCP bundles are supported by Claude Desktop and can be installed directly. For other MCP clients like GitHub Copilot, use the manual configuration above.

**Note**: Replace `/path/to/man-mcp` with the actual path to your project directory.

Once configured, you can interact with the man pages server through GitHub Copilot in VS Code by asking questions about Linux commands and system documentation.

## Available Tools

### 1. search_man_pages
Search for man pages by keyword or topic:
```python
search_man_pages("permission")  # Find pages about permissions
search_man_pages("network")     # Find networking-related pages
```

### 2. get_man_page
Retrieve the full content of a specific man page:
```python
get_man_page("ls")           # Get ls man page (any section)
get_man_page("chmod", "1")   # Get chmod from section 1 specifically
get_man_page("printf", "3")  # Get printf from section 3 (C library)
```

### 3. list_man_sections
List all available man page sections with descriptions:
```python
list_man_sections()  # Shows sections 1-9 with descriptions
```

## Available Resources

The server exposes man pages as resources using `man://` URIs:

- `man://sections` - List of all available sections
- `man://search/{keyword}` - Search results for a keyword
- `man://{section}/{page}` - Specific man page content

Examples:
- `man://search/network` - Search results for "network"
- `man://1/ls` - The ls command man page from section 1
- `man://3/printf` - The printf function man page from section 3

## Troubleshooting


## Development

### Available Make Commands

```bash
# Build the MCPB bundle
make build

# Test the bundle and server functionality
make test

# Show bundle information
make info

# Clean build artifacts
make clean

# Show all available targets
make help
```

### Using with MCP Inspector

```bash
# Run with MCP development tools for debugging
uv run mcp dev server/main.py
```

## Error Handling

The server includes comprehensive error handling:

- **Missing pages**: Graceful handling with informative error messages
- **Timeout protection**: Subprocess calls are protected with configurable timeouts
- **Fallback methods**: If `apropos` fails, falls back to `man -k`
- **Content validation**: Ensures retrieved content is not empty
- **Clean formatting**: Removes ANSI codes and formatting for AI consumption

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
