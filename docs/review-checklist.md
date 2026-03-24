# Review Checklist

- [x] Confirm the current review scope and record concrete findings
- [x] Fix corrupt `accounts.json` recovery so the app resets the primary store after backup
- [x] Fix remote discovery adoption so failed saves do not hide discovered instances
- [x] Tighten account identity matching so legacy wildcard rows cannot shadow exact principal matches
- [x] Revisit CloudKit empty-snapshot handling and remove the local-restore fallback
- [x] Re-run targeted tests after each fix
- [x] Re-run full `swift test` before closing the review batch
