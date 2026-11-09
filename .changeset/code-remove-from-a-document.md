---
"@motionscript/code": patch
---

A document's `remove` command on a `code` node erases its `target` range. It used to reach `Node.remove` instead of `Code.erase` and leave the listing as it was.
