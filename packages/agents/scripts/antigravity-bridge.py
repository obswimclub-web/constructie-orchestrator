#!/usr/bin/env python3
import sys
import json
import asyncio
import signal
import uuid
import os
from typing import Optional, Dict, Any

try:
    from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig, Tool
    from google.antigravity.types import ChatResponse, BuiltinTools
except ImportError:
    print(json.dumps({"error": "google-antigravity SDK not found"}), file=sys.stdout)
    sys.exit(1)

current_response: Optional[ChatResponse] = None
evidence_list = []


def handle_sigterm():
    if current_response is not None:
        asyncio.create_task(current_response.cancel())
    else:
        sys.exit(0)

async def dispatch_ipc(tool: str, operation: str, **kwargs) -> Any:
    socket_path = os.environ.get('IPC_SOCKET_PATH')
    nonce = os.environ.get('IPC_NONCE')
    if not socket_path or not nonce:
        raise RuntimeError("IPC socket path or nonce not provided")

    reader, writer = await asyncio.open_unix_connection(socket_path)
    proposal = {
        "tool": tool,
        "operation": operation,
        "nonce": nonce,
        "parameters": kwargs
    }
    writer.write((json.dumps(proposal) + '\n').encode('utf-8'))
    await writer.drain()

    response_data = await reader.readline()
    writer.close()
    await writer.wait_closed()

    if not response_data:
        raise RuntimeError("No response from IPC")

    result = json.loads(response_data.decode('utf-8'))
    if "error" in result:
        raise RuntimeError(result["error"])
    if 'evidenceCandidates' in result and result['evidenceCandidates']:
        evidence_list.extend(result['evidenceCandidates'])
    elif 'summary' in result:
        evidence_list.append({"type": "tool_execution", "sourceRef": tool + ":" + operation, "claimSupported": result['summary']})
    return result

async def main():
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, handle_sigterm)

    global current_response
    input_data = sys.stdin.read()
    if not input_data:
        print(json.dumps({"error": "No input provided"}), file=sys.stdout)
        sys.exit(1)

    try:
        payload = json.loads(input_data)
        wp = payload.get("workPackage", {})
        ctx = payload.get("context", {})
    except json.JSONDecodeError as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}), file=sys.stdout)
        sys.exit(1)

    run_ref = {"runId": ctx.get("workflowRunId", str(uuid.uuid4()))}
    objective = wp.get("objective", "")
    prompt = f"Objective: {objective}\nContext: {json.dumps(ctx)}\n"

    def git_status(): return asyncio.run_coroutine_threadsafe(dispatch_ipc("git", "git.status"), loop).result()
    def git_diff(): return asyncio.run_coroutine_threadsafe(dispatch_ipc("git", "git.diff"), loop).result()
    def git_show(commit: str): return asyncio.run_coroutine_threadsafe(dispatch_ipc("git", "git.show", commit=commit), loop).result()
    def git_commit(message: str): return asyncio.run_coroutine_threadsafe(dispatch_ipc("git", "git.commit", message=message), loop).result()
    def pnpm_qualification(): return asyncio.run_coroutine_threadsafe(dispatch_ipc("qualification", "pnpm.qualification"), loop).result()

    custom_tools = [
        Tool.from_function(git_status, name="git_status", description="Get git status"),
        Tool.from_function(git_diff, name="git_diff", description="Get git diff"),
        Tool.from_function(git_show, name="git_show", description="Get git show"),
        Tool.from_function(git_commit, name="git_commit", description="Commit changes"),
        Tool.from_function(pnpm_qualification, name="pnpm_qualification", description="Run qualification tests"),
    ]

    config = LocalAgentConfig(
        system_instructions="You are an autonomous agent with custom tools.",
        capabilities=CapabilitiesConfig(enabled_tools=BuiltinTools.none(), enable_subagents=False),
        tools=custom_tools
    )

    try:
        async with Agent(config) as agent:
            current_response = await agent.chat(prompt)
            text = await current_response.text()
            status = "COMPLETED"

            result = {
                "schemaVersion": "1.0.0",
                "runRef": run_ref,
                "status": status,
                "summary": text[:2000] if text else "No text",
                "actionsTaken": [],
                "artifacts": [],
                "findings": [],
                "evidence": evidence_list,
                "unresolvedItems": [],
                "requestedInputs": [],
                "sideEffects": [],
                "usage": {"inputUnits": 0, "outputUnits": 0, "estimatedCost": 0, "currency": "USD"}
            }
            print(json.dumps(result), file=sys.stdout)

    except asyncio.CancelledError:
        print(json.dumps({"schemaVersion": "1.0.0", "runRef": run_ref, "status": "CANCELLED", "summary": "Cancelled", "actionsTaken": [], "artifacts": [], "findings": [], "evidence": [], "unresolvedItems": [], "requestedInputs": [], "sideEffects": [], "usage": {"inputUnits": 0, "outputUnits": 0, "estimatedCost": 0, "currency": "USD"}}), file=sys.stdout)
    except Exception as e:
        print(json.dumps({"schemaVersion": "1.0.0", "runRef": run_ref, "status": "FAILED", "summary": f"Failed: {e}", "actionsTaken": [], "artifacts": [], "findings": [], "evidence": [], "unresolvedItems": [], "requestedInputs": [], "sideEffects": [], "usage": {"inputUnits": 0, "outputUnits": 0, "estimatedCost": 0, "currency": "USD"}}), file=sys.stdout)

if __name__ == "__main__":
    asyncio.run(main())
