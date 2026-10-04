# Focus music — licenses

Every track shipped in the "Focus music" player must appear here with its
license and a source URL. Only royalty-free licenses that permit use inside
an app are allowed (CC0, CC-BY with attribution, or equivalent). No
copyrighted music.

| Track | Artist | License | Source / attribution |
|---|---|---|---|
| Gentle Rain | EDVIRAA | CC0 — generated in-house for this app | Created locally for EDVIRAA; no third-party copyright restrictions |
| Deep Focus Loop | EDVIRAA | CC0 — generated in-house for this app | Created locally for EDVIRAA; no third-party copyright restrictions |
| Quiet Piano | EDVIRAA | CC0 — generated in-house for this app | Created locally for EDVIRAA; no third-party copyright restrictions |

When you add a track file to this folder:
1. Fill in the track's `src` in `web/src/lib/focus-music.ts` (and
   `mobile/src/lib/focusMusic.ts` if bundled for mobile).
2. Update the table above with artist, license, and source URL.
3. Keep the license text file next to the audio file if the license requires
   attribution in-app (CC-BY): the player shows the artist name already.
