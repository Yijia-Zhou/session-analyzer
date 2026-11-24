"""Manual, zero-model-service App Server probe. Pass a native codex 0.172.0 executable.

Creates a disposable home/project and a loopback Responses SSE fixture. No existing
Codex configuration, transcripts, or API keys are needed. stdout contains counts
and relation flags only. Run from the Analyzer checkout with Node on PATH.
"""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import tempfile
import threading
import time


class MockResponses(BaseHTTPRequestHandler):
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        item = {"type": "message", "id": "msg_probe", "role": "assistant",
                "content": [{"type": "output_text", "text": "fixture answer"}]}
        events = [
            {"type": "response.created", "response": {"id": "resp_probe"}},
            {"type": "response.output_item.added", "output_index": 0, "item": item},
            {"type": "response.output_item.done", "output_index": 0, "item": item},
            {"type": "response.completed", "response": {"id": "resp_probe", "status": "completed",
                "output": [item], "usage": {"input_tokens": 25, "output_tokens": 3, "total_tokens": 28}}},
        ]
        body = "".join("event: " + e["type"] + "\ndata: " + json.dumps(e) + "\n\n" for e in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def investigate(binary, root, endpoint):
    home, repo = root / "home", root / "project"
    home.mkdir()
    repo.mkdir()
    env = {k: v for k, v in os.environ.items() if k.upper() in
           ("PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TMP", "TEMP", "LANG")}
    env.update(CODEX_HOME=str(home), HOME=str(root), USERPROFILE=str(root),
               APPDATA=str(root), LOCALAPPDATA=str(root), NO_PROXY="localhost,127.0.0.1",
               HTTPS_PROXY="http://127.0.0.1:1", HTTP_PROXY="http://127.0.0.1:1")
    (home / "config.toml").write_text(
        'model = "gpt-5.1-codex"\nmodel_provider = "fixture"\n'
        '[analytics]\nenabled = false\n[feedback]\nenabled = false\n'
        '[model_providers.fixture]\nname = "Local fixture"\nwire_api = "responses"\n'
        f'base_url = "{endpoint}/v1"\nrequest_max_retries = 0\nstream_max_retries = 0\n',
        encoding="utf-8")
    proc = subprocess.Popen([str(binary), "app-server", "--stdio"], env=env, cwd=repo,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            text=True, encoding="utf-8")
    inbox = queue.Queue()
    def receive():
        for line in proc.stdout:
            inbox.put(json.loads(line))
        inbox.put(None)
    threading.Thread(target=receive, daemon=True).start()
    serial = 0
    def wait_for(predicate, operation):
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            try:
                row = inbox.get(timeout=max(0.01, deadline - time.monotonic()))
            except queue.Empty:
                break
            if row is None:
                raise RuntimeError(operation + " closed")
            if predicate(row):
                return row
        raise RuntimeError(operation + " timeout")
    def rpc(method, **params):
        nonlocal serial
        serial += 1
        proc.stdin.write(json.dumps(dict(method=method, params=params, id=serial)) + "\n")
        proc.stdin.flush()
        result = wait_for(lambda row: row.get("id") == serial, method)
        if "error" in result:
            if (result["error"]["code"] == -32600 and
                    "Uploaded audio files must be submitted as turn input" in result["error"]["message"]):
                raise ValueError("direct external file audio rejected by turn-input validation")
            raise RuntimeError(f"{method} RPC {result['error']['code']}")
        return result["result"]
    try:
        rpc("initialize", clientInfo={"name": "audit_fixture", "version": "1"},
            capabilities={"experimentalApi": True})
        proc.stdin.write('{"method":"initialized"}\n')
        proc.stdin.flush()
        results = {}
        for mode in ("legacy", "paginated"):
            thread = rpc("thread/start", historyMode=mode, ephemeral=False, cwd=str(repo),
                         sandbox="read-only", approvalPolicy="never")["thread"]
            tid = thread["id"]
            rpc("turn/start", threadId=tid, input=[{"type": "text", "text": "fixture question", "text_elements": []}])
            completed = wait_for(lambda row: row.get("method") == "turn/completed"
                                 and row["params"]["threadId"] == tid, "fixture turn")
            if completed["params"]["turn"]["status"] != "completed":
                raise RuntimeError("local mock turn did not complete")
            results[mode] = {"source": tid}
            for name, attached in (("ordinary", False), ("attached", True)):
                try:
                    child = rpc("thread/fork", threadId=tid, attachToSource=attached, excludeTurns=True)["thread"]
                except RuntimeError as err:
                    if mode != "legacy" or not attached or " RPC " not in str(err):
                        raise
                    results[mode]["attachedError"] = str(err)
                    continue
                results[mode][name] = child["id"]
            if mode == "paginated":
                side = rpc("thread/fork", threadId=tid, attachToSource=True, excludeTurns=True,
                           threadSource="tui_side_chat")["thread"]["id"]
                results[mode]["side"] = side
                # Reproduce the TUI's two pre-turn messages with minimized public text.
                # The app server writes these imported items. This is not a TUI capture.
                items = [{"type": "message", "role": role,
                          "content": [{"type": "input_text", "text": message}]}
                         for role, message in [
                             ("developer", "<side_conversation>fixture policy</side_conversation>"),
                             ("user", "Side conversation boundary.\n\nfixture inherited history")]]
                rpc("thread/inject_items", threadId=side, items=items)
                rpc("turn/start", threadId=side, input=[{"type": "text", "text": "fixture child question",
                                                         "text_elements": []}])
                done = wait_for(lambda row: row.get("method") == "turn/completed"
                                and row["params"]["threadId"] == side, "side fixture turn")
                if done["params"]["turn"]["status"] != "completed":
                    raise RuntimeError("side mock turn did not complete")
                # Exercise replacement of a disposable ordinary fork. The source
                # and the two attached controls keep their original histories.
                ordinary = results[mode]["ordinary"]
                rpc("turn/start", threadId=ordinary, input=[{"type": "text", "text": "fixture reverted turn",
                                                             "text_elements": []}])
                done = wait_for(lambda row: row.get("method") == "turn/completed"
                                and row["params"]["threadId"] == ordinary, "fork turn")
                result = rpc("thread/revert", threadId=ordinary, beforeTurnId=done["params"]["turn"]["id"])
                assert result["thread"]["id"] == ordinary
                resumed = rpc("thread/resume", threadId=ordinary, excludeTurns=True)
                assert resumed["thread"]["id"] == ordinary
            audio_thread = rpc("thread/start", historyMode=mode, ephemeral=False, cwd=str(repo),
                               sandbox="read-only", approvalPolicy="never")["thread"]["id"]
            results[mode]["audio"] = audio_thread
            output = {"name": "fixture_external", "namespace": None, "output": [
                {"type": "input_text", "text": "external fixture caption"},
                {"type": "input_audio", "file_id": "file-synthetic-audio"}]}
            try:
                rpc("turn/start", threadId=audio_thread, input=[], toolOutput=output)
            except ValueError as err:
                print(mode, str(err), flush=True)
            else:
                raise RuntimeError("unexpected acceptance of external audio file ID")
            # Minimal PCM WAV control, four 16-bit silence samples.
            wav = bytes.fromhex("524946462c00000057415645666d74201000000001000100401f0000803e0000020010006461746108000000") + bytes(8)
            output["output"][1] = {"type": "input_audio", "audio_url":
                                   "data:audio/wav;base64," + base64.b64encode(wav).decode("ascii")}
            rpc("turn/start", threadId=audio_thread, input=[], toolOutput=output)
            done = wait_for(lambda row: row.get("method") == "turn/completed"
                            and row["params"]["threadId"] == audio_thread, "external audio input")
            print(mode, "external audio turn", done["params"]["turn"]["status"], flush=True)
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=8)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
    script = Path(__file__).with_name("audit-codex-0172-relations.js")
    subprocess.run(["node", str(script.resolve()), str(home), str(repo), json.dumps(results)], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("codex", type=Path)
    binary = parser.parse_args().codex.resolve(strict=True)
    if subprocess.check_output([str(binary), "--version"], text=True).strip() != "codex-cli 0.172.0":
        raise SystemExit("Expected codex-cli 0.172.0")
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockResponses)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        scratch = Path(__file__).resolve().parents[1] / "tmp"
        scratch.mkdir(exist_ok=True)
        tmp = Path(tempfile.mkdtemp(prefix="codex-0172-probe-", dir=scratch)).resolve()
        assert tmp.parent == scratch and tmp.name.startswith("codex-0172-probe-")
        try:
            investigate(binary, tmp, "http://127.0.0.1:" + str(server.server_port))
        finally:
            for attempt in range(30):
                try:
                    shutil.rmtree(tmp)
                    break
                except PermissionError:
                    if attempt == 29:
                        raise
                    time.sleep(0.5)
    finally:
        server.shutdown()
        server.server_close()
