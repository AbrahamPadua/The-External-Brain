/**
 * Front-end contract checks for the Research RM revision and the inline/cover
 * image rules. Run from app/:  npx vitest run src/revision-media.test.ts
 *
 * These cover the parts that are pure logic:
 *   * the shared image allowlist / byte bounds and the MIME-derived object
 *     extension, which is what keeps a hostile file name out of the storage key;
 *   * the demo engine's revise_rm mirror - the version token is the highest
 *     version that EXISTS (not documents.submitted_version_number), and a
 *     historical memo retains version 1.
 * The signed-URL stripping and the Tiptap attribute round trip need a DOM and
 * live in src/image-refs.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { demoAction } from './demo'
import {
  IMAGE_MAX_BYTES, IMAGE_MIME_TYPES, imageExtension, imageFileError, seed,
} from './model'
import type { Data, DocumentRecord } from './model'

const fresh = (): Data => structuredClone(seed)
const docOf = (d: Data, id: string): DocumentRecord => d.documents.find((x) => x.id === id)!

/**
 * imageFileError reads only `type` and `size`, which is its real production
 * signature, so the bound checks use a plain descriptor rather than allocating
 * a 10 MiB buffer per case.
 */
const spec = (type: string, size = 1024) => ({ type, size })
/**
 * Anything that reaches demoAction has to be a genuine Blob, because the demo
 * upload calls URL.createObjectURL on it. The name is deliberately hostile: the
 * object key must be built from the validated MIME type, never from this.
 */
const fileOf = (type: string, size = 1024, name = 'photo.png'): File =>
  new File([new Uint8Array(size)], name, { type })

const iniOf = (d: Data, documentId: string) =>
  d.initiatives.find((i) => i.id === docOf(d, documentId).initiativeId)!
/**
 * An account that is approved but has no claim on the memo: no Research role,
 * not the lead, not a member. Derived from the seed rather than named, because
 * naming one made the earlier version of this test vacuous - the account picked
 * happened to lead the initiative it was supposed to be an outsider to.
 */
const outsiderFor = (d: Data, documentId: string) => {
  const ini = iniOf(d, documentId)
  return d.people.find((p) => p.status === 'approved'
    && !p.roles.includes('research')
    && ini.leadId !== p.id
    && !ini.members.includes(p.id))
}

const RESEARCH = 'maya'   // approved, research role, lead of "sound"
const MEMBER = 'alex'     // approved, no role; leads "memory", member of "sound"

describe('image upload rules', () => {
  it('accepts every allowlisted type at both size bounds', () => {
    for (const type of IMAGE_MIME_TYPES) {
      expect(imageFileError(spec(type, 1))).toBeNull()
      expect(imageFileError(spec(type, IMAGE_MAX_BYTES))).toBeNull()
    }
  })

  it('accepts a real File the browser would hand us', () => {
    expect(imageFileError(fileOf('image/png', 64, 'ok.png'))).toBeNull()
    expect(imageFileError(fileOf('image/svg+xml', 64, 'bad.svg'))).not.toBeNull()
    expect(imageFileError(fileOf('image/png', 0, 'empty.png'))).not.toBeNull()
  })

  it('rejects types outside the allowlist, including SVG', () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf', '']) {
      expect(imageFileError(spec(type))).not.toBeNull()
    }
  })

  it('rejects an empty file and anything over 10 MiB', () => {
    expect(imageFileError(spec('image/png', 0))).not.toBeNull()
    expect(imageFileError(spec('image/png', IMAGE_MAX_BYTES + 1))).not.toBeNull()
  })

  it('derives the extension from the validated type, never the file name', () => {
    expect(imageExtension('image/jpeg')).toBe('jpg')
    expect(imageExtension('image/png')).toBe('png')
    expect(imageExtension('image/gif')).toBe('gif')
    expect(imageExtension('image/webp')).toBe('webp')
    expect(imageExtension('image/svg+xml')).toBe('bin')
  })
})

