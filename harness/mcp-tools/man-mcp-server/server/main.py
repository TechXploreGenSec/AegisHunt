# /// script
# dependencies = ["mcp"]
# ///

"""
FastMCP Man Pages Server
------------------------
This defines a FastMCP server that provides access to Linux man pages.
It allows LLMs to search for man pages, retrieve their content, and list available sections.

Features:
- Search man pages by keyword using apropos/man -k
- Retrieve specific man page content with cleaning and formatting
- List available man page sections
- Expose resources via man:// URIs
- Async operations with timeout protection
"""

import asyncio
import json
import os
import re
from typing import List, Optional, Dict, Any
from mcp.server.fastmcp import FastMCP

# Read version from manifest.json
def get_version() -> str:
    """Get version from manifest.json"""
    try:
        manifest_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "manifest.json")
        with open(manifest_path, 'r') as f:
            manifest = json.load(f)
        return manifest.get("version", "unknown")
    except Exception:
        return "unknown"

__version__ = get_version()

# Create the FastMCP server
mcp = FastMCP("Man Pages Server")

class ManPageService:
    """Core service for interacting with system man pages using subprocess calls."""

    # Man page section descriptions
    SECTIONS = {
        "1": "User Commands",
        "2": "System Calls",
        "3": "C Library Functions",
        "4": "Special Files",
        "5": "File Formats and Conventions",
        "6": "Games",
        "7": "Miscellaneous",
        "8": "System Administration Commands",
        "9": "Kernel Routines"
    }

    @staticmethod
    async def run_command(cmd: List[str], timeout: int = 10) -> tuple[str, str, int]:
        """
        Run a command asynchronously with timeout protection.
        Returns (stdout, stderr, return_code).
        """
        process = None
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )

            stdout, stderr = await asyncio.wait_for(
                process.communicate(),
                timeout=timeout
            )

            return (
                stdout.decode('utf-8', errors='replace'),
                stderr.decode('utf-8', errors='replace'),
                process.returncode or 0
            )
        except asyncio.TimeoutError:
            if process:
                process.kill()
                await process.wait()
            raise Exception(f"Command timed out after {timeout} seconds")
        except Exception as e:
            raise Exception(f"Command failed: {str(e)}")

    @staticmethod
    def clean_man_page_content(content: str) -> str:
        """
        Clean man page content for AI consumption by removing formatting codes
        and preserving readable structure.
        """
        # Remove backspace sequences (used for bold/underline)
        content = re.sub(r'.\x08', '', content)

        # Remove ANSI escape sequences
        content = re.sub(r'\x1b\[[0-9;]*m', '', content)

        # Remove excessive whitespace but preserve paragraph structure
        content = re.sub(r'\n\s*\n\s*\n', '\n\n', content)
        content = re.sub(r'[ \t]+', ' ', content)

        # Remove trailing whitespace from lines
        content = '\n'.join(line.rstrip() for line in content.split('\n'))

        return content.strip()

    async def search_man_pages(self, keyword: str) -> List[Dict[str, str]]:
        """
        Search for man pages using apropos command.
        Returns a list of matching pages with their descriptions.
        """
        try:
            stdout, stderr, returncode = await self.run_command([
                'apropos', '--', keyword
            ])

            if returncode != 0:
                # Try alternative search with man -k
                stdout, stderr, returncode = await self.run_command([
                    'man', '-k', keyword
                ])

                if returncode != 0:
                    return []

            results = []
            for line in stdout.strip().split('\n'):
                if not line.strip():
                    continue

                # Parse format: "name (section) - description"
                match = re.match(r'^([^(]+)\s*\(([^)]+)\)\s*-\s*(.+)$', line.strip())
                if match:
                    name, section, description = match.groups()
                    results.append({
                        'name': name.strip(),
                        'section': section.strip(),
                        'description': description.strip()
                    })

            return results

        except Exception as e:
            raise Exception(f"Failed to search man pages: {str(e)}")

    async def get_man_page(self, name: str, section: Optional[str] = None) -> str:
        """
        Retrieve the content of a specific man page.
        If section is not specified, gets the first available section.
        """
        try:
            # Build the man command
            cmd = ['man']
            if section:
                cmd.append(section)
            cmd.append(name)

            stdout, stderr, returncode = await self.run_command(cmd)

            if returncode != 0:
                # If specific section failed, try without section
                if section:
                    stdout, stderr, returncode = await self.run_command(['man', name])
                    if returncode != 0:
                        raise Exception(f"Man page not found: {name}")
                else:
                    raise Exception(f"Man page not found: {name}")

            # Clean and format the content
            cleaned_content = self.clean_man_page_content(stdout)

            if not cleaned_content:
                raise Exception(f"Man page content is empty: {name}")

            return cleaned_content

        except Exception as e:
            raise Exception(f"Failed to get man page '{name}': {str(e)}")

    async def list_sections(self) -> Dict[str, str]:
        """
        List available man page sections with their descriptions.
        """
        available_sections = {}

        # Check which sections actually have man pages
        for section, description in self.SECTIONS.items():
            try:
                # Check if section directory exists and has content
                stdout, stderr, returncode = await self.run_command([
                    'man', '-s', section, '-k', '.'
                ])

                if returncode == 0 and stdout.strip():
                    available_sections[section] = description
            except:
                # If check fails, assume section might still be available
                available_sections[section] = description

        return available_sections

