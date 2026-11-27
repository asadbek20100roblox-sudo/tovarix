# Release gates
- Foundation: local single-device prototype; no production data.
- Database: dedicated project, tenant isolation, authentication, atomic inventory and sale RPC, idempotency, audit, role and store permissions. Draft SQL is not deployed.
- Hardware: validate Android camera, HID scanner, printer and scales on actual devices. No fiscal receipt claim.
- Business: implement staff invitations, store-specific permissions, purchases, returns, finance and conflict-safe offline sync.
- AI: server-side Gemini credentials, authenticated tenant-scoped aggregates, quotas, no autonomous mutations.
- Monetization: server-owned entitlements, verified payment webhooks, transactional promo redemption, decide trial limits.
- Release: test web and APK builds, device tests, backups, security review, Uzbekistan fiscal integration, privacy policy, signed release and store approval.
