#!/usr/bin/env python3
"""
Test script for the MCP man pages server functionality.
This script tests the core functionality of the server.
"""

import sys
import asyncio
from pathlib import Path

# Add server directory to path
server_dir = Path(__file__).parent / "server"
sys.path.insert(0, str(server_dir))

from main import man_service

async def test_server_functionality():
    """Test the core server functionality."""
    print("🧪 Testing server functionality...")

    # Test 1: Search functionality
    print("🔍 Testing search functionality...")
    try:
        result = await man_service.search_man_pages('ls')
        assert len(result) > 0, 'Search should return results'
        print(f"✅ Search test passed - found {len(result)} results")
    except Exception as e:
        print(f"❌ Search test failed: {e}")
        return False

    # Test 2: Page retrieval
    print("📖 Testing page retrieval...")
    try:
        content = await man_service.get_man_page('ls', '1')
        assert content and len(content) > 100, 'Man page content should not be empty'
        print(f"✅ Page retrieval test passed - got {len(content)} characters")
    except Exception as e:
        print(f"❌ Page retrieval test failed: {e}")
        return False

    # Test 3: Section listing
    print("📚 Testing section listing...")
    try:
        sections = await man_service.list_sections()
        assert len(sections) > 0, 'Should return available sections'
        print(f"✅ Section listing test passed - found {len(sections)} sections")
    except Exception as e:
        print(f"❌ Section listing test failed: {e}")
        return False

    print("✅ All server functionality tests passed!")
    return True

if __name__ == "__main__":
    success = asyncio.run(test_server_functionality())
    sys.exit(0 if success else 1)
