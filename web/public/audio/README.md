# Real recordings (optional)

The game synthesizes every sound in code. To use real recordings instead, put audio files
(`.ogg`, `.mp3` or `.wav`) in this folder and list them in `manifest.json`, for example:

```json
{
  "shot": ["rifle_close_1.ogg", "rifle_close_2.ogg", "rifle_close_3.ogg"],
  "shotFar": ["rifle_distant_1.ogg"],
  "crack": ["bullet_crack.ogg"]
}
```

- Keys are sound names from `public/js/audio.js` (`shot`, `shotFar`, `crack`, `magOut`, `magIn`, `charge`, `dry`, …).
- Several files for one key become random variations.
- Only use sounds you're allowed to use in a game you share: **CC0**, or royalty-free game licences
  such as the Sonniss GDC bundles. Keep the licence text next to the files.
- Short, dry (little reverb) recordings work best: the game adds building echoes, distance and reverb itself.
