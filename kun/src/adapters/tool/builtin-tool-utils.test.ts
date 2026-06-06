import { statSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  makeListEntry,
  normalizeToolPath,
  resolveExecutable,
  shellConfig,
  shellDisplayName,
  shellRuntimeInfo,
  shellRuntimeInstruction,
  terminateSpawnTree
} from './builtin-tool-utils.js'

function lookup(results: Record<string, string>) {
  return ((command: string, args: string[]) => {
    const key = `${command} ${args.join(' ')}`
    const stdout = results[key] ?? ''
    return {
      status: stdout ? 0 : 1,
      stdout
    }
  }) as never
}

describe('shellConfig', () => {
  it('uses Git Bash on Windows when bash.exe is available', () => {
    expect(shellConfig('win32', lookup({
      'where bash.exe': 'C:\\Program Files\\Git\\bin\\bash.exe\r\n'
    }))).toEqual({
      shell: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-lc']
    })
  })

  it('falls back to PowerShell on Windows when Bash is unavailable', () => {
    expect(shellConfig('win32', lookup({
      'where pwsh.exe': 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n'
    }))).toEqual({
      shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      args: ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command']
    })
  })

  it('falls back to cmd.exe on Windows when no richer shell is available', () => {
    expect(shellConfig('win32', lookup({}))).toEqual({
      shell: 'cmd.exe',
      args: ['/d', '/s', '/c']
    })
  })

  it('keeps the POSIX shell behavior on non-Windows platforms', () => {
    expect(shellConfig('darwin', lookup({}), () => true)).toEqual({
      shell: '/bin/bash',
      args: ['-lc']
    })
  })
})

describe('resolveExecutable', () => {
  it('uses where on Windows to find executables on PATH', () => {
    expect(resolveExecutable(
      ['rg'],
      'win32',
      lookup({ 'where rg': 'C:\\Tools\\ripgrep\\rg.exe\r\n' }),
      () => false,
      () => true
    )).toBe('C:\\Tools\\ripgrep\\rg.exe')
  })

  it('treats Windows backslash candidates as explicit paths', () => {
    expect(resolveExecutable(
      ['C:\\Tools\\fd.exe'],
      'win32',
      lookup({}),
      (path) => path === 'C:\\Tools\\fd.exe',
      () => true
    )).toBe('C:\\Tools\\fd.exe')
  })

  it('keeps using which on non-Windows platforms', () => {
    expect(resolveExecutable(
      ['rg'],
      'darwin',
      lookup({ 'which rg': '/opt/homebrew/bin/rg\n' }),
      () => false,
      () => true
    )).toBe('/opt/homebrew/bin/rg')
  })
})

describe('shell runtime metadata', () => {
  it('normalizes shell display names', () => {
    expect(shellDisplayName('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe')
    expect(shellDisplayName('C:\\Program Files\\PowerShell\\7\\pwsh.exe')).toBe('pwsh')
    expect(shellDisplayName('/bin/bash')).toBe('bash')
  })

  it('describes the syntax for the current shell', () => {
    expect(shellRuntimeInfo({ shell: 'C:\\Windows\\System32\\cmd.exe', args: ['/d', '/s', '/c'] })).toMatchObject({
      name: 'cmd.exe',
      syntax: 'cmd.exe batch'
    })
    expect(shellRuntimeInstruction({ shell: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-Command'] }))
      .toContain('PowerShell syntax')
  })
})

describe('terminateSpawnTree', () => {
  it('uses taskkill to terminate process trees on Windows', () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const child = {
      pid: 1234,
      kill: vi.fn()
    }
    const spawnImpl = vi.fn((command: string, args: string[]) => {
      calls.push({ command, args })
      return {
        once: vi.fn(),
        unref: vi.fn()
      }
    })

    terminateSpawnTree(child as never, {
      platform: 'win32',
      spawnImpl: spawnImpl as never
    })

    expect(calls).toEqual([{ command: 'taskkill', args: ['/pid', '1234', '/T', '/F'] }])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('falls back to child.kill when no pid is available', () => {
    const child = {
      kill: vi.fn()
    }

    terminateSpawnTree(child as never, { platform: 'win32' })

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

describe('tool path normalization', () => {
  it('normalizes Windows separators in tool-facing paths', () => {
    expect(normalizeToolPath('src\\main\\index.ts')).toBe('src/main/index.ts')
  })

  it('normalizes ls relative paths', () => {
    const fileStat = statSync(new URL('builtin-tool-utils.ts', import.meta.url))
    const entry = makeListEntry('/workspace/src/index.ts', '/workspace', fileStat)

    expect(entry.relative_path).toBe('src/index.ts')
  })
})
