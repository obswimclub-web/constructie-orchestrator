import { describe, expect, it } from "vitest";
import { assertAttemptTransition, assertWorkItemTransition, InvalidAttemptTransitionError, InvalidWorkItemTransitionError } from "@co/domain";

describe("BOOT-003 WorkItem state machine", () => {
  it("allows the minimal execution path", () => {
    expect(() => assertWorkItemTransition("DRAFT", "READY")).not.toThrow();
    expect(() => assertWorkItemTransition("READY", "ASSIGNED")).not.toThrow();
    expect(() => assertWorkItemTransition("ASSIGNED", "RUNNING")).not.toThrow();
    expect(() => assertWorkItemTransition("RUNNING", "VERIFICATION_REQUIRED")).not.toThrow();
    expect(() => assertWorkItemTransition("VERIFICATION_REQUIRED", "COMPLETED")).not.toThrow();
  });
  it("rejects arbitrary lifecycle jumps", () => {
    expect(() => assertWorkItemTransition("DRAFT", "COMPLETED")).toThrow(InvalidWorkItemTransitionError);
  });
  it("does not allow a terminal attempt to restart", () => {
    expect(() => assertAttemptTransition("SUCCEEDED", "RUNNING")).toThrow(InvalidAttemptTransitionError);
  });
});
