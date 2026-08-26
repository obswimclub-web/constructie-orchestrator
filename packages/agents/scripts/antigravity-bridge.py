#!/usr/bin/env python3
import sys
import json
import asyncio
import signal
import uuid
import traceback
from typing import Optional, Dict, Any

try:
    from google.antigravity import Agent, LocalAgentConfig, CapabilitiesConfig
    from google.antigravity.types import ChatResponse, BuiltinTools
except ImportError:
    print(json.dumps({"error": "google-antigravity SDK not found"}), file=sys.stdout)
    sys.exit(1)

current_response: Optional[ChatResponse] = None

def handle_sigterm():
    print("Received SIGTERM, cancelling...", file=sys.stderr)
    if current_response is not None:
        try:
            # According to SDK, .cancel() might be async or sync, assuming sync or async
            # if async, we create_task
            asyncio.create_task(current_response.cancel())
        except Exception as e:
            print(f"Error calling cancel(): {e}", file=sys.stderr)
    else:
        sys.exit(0)

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

    # Constrain to read-only MODEL_INFERENCE for now
    config = LocalAgentConfig(
        system_instructions="You are an autonomous agent. Read-only.",
        capabilities=CapabilitiesConfig(enabled_tools=BuiltinTools.none(), enable_subagents=False) # strictly disable tools
    )

    try:
        async with Agent(config) as agent:
            current_response = await agent.chat(prompt)

            async def stream_thoughts():
                async for thought in current_response.thoughts:
                    print(f"THOUGHT: {thought}", file=sys.stderr)
                    sys.stderr.flush()

            async def stream_text():
                async for chunk in current_response:
                    print(f"CHUNK: {chunk}", file=sys.stderr)
                    sys.stderr.flush()

            await asyncio.gather(stream_thoughts(), stream_text())

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
                "evidence": [],
                "unresolvedItems": [],
                "requestedInputs": [],
                "sideEffects": [],
                "usage": {
                    "inputUnits": current_response.usage_metadata.prompt_token_count if hasattr(current_response, 'usage_metadata') and current_response.usage_metadata else 0,
                    "outputUnits": current_response.usage_metadata.candidates_token_count if hasattr(current_response, 'usage_metadata') and current_response.usage_metadata else 0,
                    "estimatedCost": 0,
                    "currency": "USD"
                }
            }
            print(json.dumps(result), file=sys.stdout)

    except asyncio.CancelledError:
        result = {
            "schemaVersion": "1.0.0",
            "runRef": run_ref,
            "status": "CANCELLED",
            "summary": "Agent execution cancelled via SIGTERM",
            "actionsTaken": [], "artifacts": [], "findings": [], "evidence": [],
            "unresolvedItems": [], "requestedInputs": [], "sideEffects": [],
            "usage": {"inputUnits": 0, "outputUnits": 0, "estimatedCost": 0, "currency": "USD"}
        }
        print(json.dumps(result), file=sys.stdout)
    except Exception as e:
        result = {
            "schemaVersion": "1.0.0",
            "runRef": run_ref,
            "status": "FAILED",
            "summary": f"Exception in bridge: {e}",
            "actionsTaken": [], "artifacts": [], "findings": [], "evidence": [],
            "unresolvedItems": [], "requestedInputs": [], "sideEffects": [],
            "usage": {"inputUnits": 0, "outputUnits": 0, "estimatedCost": 0, "currency": "USD"}
        }
        print(json.dumps(result), file=sys.stdout)

if __name__ == "__main__":
    asyncio.run(main())
