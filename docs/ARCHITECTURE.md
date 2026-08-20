# Architecture Boundary Snapshot

BOOT-001 establishes package boundaries only. Business behavior begins in BOOT-002.

Core invariant: provider-specific SDKs, persistence clients, queue clients and HTTP frameworks do not belong in `@co/domain`.
