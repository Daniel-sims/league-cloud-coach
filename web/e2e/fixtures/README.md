# Drawing test video

`drawing.mp4.base64` is a three-second, silent 640×360 FFmpeg test pattern,
encoded as base64 so the web-only export carries the disposable fixture.
It contains no personal recording. Browser tests decode it before serving it.

Generated with:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=640x360:rate=10' -t 3 \
  -c:v libx264 -pix_fmt yuv420p -preset veryslow -crf 35 \
  -movflags +faststart -an drawing.mp4
```

# Rune data

`perkstyles.json` and `perks.json` are trimmed copies of Community Dragon's
public client game data (`plugins/rcp-be-lol-game-data/global/default/v1/`,
patch 16.23), keeping only the fields and runes the rune page uses, so the
matchups browser test doesn't depend on Community Dragon being reachable.
