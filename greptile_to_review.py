#!/usr/bin/env python3
"""
greptile_to_review.py
Fetches unaddressed Greptile comments for the latest PR and writes them to REVIEW.md.
"""

import argparse
import json
import os
import sys
import textwrap
from datetime import datetime, timezone

import requests

GREPTILE_API_BASE = "https://api.greptile.com/mcp"
REVIEW_FILE = os.environ.get("REVIEW_FILE", "REVIEW.md")
GREPTILE_API_KEY = os.environ.get("GREPTILE_API_KEY")
GITHUB_TOKEN     = os.environ.get("GITHUB_TOKEN")
GITHUB_REPO      = os.environ.get("GITHUB_REPOSITORY")
COMMIT_SHA       = os.environ.get("GITHUB_SHA", "unknown")
BRANCH_NAME      = os.environ.get("GITHUB_REF_NAME", "unknown")

def mcp_call(method, params):
    if not GREPTILE_API_KEY:
        raise EnvironmentError("GREPTILE_API_KEY is not set.")
    headers = {
        "Authorization": f"Bearer {GREPTILE_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    resp = requests.post(GREPTILE_API_BASE, headers=headers, json=payload, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Greptile MCP error: {data['error']}")
    return data.get("result", {})

def get_pr_number_for_branch(owner, repo, branch):
    if not GITHUB_TOKEN:
        return None
    url = f"https://api.github.com/repos/{owner}/{repo}/pulls"
    headers = {"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github+json"}
    params = {"head": f"{owner}:{branch}", "state": "open"}
    resp = requests.get(url, headers=headers, params=params, timeout=15)
    resp.raise_for_status()
    prs = resp.json()
    return prs[0]["number"] if prs else None

def fetch_review_comments(owner, repo, pr_number):
    result = mcp_call("tools/call", {
        "name": "list_merge_request_comments",
        "arguments": {"owner": owner, "repo": repo, "pull_number": pr_number, "addressed": False},
    })
    for block in result.get("content", []):
        if block.get("type") == "text":
            try:
                return json.loads(block["text"])
            except json.JSONDecodeError:
                pass
    return {}

def fetch_pr_summary(owner, repo, pr_number):
    result = mcp_call("tools/call", {
        "name": "get_merge_request",
        "arguments": {"owner": owner, "repo": repo, "pull_number": pr_number},
    })
    for block in result.get("content", []):
        if block.get("type") == "text":
            try:
                return json.loads(block["text"])
            except json.JSONDecodeError:
                pass
    return {}

def severity_label(comment):
    body = comment.get("body", "").lower()
    if any(w in body for w in ("critical", "security", "vulnerability")):
        return "critical"
    if any(w in body for w in ("high", "bug", "error", "exception")):
        return "high"
    if any(w in body for w in ("medium", "performance", "slow")):
        return "medium"
    if any(w in body for w in ("style", "convention", "naming")):
        return "low"
    return "info"

def type_label(comment):
    body = comment.get("body", "").lower()
    if any(w in body for w in ("security", "auth", "inject")):
        return "security"
    if any(w in body for w in ("performance", "slow", "cache")):
        return "performance"
    if any(w in body for w in ("style", "format", "naming")):
        return "convention"
    if any(w in body for w in ("import", "depend", "package")):
        return "dependency"
    return "logic"

def write_review_md(findings, pr_number, summary, commit_sha, branch):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    review_analysis = summary.get("reviewAnalysis", {})
    confidence = review_analysis.get("confidenceScore", "?")
    completeness = review_analysis.get("reviewCompleteness", "")
    SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}
    findings.sort(key=lambda c: SEVERITY_ORDER.get(severity_label(c), 99))

    lines = [
        "# Greptile Review Findings", "",
        "> Auto-written on every PR. Do not edit manually.",
        "> Agents: only act on findings where `Approved by Sammi: true`.", "",
        "---", "", "## Meta", "",
        f"last_updated:     {now}",
        f"triggered_by:     {commit_sha[:12]}",
        f"branch:           {branch}",
        f"pr_number:        {pr_number if pr_number else 'n/a'}",
        f"confidence_score: {confidence}/5",
        f"total_findings:   {len(findings)}",
        f"unaddressed:      {sum(1 for f in findings if not f.get('addressed', False))}",
        "", "---", "", "## Findings", "",
    ]

    if not findings:
        lines += ["_No unaddressed findings._", ""]
    else:
        for i, comment in enumerate(findings, start=1):
            fid = f"FINDING-{i:03d}"
            sev = severity_label(comment)
            typ = type_label(comment)
            file_path = comment.get("filePath") or "-"
            line_start = comment.get("lineStart")
            line_end = comment.get("lineEnd")
            line_range = f"{line_start}-{line_end}" if line_start and line_end else str(line_start) if line_start else "-"
            body = comment.get("body", "").strip()
            has_suggestion = comment.get("hasSuggestion", False)
            suggested_code = comment.get("suggestedCode", "")
            comment_id = comment.get("id", "")
            lines += [
                f"### [{fid}] {body[:80]}{'...' if len(body) > 80 else ''}", "",
                f"**Severity:** {sev}",
                f"**Type:** {typ}",
                f"**File:** `{file_path}`",
                f"**Lines:** {line_range}",
                f"**Has suggested fix:** {'yes' if has_suggestion else 'no'}",
                f"**Greptile comment ID:** `{comment_id}`", "",
                "**Description:**",
                textwrap.fill(body, width=100), "",
            ]
            if has_suggestion and suggested_code:
                lines += ["**Suggested fix:**", "```", suggested_code.strip(), "```", ""]
            lines += ["**Approved by Sammi:** false", "**Addressed:** false", "", "---", ""]

    lines += [
        "## Approval Log", "",
        "<!-- Format: - FINDING-XXX approved YYYY-MM-DD — assign to: claude-code | codex | hermes -->",
        "", "---", "", "## Status", "",
        "reviewed_by_sammi: false",
        "approved_count:    0",
        "rejected_count:    0",
        "deferred_count:    0",
    ]

    with open(REVIEW_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"REVIEW.md written — {len(findings)} finding(s) for {branch}@{commit_sha[:12]}")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pr", type=int)
    parser.add_argument("--repo", default=GITHUB_REPO)
    args = parser.parse_args()
    repo_str = args.repo
    if not repo_str:
        print("Repo not specified.", file=sys.stderr)
        sys.exit(1)
    owner, repo = repo_str.split("/", 1)
    pr_number = args.pr
    if not pr_number:
        pr_number = get_pr_number_for_branch(owner, repo, BRANCH_NAME)
    if not pr_number:
        print(f"No open PR found for branch '{BRANCH_NAME}'. Writing empty REVIEW.md.")
        write_review_md([], None, {}, COMMIT_SHA, BRANCH_NAME)
        return
    print(f"Fetching Greptile findings for PR #{pr_number}...")
    try:
        summary = fetch_pr_summary(owner, repo, pr_number)
        comments_data = fetch_review_comments(owner, repo, pr_number)
        findings = comments_data.get("comments", [])
        findings = [c for c in findings if c.get("isGreptileComment", True)]
    except Exception as e:
        print(f"Greptile API error: {e}", file=sys.stderr)
        sys.exit(1)
    write_review_md(findings, pr_number, summary, COMMIT_SHA, BRANCH_NAME)

if __name__ == "__main__":
    main()
