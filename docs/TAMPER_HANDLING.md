# Tamper Handling

This document explains how EvidenceLock detects, records, and enforces
integrity violations.

---

## The scenario

A real tamper scenario unfolds like this:

1. An investigator requests access to a piece of evidence
2. A supervisor approves the request
3. The investigator downloads the file
4. The investigator modifies the file on their own laptop
5. The investigator uploads the modified file back (the "return")
6. A supervisor verifies the return
7. The system detects that the returned file does not match the registered
   original

The question is: what happens next?

---

## What the system does

### 1. The returned file is preserved as an artifact

When an investigator returns a file, EvidenceLock saves the actual returned
file to disk at:
