---
name: vault-health
description: Run diagnostic checks on the provenance database. Finds stale notes, orphaned inputs, unlinked notes, and shows the event log. Use when the user wants to audit, clean up, or check the health of their vault's provenance data.
disable-model-invocation: true
---

# Vault Health Check

Run a comprehensive diagnostic on the provenance database and present findings with suggested actions.

## Steps

1. **Check database status**: Call `db_status` to confirm the database is initialized and get overall statistics.

2. **Find orphaned inputs**: Call `find_orphaned_inputs` to list inputs that were stored but never linked to any note.
   - Suggest reviewing these: were they forgotten, or are they no longer needed?

3. **Find unlinked notes**: Call `find_unlinked_notes` to list notes with no known input source.
   - These notes have no provenance trail. Suggest linking them to their sources.

4. **Find stale notes**: Call `find_stale_notes` with a reasonable threshold (e.g. 30 days).
   - For each stale note, suggest the user check whether the file still exists in the vault.

5. **Show recent activity**: Call `get_event_log` with `limit: 10` to show the most recent events.

6. **Present a summary report** with:
   - Total inputs, notes, links, events
   - Number of orphaned inputs
   - Number of unlinked notes
   - Number of stale notes
   - Recent activity

7. **Suggest actions** for any issues found. Never auto-fix — always present findings and let the user decide.

## Important

- This skill is diagnostic only. It never modifies data automatically.
- The MCP server suggests — it never auto-fixes. All vault changes require user approval.
- If the database is not initialized, suggest running `/vault-init` first.