describe('demo inline image upload', () => {
  it('builds the object key from the initiative and the type, not the file name', async () => {
    // A real File carrying a name that tries to add path segments, escape the
    // folder and change the extension.
    const file = fileOf('image/png', 2048, 'evil.png/../../escape.svg?x=1#y')
    expect(file).toBeInstanceOf(Blob)
    const payload: { documentId: string; file: File; result?: { path: string; url: string } } = {
      documentId: 'rm-sound', file,
    }
    await demoAction(fresh(), RESEARCH, 'uploadRmImage', payload)
    const path = payload.result!.path
    expect(path.split('/')).toHaveLength(2)
    expect(path.startsWith('sound/')).toBe(true)
    expect(path.endsWith('.png')).toBe(true)
    expect(path).not.toContain('..')
    expect(path).not.toContain('escape')
    expect(path).not.toMatch(/[?#]/)
  })

  it('refuses a type outside the allowlist', async () => {
    await expect(demoAction(fresh(), RESEARCH, 'uploadRmImage', {
      documentId: 'rm-sound', file: fileOf('image/svg+xml', 64, 'x.svg'),
    })).rejects.toThrow()
  })

  it('refuses an approved account that is neither on the team nor Research', async () => {
    const data = fresh()
    const ini = iniOf(data, 'rm-legacy')
    const outsider = outsiderFor(data, 'rm-legacy')
    // Asserted, not assumed: if the seed ever gives every approved account a
    // Research role or a place on this team, this fails loudly instead of
    // quietly testing nothing.
    expect(outsider, 'seed has no approved non-team non-Research account').toBeDefined()
    expect(outsider!.roles).not.toContain('research')
    expect(ini.leadId).not.toBe(outsider!.id)
    expect(ini.members).not.toContain(outsider!.id)

    await expect(demoAction(data, outsider!.id, 'uploadRmImage', {
      documentId: 'rm-legacy', file: fileOf('image/png', 64, 'ok.png'),
    })).rejects.toThrow()
  })
})

describe('demo Research RM revision', () => {
  const revise = (data: Data, actor: string, extra: Record<string, unknown>) =>
    demoAction(data, actor, 'reviseRm', {
      reason: 'corrected a figure', body: '<p>revised</p>', title: 'Revised', ...extra,
    })

  it('appends a version to a live memo and keeps the original intact', async () => {
    const before = docOf(fresh(), 'rm-sound')
    const after = docOf(await revise(fresh(), RESEARCH, {
      documentId: 'rm-sound', expectedVersion: 1,
    }), 'rm-sound')
    expect(after.versions).toHaveLength(2)
    expect(after.versions[0].version).toBe(1)
    expect(after.versions[0].body).toBe(before.body)   // original preserved
    expect(after.versions[1].version).toBe(2)
    expect(after.version).toBe(2)                      // live memos advance
    expect(after.body).toBe('<p>revised</p>')
  })

  it('rejects a stale version token', async () => {
    await expect(revise(fresh(), RESEARCH, { documentId: 'rm-sound', expectedVersion: 0 }))
      .rejects.toThrow(/conflict/i)
    await expect(revise(fresh(), RESEARCH, { documentId: 'rm-sound', expectedVersion: 2 }))
      .rejects.toThrow(/conflict/i)
  })

  it('requires Research and a reason', async () => {
    await expect(revise(fresh(), MEMBER, { documentId: 'rm-sound', expectedVersion: 1 }))
      .rejects.toThrow()
    await expect(demoAction(fresh(), RESEARCH, 'reviseRm', {
      documentId: 'rm-sound', expectedVersion: 1, reason: '   ', body: '<p>x</p>',
    })).rejects.toThrow()
  })

  it('retains version 1 of a historical memo and does not advance its version', async () => {
    const original = docOf(fresh(), 'rm-legacy')
    const after = docOf(await revise(fresh(), RESEARCH, {
      documentId: 'rm-legacy', expectedVersion: 1, sourceAuthor: 'Corrected Name',
    }), 'rm-legacy')
    expect(after.versions).toHaveLength(2)
    expect(after.versions[0]).toEqual(original.versions[0])  // imported v1 untouched
    expect(after.version).toBe(1)                            // canonical version stays v1
    expect(after.authorId).toBe('')                          // no account author invented
    expect(after.authorName).toBe('Corrected Name')
  })

  it('keeps the account author and the source author on their own memo kinds', async () => {
    await expect(revise(fresh(), RESEARCH, {
      documentId: 'rm-legacy', expectedVersion: 1, authorId: MEMBER,
    })).rejects.toThrow()
    await expect(revise(fresh(), RESEARCH, {
      documentId: 'rm-sound', expectedVersion: 1, sourceAuthor: 'Ghost',
    })).rejects.toThrow()
  })

  it('advances the token with the stored versions, not with the canonical version', async () => {
    // A historical memo keeps version 1, so a second revision must be offered
    // the highest EXISTING version (2). This is exactly the token the open form
    // must have snapshotted, and re-reading doc.version would send 1 instead.
    const once = await revise(fresh(), RESEARCH, { documentId: 'rm-legacy', expectedVersion: 1 })
    expect(docOf(once, 'rm-legacy').version).toBe(1)
    await expect(revise(once, RESEARCH, { documentId: 'rm-legacy', expectedVersion: 1 }))
      .rejects.toThrow(/conflict/i)
    const twice = await revise(once, RESEARCH, { documentId: 'rm-legacy', expectedVersion: 2 })
    expect(docOf(twice, 'rm-legacy').versions.map((v) => v.version)).toEqual([1, 2, 3])
    expect(docOf(twice, 'rm-legacy').versions[0]).toEqual(docOf(fresh(), 'rm-legacy').versions[0])
  })
})
