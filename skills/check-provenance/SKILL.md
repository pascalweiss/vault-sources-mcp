---
name: check-provenance
description: Check the provenance of a note — find which input sources it was derived from. Also works in reverse to find which notes were created from a specific input. Use when the user asks "where did this note come from?" or "which notes used this source?"
---

# Check Note Provenance

Trace the origin of a note back to its input sources, or find all notes created from a given input.

## Steps

### Finding sources for a note

1. Identify the note the user is asking about. Read the markdown file to extract the `vault_sources_mcp_id` from its frontmatter.
2. Call `get_sources_for_note` with the `note_id`.
3. For each linked input, present:
   - The `input_id`
   - Metadata (source type, title, URL if available)
   - Whether the input is `active` or `redacted`
4. If the user wants the full original text, call `get_input` for the specific input.

### Finding notes for an input

1. If the user asks about a specific input/source, call `get_notes_for_input` with the `input_id`.
2. Present all notes that were derived from this input.

## Arguments

- `$ARGUMENTS` (optional): The note filename, path, or input ID to look up.

## Examples

```
/check-provenance Composting Basics
```
Looks up the provenance of the "Composting Basics" note.

```
/check-provenance input:abc123
```
Finds all notes derived from input `abc123`.

## Important

- If the note has no `vault_sources_mcp_id` in its frontmatter, it cannot be tracked. Inform the user and suggest adding an ID.
- If a source is redacted, its content shows as `[REDACTED]` but the link and metadata remain.
