---
name: new-note
description: Create a new Obsidian note with full provenance tracking. Generates a stable ID, writes the markdown file, registers the note, and links it to its input sources. Use when the user wants to create a new note from source material.
---

# Create a New Note with Provenance Tracking

Full workflow for creating a new Obsidian vault note that is tracked in the provenance database.

## Steps

1. **Generate an ID**: Call `generate_note_id` to get a UUIDv7 and the frontmatter key.
2. **Ask the user for approval** before injecting the ID into the note's frontmatter.
3. **Write the markdown file** in the vault with the following frontmatter structure:
   ```yaml
   ---
   vault_sources_mcp_id: <the generated UUIDv7>
   # ... any other frontmatter the user wants
   ---
   ```
4. **Register the note**: Call `register_note` with the generated `note_id` and optional metadata (e.g. `{ "title": "Note Title", "path": "relative/path.md" }`).
5. **Link to sources**: For each input that contributed to this note, call `add_link` with the `input_id` and `note_id`.
6. **Confirm**: Report back the note ID, file path, and which inputs were linked.

## Important

- The `vault_sources_mcp_id` frontmatter key is required for provenance tracking. The MCP server refuses to link notes without it.
- Always ask the user before injecting the ID into frontmatter.
- If the input sources haven't been stored yet, store them first using `store_input` (or suggest `/store-source`).
- Both the input and the note must exist in the database before you can link them.

## Arguments

- `$ARGUMENTS` (optional): The title or topic for the new note.

## Example

```
/new-note Composting Basics
```

This creates a new note titled "Composting Basics" with a tracked provenance ID and links it to any previously stored inputs about composting.
