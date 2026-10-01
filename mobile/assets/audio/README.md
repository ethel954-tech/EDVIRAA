# Focus music — mobile tracks

Drop royalty-free audio files here (mp3/m4a/ogg) and reference them from
`mobile/src/lib/focusMusic.ts` with
`source: require('../../assets/audio/<file>.mp3')`.

Every track must have a recorded license (see
`web/public/focus-music/LICENSES.md` — the same table covers mobile, since
both surfaces share the catalog). Tracks without a supplied file stay as
placeholders and show as "unavailable" in the player.
