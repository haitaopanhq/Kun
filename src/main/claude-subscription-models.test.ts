import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { fetchSdkModels, parseModelIds } from './claude-subscription-models'

const MARK = '<<<KUN_MODELS>>>'

describe('parseModelIds', () => {
  test('extracts unique model ids from framed ModelInfo JSON', () => {
    const payload = JSON.stringify([
      { value: 'claude-opus-4-8', displayName: 'Opus' },
      { value: 'claude-sonnet-4-6' },
      { value: 'claude-opus-4-8' }, // dup
      { notValue: 'x' }
    ])
    expect(parseModelIds(`noise${MARK}${payload}${MARK}trailing`)).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-4-6'
    ])
  })

  test('returns [] when the frame or JSON is absent/garbage', () => {
    expect(parseModelIds('')).toEqual([])
    expect(parseModelIds(`${MARK}not json${MARK}`)).toEqual([])
  })
})

describe('fetchSdkModels', () => {
  function fakeChild(): EventEmitter & { stdout: EventEmitter; kill: () => void } {
    const c = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void }
    c.stdout = new EventEmitter()
    c.kill = () => {}
    return c
  }

  // A kun root that actually has the SDK package dir, so resolveKunDir picks it.
  function kunRootWithSdk(): { root: string; cleanup: () => void } {
    const root = join(tmpdir(), `kun-models-test-${process.pid}`)
    mkdirSync(join(root, 'node_modules', '@anthropic-ai', 'claude-agent-sdk'), { recursive: true })
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }

  test('returns [] immediately when no kun root has the SDK', async () => {
    expect(await fetchSdkModels({ kunRoots: [join(tmpdir(), 'nope')] })).toEqual([])
  })

  test('parses the model ids the subprocess prints', async () => {
    const { root, cleanup } = kunRootWithSdk()
    try {
      const child = fakeChild()
      const promise = fetchSdkModels({
        kunRoots: [root],
        token: 'sk-ant-oat01-x',
        spawnFn: (() => child) as never
      })
      child.stdout.emit('data', Buffer.from(`${MARK}${JSON.stringify([{ value: 'claude-sonnet-4-6' }])}${MARK}`))
      child.emit('exit', 0)
      expect(await promise).toEqual(['claude-sonnet-4-6'])
    } finally {
      cleanup()
    }
  })

  test('resolves [] on subprocess error', async () => {
    const { root, cleanup } = kunRootWithSdk()
    try {
      const child = fakeChild()
      const promise = fetchSdkModels({ kunRoots: [root], spawnFn: (() => child) as never })
      child.emit('error', new Error('boom'))
      expect(await promise).toEqual([])
    } finally {
      cleanup()
    }
  })
})