# Create service instance
man_service = ManPageService()

@mcp.tool(name="search_man_pages", description="Search for man pages by keyword or topic")
async def search_man_pages(keyword: str) -> str:
    """
    Search for man pages related to a keyword or topic.

    Args:
        keyword: The keyword or topic to search for

    Returns:
        A formatted list of matching man pages with descriptions
    """
    try:
        results = await man_service.search_man_pages(keyword)

        if not results:
            return f"No man pages found for keyword: {keyword}"

        # Format results for display
        output = [f"Found {len(results)} man page(s) for '{keyword}':\n"]

        for result in results:
            output.append(f"• {result['name']}({result['section']}) - {result['description']}")

        return "\n".join(output)

    except Exception as e:
        return f"Error searching man pages: {str(e)}"

@mcp.tool(name="get_man_page", description="Get the full content of a specific man page")
async def get_man_page(name: str, section: Optional[str] = None) -> str:
    """
    Retrieve the full content of a specific man page.

    Args:
        name: The name of the man page (e.g., 'ls', 'chmod', 'python3')
        section: Optional section number (1-9). If not specified, returns the first available section

    Returns:
        The full formatted content of the man page
    """
    try:
        content = await man_service.get_man_page(name, section)

        # Add header information
        section_info = f" (section {section})" if section else ""
        header = f"=== Man Page: {name}{section_info} ===\n\n"

        return header + content

    except Exception as e:
        return f"Error retrieving man page: {str(e)}"

@mcp.tool(name="list_man_sections", description="List available man page sections")
async def list_man_sections() -> str:
    """
    List all available man page sections with their descriptions.

    Returns:
        A formatted list of man page sections and what they contain
    """
    try:
        sections = await man_service.list_sections()

        output = ["Available Man Page Sections:\n"]

        for section_num, description in sorted(sections.items()):
            output.append(f"Section {section_num}: {description}")

        output.append(f"\nTotal sections available: {len(sections)}")
        output.append("\nTo get a specific man page, use: get_man_page('command_name', 'section_number')")

        return "\n".join(output)

    except Exception as e:
        return f"Error listing man sections: {str(e)}"

# Resources for MCP protocol
@mcp.resource("man://sections")
async def get_sections_resource() -> str:
    """Resource providing list of all man page sections."""
    return await list_man_sections()

@mcp.resource("man://search/{keyword}")
async def get_search_resource(keyword: str) -> str:
    """Resource providing search results for a keyword."""
    return await search_man_pages(keyword)

@mcp.resource("man://{section}/{page}")
async def get_page_resource(section: str, page: str) -> str:
    """Resource providing a specific man page."""
    return await get_man_page(page, section)

if __name__ == "__main__":
    # Run the server
    mcp.run()
