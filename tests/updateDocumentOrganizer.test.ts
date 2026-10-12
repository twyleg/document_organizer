import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readlink, readdir, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const script = resolve('update_document_organizer.sh')
const linuxOnly = process.platform !== 'linux' || process.arch !== 'x64'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'document-organizer-updater-'))
  const commands = join(root, 'commands')
  const downloads = join(root, 'downloads')
  const installation = join(root, 'installation with spaces')
  await mkdir(commands)
  await mkdir(downloads)

  // Exercise the real updater with offline release fixtures instead of network requests.
  await writeFile(
    join(commands, 'curl'),
    `#!/usr/bin/env python3
import os
import pathlib
import sys
import shutil

root = pathlib.Path(os.environ['UPDATER_FIXTURE'])
url = sys.argv[-1]
filename = 'release.json' if url.endswith('/latest') else url.rsplit('/', 1)[1]
with (root / 'requests.txt').open('a') as requests:
    requests.write(filename + '\\n')
source = root / 'downloads' / filename
if not source.is_file():
    sys.exit(22)
shutil.copyfile(source, sys.argv[sys.argv.index('--output') + 1])
`
  )
  await chmod(join(commands, 'curl'), 0o755)

  async function release(
    version: string,
    options: { badChecksum?: boolean; prerelease?: boolean; missingBinary?: boolean } = {}
  ) {
    const filename = `document-organizer-${version}-linux-${version === '1.0.0' ? 'x86_64' : 'x64'}.AppImage`
    const binary = Buffer.from(`fictional release binary ${version}`)
    const digest = createHash('sha256').update(binary).digest('hex')
    const assets = (options.missingBinary ? ['SHA256SUMS.txt'] : [filename, 'SHA256SUMS.txt']).map(
      (name) => ({
        name,
        browser_download_url: `https://github.com/twyleg/document_organizer/releases/download/v${version}/${name}`
      })
    )
    await writeFile(
      join(downloads, 'release.json'),
      JSON.stringify({
        tag_name: `v${version}`,
        draft: false,
        prerelease: !!options.prerelease,
        assets
      })
    )
    await writeFile(join(downloads, filename), binary)
    await writeFile(
      join(downloads, 'SHA256SUMS.txt'),
      `${options.badChecksum ? '0'.repeat(64) : digest}  ${filename}\n`
    )
    return { filename, binary }
  }

  function run(target = installation, cwd = root) {
    return spawnSync('bash', [script, target], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${commands}:${process.env.PATH}`, UPDATER_FIXTURE: root }
    })
  }

  return {
    root,
    downloads,
    installation,
    release,
    run,
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}

function assertSuccessfulUpdate(result: { status: number | null; stderr: string; stdout: string }) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test(
  'updater installs verified versions, reuses downloads, and switches its executable symlink',
  { skip: linuxOnly },
  async () => {
    const environment = await fixture()
    try {
      const first = await environment.release('1.0.0')
      assertSuccessfulUpdate(environment.run())
      assert.equal(
        await readlink(join(environment.installation, 'latest')),
        `v1.0.0/${first.filename}`
      )
      assert.deepEqual(await readFile(join(environment.installation, 'latest')), first.binary)

      assertSuccessfulUpdate(environment.run())
      const requests = (await readFile(join(environment.root, 'requests.txt'), 'utf8')).split('\n')
      assert.equal(requests.filter((name) => name === first.filename).length, 1)

      const second = await environment.release('1.1.0')
      assertSuccessfulUpdate(environment.run())
      assert.equal(
        await readlink(join(environment.installation, 'latest')),
        `v1.1.0/${second.filename}`
      )
      assert.deepEqual(
        await readFile(join(environment.installation, 'v1.0.0', first.filename)),
        first.binary
      )
      assert.ok(
        !(await readdir(environment.installation)).some(
          (name) => name.startsWith('.update.') && name !== '.update.lock'
        )
      )
    } finally {
      await environment.cleanup()
    }
  }
)

test(
  'updater preserves the current launcher on checksum, release metadata, and download failures',
  { skip: linuxOnly },
  async () => {
    const environment = await fixture()
    try {
      const first = await environment.release('1.0.0')
      assertSuccessfulUpdate(environment.run())

      for (const options of [
        { badChecksum: true },
        { prerelease: true },
        { missingBinary: true }
      ]) {
        await environment.release('1.1.0', options)
        assert.notEqual(environment.run().status, 0)
        assert.equal(
          await readlink(join(environment.installation, 'latest')),
          `v1.0.0/${first.filename}`
        )
      }

      const second = await environment.release('1.1.0')
      await rm(join(environment.downloads, second.filename))
      assert.notEqual(environment.run().status, 0)
      assert.deepEqual(await readFile(join(environment.installation, 'latest')), first.binary)
      assert.deepEqual((await readdir(environment.installation)).sort(), [
        '.update.lock',
        'latest',
        'v1.0.0'
      ])
    } finally {
      await environment.cleanup()
    }
  }
)

test(
  'updater rejects corrupted cached binaries and an occupied latest directory',
  { skip: linuxOnly },
  async () => {
    const environment = await fixture()
    try {
      const first = await environment.release('1.0.0')
      assertSuccessfulUpdate(environment.run())
      await writeFile(join(environment.installation, 'v1.0.0', first.filename), 'corrupted binary')
      assert.notEqual(environment.run().status, 0)
      assert.equal(
        await readlink(join(environment.installation, 'latest')),
        `v1.0.0/${first.filename}`
      )

      await writeFile(join(environment.installation, 'v1.0.0', first.filename), first.binary)
      await rm(join(environment.installation, 'latest'))
      await mkdir(join(environment.installation, 'latest'))
      assert.notEqual(environment.run().status, 0)
      assert.deepEqual(await readdir(join(environment.installation, 'latest')), [])
    } finally {
      await environment.cleanup()
    }
  }
)

test(
  'updater defaults to document_organizer in the current directory',
  { skip: linuxOnly },
  async () => {
    const environment = await fixture()
    try {
      const first = await environment.release('1.0.0')
      const result = spawnSync('bash', [script], {
        cwd: environment.root,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${join(environment.root, 'commands')}:${process.env.PATH}`,
          UPDATER_FIXTURE: environment.root
        }
      })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(
        await readlink(join(environment.root, 'document_organizer', 'latest')),
        `v1.0.0/${first.filename}`
      )
    } finally {
      await environment.cleanup()
    }
  }
)
