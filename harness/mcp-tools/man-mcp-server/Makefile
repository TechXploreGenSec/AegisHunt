# Makefile for building MCP Bundle (MCPB)
# Creates a distributable zip file containing the man-mcp server

# Variables
BUNDLE_NAME = man-mcp
VERSION = $(shell python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
DIST_DIR = dist
BUILD_DIR = build
BUNDLE_DIR = $(BUILD_DIR)/bundle
MCPB_FILE = $(DIST_DIR)/$(BUNDLE_NAME)-$(VERSION).mcpb

# Default target
.PHONY: all
all: build

# Build the MCPB zip file
.PHONY: build
build: clean prepare-bundle create-zip
	@echo "✅ MCPB bundle created: $(MCPB_FILE)"

# Clean build artifacts
.PHONY: clean
clean:
	@echo "🧹 Cleaning build artifacts..."
	rm -rf $(BUILD_DIR) $(DIST_DIR)

# Prepare the bundle directory structure
.PHONY: prepare-bundle
prepare-bundle:
	@echo "📦 Preparing bundle structure..."
	mkdir -p $(BUNDLE_DIR)

	# Copy manifest and documentation
	cp manifest.json $(BUNDLE_DIR)/
	cp README.md $(BUNDLE_DIR)/
	cp LICENSE $(BUNDLE_DIR)/

	# Copy server directory with dependencies
	cp -r server $(BUNDLE_DIR)/

	# Create a bundle-specific README if it doesn't exist
	@if [ ! -f $(BUNDLE_DIR)/BUNDLE_README.md ]; then \
		echo "Creating bundle README..."; \
		echo "# $(BUNDLE_NAME) MCP Bundle" > $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "This is an MCP Bundle (MCPB) for accessing Linux man pages." >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "## Installation" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "1. Extract this bundle to your MCP client's bundle directory" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "2. Reference the manifest.json in your MCP client configuration" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "## Usage" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "The bundle provides three tools:" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "- search_man_pages: Search for man pages by keyword" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "- get_man_page: Get full content of a specific man page" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
		echo "- list_man_sections: List all available man page sections" >> $(BUNDLE_DIR)/BUNDLE_README.md; \
	fi

# Create the zip file
.PHONY: create-zip
create-zip:
	@echo "🗜️  Creating MCPB archive..."
	mkdir -p $(DIST_DIR)
	cd $(BUNDLE_DIR) && zip -r ../../$(MCPB_FILE) .
	@echo "📄 Bundle contents:"
	@unzip -l $(MCPB_FILE) | head -20

# Install dependencies (if they need to be refreshed)
.PHONY: install-deps
install-deps:
	@echo "📥 Installing/updating MCP dependencies..."
	rm -rf server/lib/*
	pip install 'mcp>=1.0.0' -t server/lib/

# Test the bundle
.PHONY: test
test: build
	@echo "🧪 Testing bundle..."
	cd $(BUNDLE_DIR) && \
	PYTHONPATH="./server/lib" python3 -c "import mcp.server.fastmcp; print('✅ MCP import successful')" && \
	PYTHONPATH="./server/lib" python3 -c "import sys; sys.path.insert(0, './server'); import main; print('✅ Server import successful')"
	@echo "🧪 Testing server functionality..."
	cd $(BUNDLE_DIR) && \
	PYTHONPATH="./server/lib" python3 ../../test_server.py
	@echo "✅ All tests passed!"

# Validate manifest.json
.PHONY: validate
validate:
	@echo "✅ Validating manifest.json..."
	@python3 -c "import json; json.load(open('manifest.json')); print('✅ manifest.json is valid JSON')"
	@python3 -c "import json; m=json.load(open('manifest.json')); assert 'manifest_version' in m and 'name' in m and 'version' in m and 'server' in m and 'author' in m, 'Missing required fields'; print('✅ manifest.json has required fields')"

# Show bundle info
.PHONY: info
info:
	@echo "📋 Bundle Information:"
	@echo "   Name: $(BUNDLE_NAME)"
	@echo "   Version: $(VERSION)"
	@echo "   Output: $(MCPB_FILE)"
	@if [ -f manifest.json ]; then \
		echo "   Manifest Version: $$(python3 -c "import json; print(json.load(open('manifest.json'))['manifest_version'])")"; \
		echo "   Tools: $$(python3 -c "import json; tools=json.load(open('manifest.json'))['tools']; print(len(tools))") available"; \
	fi
	@if [ -f $(MCPB_FILE) ]; then \
		echo "   Bundle size: $$(du -h $(MCPB_FILE) | cut -f1)"; \
	fi

# Development target - quick build without cleaning
.PHONY: dev
dev: prepare-bundle create-zip
	@echo "🚀 Development build complete: $(MCPB_FILE)"

# Package for release (includes validation and testing)
.PHONY: release
release: clean validate build test
	@echo "🎉 Release package ready: $(MCPB_FILE)"
	@$(MAKE) info

# Help target
.PHONY: help
help:
	@echo "📚 Available targets:"
	@echo "   build        - Build the MCPB file (default)"
	@echo "   clean        - Clean build artifacts"
	@echo "   test         - Test the built bundle"
	@echo "   validate     - Validate manifest.json"
	@echo "   install-deps - Install/update MCP dependencies"
	@echo "   info         - Show bundle information"
	@echo "   dev          - Quick development build"
	@echo "   release      - Full release build with validation and testing"
	@echo "   help         - Show this help message"
