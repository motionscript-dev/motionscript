---
"@motionscript/renderer": patch
"@motionscript/browser": patch
---

An asset is downloaded and decoded once while it is loading, however many ask for it: the weights of one font family share its files (each weight used to fetch the whole family), two draws of one image or video share one decode, and every session, still and export on a page shares one request per source (`loadAssetBytes`, which the audio mix now goes through as well). A load that fails is asked for again next time.
