import json

from onepc_guard import GuardPolicy


def test_all_clear_status():
    policy = GuardPolicy(allow={"chrome.exe", "code.exe"}, ignore={"explorer.exe"})
    result = policy.evaluate(["chrome.exe", "code.exe", "explorer.exe"])

    assert result["status"] == "ok"
    assert result["blocked"] == []


def test_blocked_processes_are_reported():
    policy = GuardPolicy(allow={"chrome.exe"})
    result = policy.evaluate(["chrome.exe", "notepad.exe", "cmd.exe"])

    assert result["status"] == "blocked"
    assert result["blocked"] == ["cmd.exe", "notepad.exe"]


def test_cli_result_is_json_serializable():
    policy = GuardPolicy(allow={"python.exe"})
    result = policy.evaluate(["python.exe", "steam.exe"])

    assert json.loads(json.dumps(result))["blocked"] == ["steam.exe"]
