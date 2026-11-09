import { describe, expect, it } from 'vitest'
import { isVideoId, parseYouTubeId, youtubeURL } from './youtube'

describe('YouTube link validation', () => {
  const id = 'aB3_dE-fG09'
  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=tracking&t=34`,
    `youtube.com/watch?v=${id}&list=anything`,
    ` https://m.youtube.com/watch?v=${id} `,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ])('extracts a safe video ID from %s', (url) => expect(parseYouTubeId(url)).toBe(id))
  it.each([
    '',
    'not a link',
    'javascript:alert(1)',
    `https://youtube.com.attacker.test/watch?v=${id}`,
    `https://youtube.com@attacker.test/watch?v=${id}`,
    `https://user@youtube.com/watch?v=${id}`,
    `https://youtube.com:8080/watch?v=${id}`,
    'https://youtube.com/playlist?list=123',
    'https://youtube.com/@channel',
    'https://youtube.com/watch?v=too-short',
    `https://youtu.be/${id}/extra`,
    `https://youtube.com/watch/extra?v=${id}`,
    'https://youtube.com/watch?v=%3Cscript%3E123',
    `https://youtu.be/${id}%0a`,
    `file://youtube.com/watch?v=${id}`,
    `https://notyoutube.com/watch?v=${id}`,
  ])('rejects malformed or unsafe input %s', (url) => expect(parseYouTubeId(url)).toBeNull())
  it('only builds URLs from validated IDs, dropping pasted timestamps and trackers', () => {
    expect(youtubeURL(id)).toBe(`https://www.youtube.com/watch?v=${id}`)
    expect(() => youtubeURL('" onload="')).toThrow()
    expect(isVideoId(null)).toBe(false)
    expect(isVideoId('a'.repeat(12))).toBe(false)
  })
})
