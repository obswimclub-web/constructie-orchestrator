# BOOT-008 — Completion Engine V0

Status: IMPLEMENTED LOCALLY — TARGET-RUNTIME VERIFICATION PENDING

## Purpose

Separate `WorkItem COMPLETED` from outcome completion and persist an explicit `CompletionDecision` bound to exact project/work revisions, evidence, verification, and reconciliation state.

## V0 completion gate

`COMPLETE` requires all of:

1. WorkItem belongs to Project.
2. Reconciliation snapshot targets the exact current Project revision and WorkItem revision.
3. Reconciliation state is `PASS`.
4. WorkItem state is `COMPLETED`.
5. At least one `PASS` VerificationRecord exists for the same Project + WorkItem.
6. Every evidence ID used by that PASS verification resolves to `CURRENT` evidence in the same scope.

Anything less produces a truthful non-complete decision rather than optimistic completion.

## Completion states V0

- `COMPLETE`
- `INCOMPLETE`
- `BLOCKED`
- `EVIDENCE_INSUFFICIENT`
- `RECONCILIATION_FAILED`

This is intentionally smaller than the final MOC completion taxonomy and will be expanded without changing the ownership boundary.
