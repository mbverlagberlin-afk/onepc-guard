# onepc-guard

A lightweight security and policy guard for a single machine. It validates that only approved processes are allowed to run and emits a structured status result that can be used in automation or local monitoring.

## Features

- Define an allow-list of approved process names
- Block unapproved tasks automatically in the evaluation logic
- Output JSON for scripts and CI workflows
- Small, dependency-free Python implementation

## Quick start

```bash
python3 onepc_guard.py --allow chrome.exe --allow code.exe --process chrome.exe --process notepad.exe
```

This will report that `notepad.exe` is not allowed.

## Usage

```bash
python3 onepc_guard.py --help
```

## Example: all-clear status

```bash
python3 onepc_guard.py --allow chrome.exe --allow code.exe --process chrome.exe --process code.exe
```

## Why this project exists

`onepc-guard` is a minimal guard utility for single-device or workstation safety checks. It is useful as a starting point for building stricter local policy enforcement, auditing, or internal tooling.
