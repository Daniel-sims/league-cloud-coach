import { describe, expect, it, vi } from 'vitest'
import { playlistUris, SignedPlaylists, signedXhrSetup } from './signed-hls'

const host = 'https://customer-x.cloudflarestream.com'
// Shaped like Cloudflare Stream: the lease token is a path segment of the
// manifest, and every rendition and segment URL carries its own signature.
const master = (sig: string) => `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="original",DEFAULT=YES,URI="stream_audio_${sig}.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="a"
stream_360_${sig}.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,AUDIO="a"
stream_1080_${sig}.m3u8
`
const variant = (name: string, sig: string) => `#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-MAP:URI="../../vid/${name}/init.mp4?s=${sig}"
#EXTINF:4,
../../vid/${name}/seg_1.mp4?s=${sig}
#EXTINF:4,
../../vid/${name}/seg_2.mp4?s=${sig}
#EXT-X-ENDLIST
`
const manifest = (token: string) => `${host}/${token}/manifest/video.m3u8`
const served: Record<string, string> = {}
function serve(token: string, sig: string) {
  served[manifest(token)] = master(sig)
  for (const name of ['audio', '360', '1080'])
    served[`${host}/${token}/manifest/stream_${name}_${sig}.m3u8`] = variant(name, sig)
}
const fetchText = vi.fn(async (url: string) => {
  if (!(url in served)) throw new Error(`404 ${url}`)
  return served[url]
})

function loaded(playlists: SignedPlaylists, token: string, sig: string) {
  playlists.record(manifest(token), manifest(token), master(sig), true)
  const level = `${host}/${token}/manifest/stream_1080_${sig}.m3u8`
  playlists.record(level, level, variant('1080', sig), false)
}

describe('playlistUris', () => {
  it('lists tag and line URIs in order, made absolute', () => {
    expect(playlistUris(variant('1080', 'a'), `${host}/t/manifest/x.m3u8`)).toEqual([
      `${host}/vid/1080/init.mp4?s=a`,
      `${host}/vid/1080/seg_1.mp4?s=a`,
      `${host}/vid/1080/seg_2.mp4?s=a`,
    ])
  })
})

describe('SignedPlaylists', () => {
  it('sends every known URL to its renewed signature without reloading', async () => {
    serve('t1', 'one')
    serve('t2', 'two')
    serve('t3', 'three')
    const playlists = new SignedPlaylists()
    loaded(playlists, 't1', 'one')
    const segment = `${host}/vid/1080/seg_2.mp4?s=one`
    expect(playlists.resolve(segment)).toBe(segment)

    await playlists.renew(manifest('t2'), fetchText)
    expect(playlists.resolve(segment)).toBe(`${host}/vid/1080/seg_2.mp4?s=two`)
    expect(playlists.resolve(`${host}/vid/1080/init.mp4?s=one`)).toBe(
      `${host}/vid/1080/init.mp4?s=two`,
    )
    // A rendition hls.js hasn't opened yet is requested under the new lease…
    const low = `${host}/t1/manifest/stream_360_one.m3u8`
    expect(playlists.resolve(low)).toBe(`${host}/t2/manifest/stream_360_two.m3u8`)
    // …and once it loads, its segments renew too.
    playlists.record(low, playlists.resolve(low), variant('360', 'two'), false)

    await playlists.renew(manifest('t3'), fetchText)
    expect(playlists.resolve(segment)).toBe(`${host}/vid/1080/seg_2.mp4?s=three`)
    expect(playlists.resolve(`${host}/vid/360/seg_1.mp4?s=two`)).toBe(
      `${host}/vid/360/seg_1.mp4?s=three`,
    )
    expect(playlists.resolve('https://elsewhere.test/x')).toBe('https://elsewhere.test/x')
  })

  it('changes nothing when a renewed playlist does not line up', async () => {
    serve('t1', 'one')
    served[manifest('bad')] = master('bad').replace(
      /#EXT-X-STREAM-INF.*\nstream_360_bad.m3u8\n/,
      '',
    )
    const playlists = new SignedPlaylists()
    loaded(playlists, 't1', 'one')
    await expect(playlists.renew(manifest('bad'), fetchText)).rejects.toThrow()
    await expect(playlists.renew(manifest('missing'), fetchText)).rejects.toThrow()
    const segment = `${host}/vid/1080/seg_1.mp4?s=one`
    expect(playlists.resolve(segment)).toBe(segment)
  })

  it('cannot renew before the manifest has loaded', async () => {
    await expect(new SignedPlaylists().renew(manifest('t1'), fetchText)).rejects.toThrow()
  })
})

describe('signedXhrSetup', () => {
  it('opens the renewed URL and records playlists as they load', async () => {
    serve('t1', 'one')
    serve('t2', 'two')
    const playlists = new SignedPlaylists()
    const setup = signedXhrSetup(playlists, fetchText)
    const xhr = () => {
      const listeners: (() => void)[] = []
      const fake = {
        open: vi.fn(),
        readyState: 1,
        status: 0,
        responseURL: '',
        responseText: '',
        addEventListener: (_: string, listener: () => void) => listeners.push(listener),
        finish(url: string, text: string) {
          Object.assign(fake, { readyState: 4, status: 200, responseURL: url, responseText: text })
          listeners.forEach((listener) => listener())
        },
      }
      return fake
    }
    const first = xhr()
    setup(first as unknown as XMLHttpRequest, manifest('t1'), {
      type: 'manifest',
      responseType: 'text',
    })
    expect(first.open).toHaveBeenCalledWith('GET', manifest('t1'), true)
    first.finish(manifest('t1'), master('one'))
    await playlists.renew(manifest('t2'), fetchText)
    const level = xhr()
    setup(level as unknown as XMLHttpRequest, `${host}/t1/manifest/stream_1080_one.m3u8`, {
      type: 'level',
      responseType: 'text',
    })
    expect(level.open).toHaveBeenCalledWith('GET', `${host}/t2/manifest/stream_1080_two.m3u8`, true)
    level.finish(`${host}/t2/manifest/stream_1080_two.m3u8`, variant('1080', 'two'))
    const fragment = xhr()
    setup(fragment as unknown as XMLHttpRequest, `${host}/vid/1080/seg_1.mp4?s=two`, {
      responseType: 'arraybuffer',
    })
    expect(fragment.open).toHaveBeenCalledWith('GET', `${host}/vid/1080/seg_1.mp4?s=two`, true)
  })
})
