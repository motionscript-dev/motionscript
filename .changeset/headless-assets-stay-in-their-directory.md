---
"@motionscript/headless": patch
---

The engine serves only files inside `assetsDir`. Its traversal check compared path strings, so a document could read a file in a sibling directory whose name starts with the assets directory's (`public-secret` beside `public`) by asking for `/..%2Fpublic-secret%2Fx.txt`. A path now has to resolve inside the directory, and its real path has to as well, so a symlink inside it that points out is refused too. A malformed percent escape is a 404 rather than an error in the route handler.
