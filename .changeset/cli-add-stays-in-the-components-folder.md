---
"@motionscript/cli": patch
---

`ms add` writes only inside the components folder. A registry file's `path` was joined onto `paths.components` unchecked, so an item declaring `../../../escaped.txt`, or an absolute path, wrote outside the project. Such a path is now refused with an error naming the item and the path, as is a `paths.components` outside the project, and every requested item is checked before any file is written.
