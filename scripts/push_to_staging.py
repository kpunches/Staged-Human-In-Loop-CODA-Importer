#!/usr/bin/env python3
"""
push_to_staging.py
──────────────────
Run this after doc-extractor + extract-qa have completed successfully.
It uploads the source file and extraction JSON to the WGU staging app,
then prints the review URL for the human reviewer to open.

Usage:
    python3 push_to_staging.py \
        --source   "/mnt/user-data/uploads/D944_CCW.pdf" \
        --json     "/home/claude/D944_CCW.extraction.json" \
        --doc-id   "4YIajnJqvo" \
        --program  "FNP" \
        --course   "D944" \
        --workflow CCW \
        --app-url  "https://wgu-staging-app.onrender.com" \
        --token    "$STAGING_APP_TOKEN"

The --token is a long-lived API token generated in the staging app settings
(role = ADMIN or the submitting user's session token).
"""

import argparse
import json
import sys
import urllib.request
import urllib.error

def push(source: str, json_path: str, doc_id: str, program: str,
         course: str | None, workflow: str, app_url: str, token: str) -> None:

    # Read files
    with open(source, "rb") as f:
        source_bytes = f.read()
    with open(json_path, "r") as f:
        extraction_data = f.read()

    source_filename = source.split("/")[-1]

    # Build multipart form data manually (no requests lib dependency)
    boundary = "----WGUStagingBoundary7MA4YWxkTrZu0gW"

    def field(name: str, value: str) -> bytes:
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
            f"{value}\r\n"
        ).encode()

    def file_field(name: str, filename: str, content: bytes, content_type: str) -> bytes:
        header = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n"
        ).encode()
        return header + content + b"\r\n"

    meta = json.dumps({
        "docId": doc_id,
        "programCode": program,
        "courseCode": course,
        "workflowType": workflow,
        "sourceFileName": source_filename,
    })

    body = (
        field("meta", meta)
        + file_field("sourceFile", source_filename, source_bytes, "application/octet-stream")
        + file_field("extractionJson", "extraction.json", extraction_data.encode(), "application/json")
        + f"--{boundary}--\r\n".encode()
    )

    url = f"{app_url.rstrip('/')}/api/upload"
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": f"Bearer {token}",
            "Content-Length": str(len(body)),
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as resp:
            result = json.loads(resp.read())
            print(f"\n✓ Review created successfully!")
            print(f"  Review ID : {result['reviewId']}")
            print(f"  Review URL: {app_url.rstrip('/')}{result['url']}")
            print(f"\nShare this URL with the reviewer team.")
    except urllib.error.HTTPError as e:
        body_text = e.read().decode()
        print(f"\n✗ Upload failed: HTTP {e.code}")
        print(f"  {body_text}")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"\n✗ Connection failed: {e.reason}")
        print(f"  Is the staging app running at {app_url}?")
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Push extraction to WGU staging app")
    parser.add_argument("--source",   required=True, help="Path to source file (PDF/DOCX)")
    parser.add_argument("--json",     required=True, help="Path to .extraction.json")
    parser.add_argument("--doc-id",   required=True, help="Coda doc ID")
    parser.add_argument("--program",  required=True, help="Program code (e.g. FNP)")
    parser.add_argument("--course",   default=None,  help="Course code (e.g. D944)")
    parser.add_argument("--workflow", required=True,
                        choices=["CCW", "SSD", "VS", "SCOPE_TABLE", "LR", "PDOW"])
    parser.add_argument("--app-url",  required=True, help="Staging app base URL")
    parser.add_argument("--token",    required=True, help="API token")

    args = parser.parse_args()
    push(
        source=args.source,
        json_path=args.json,
        doc_id=args.doc_id,
        program=args.program,
        course=args.course,
        workflow=args.workflow,
        app_url=args.app_url,
        token=args.token,
    )
