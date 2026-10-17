"""Exercise the real deploy script with isolated shell/network substitutes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy_hosted.sh'

FAKE = r'''#!/usr/bin/env python3
import json, os, pathlib, sys, subprocess, tempfile, signal
root = pathlib.Path(os.environ['DEPLOY_TEST_ROOT'])
name = pathlib.Path(sys.argv[0]).name
failure = os.environ.get('DEPLOY_TEST_FAILURE', '')
if name == 'git':
    if 'rev-parse' in sys.argv: print('abcdef123456')
    sys.exit(0)
if name == 'findmnt': print('tmpfs' if failure == 'tmpfs' else 'ext4'); sys.exit(0)
if name == 'mktemp':
    if '-d' in sys.argv:
        stage = '/opt/tan-studio/current' if failure == 'invalid_path' else '/var/tmp/tan-studio-hosted-abcdef123456.A1b2C3d4'
        (root/'allocated').write_text(stage)
        print(stage)
    else:
        fd, path = tempfile.mkstemp(dir=os.environ['TMPDIR']); os.close(fd); print(path)
    sys.exit(0)
if name == 'gcloud': sys.exit(0)
if name == 'curl': sys.exit(31 if failure == 'health' else 0)
command = sys.argv[-1]
with (root/'commands').open('a') as f: f.write(json.dumps(command)+'\n')
if 'mktemp -d' in command:
    sys.exit(subprocess.run(['bash', '-c', command]).returncode)
elif command.startswith('rm -rf -- '):
    if failure == 'cleanup': sys.exit(33)
    (root/'cleaned').write_text(command)
elif command.startswith('tar -C '):
    sys.stdin.buffer.read()
    if failure == 'upload': sys.exit(34)
elif 'cat >' in command:
    sys.stdin.buffer.read()
    if failure == 'secrets': sys.exit(35)
elif command.startswith('sudo '):
    (root/'installed').write_text(command)
    if failure == 'install': sys.exit(36)
    if failure in ['interrupt', 'terminate']:
        os.kill(os.getppid(), signal.SIGINT if failure == 'interrupt' else signal.SIGTERM)
'''


class DeploymentCleanup(unittest.TestCase):
    def run_case(self, failure=''):
        with tempfile.TemporaryDirectory(prefix='tan-deploy-test-') as directory:
            root = Path(directory)
            (root/'script').mkdir()
            shutil.copyfile(SCRIPT, root/'script/deploy_hosted.sh')
            build = root/'script/build_hosted_release.sh'
            build.write_text('#!/bin/sh\nmkdir -p "dist/hosted/$1"\nprintf fixture > "dist/hosted/$1/VERSION"\n')
            build.chmod(0o755)
            binary = root/'bin'; binary.mkdir()
            for name in ['git', 'gcloud', 'ssh', 'curl', 'findmnt', 'mktemp']:
                path = binary/name; path.write_text(FAKE); path.chmod(0o755)
            scratch = root/'local-tmp'; scratch.mkdir()
            env = {**os.environ, 'PATH': str(binary)+os.pathsep+os.environ['PATH'],
                   'DEPLOY_TEST_ROOT': str(root), 'DEPLOY_TEST_FAILURE': failure,
                   'TMPDIR': str(scratch), 'TAN_STUDIO_ENV_FILE': str(root/'absent'),
                   'TAN_STUDIO_OIDC_CLIENT_SECRET': 'fixture-secret'}
            result = subprocess.run(['bash', str(root/'script/deploy_hosted.sh')],
                                    cwd=root, env=env, capture_output=True, text=True, timeout=10)
            commands = [json.loads(s) for s in (root/'commands').read_text().splitlines()]
            self.assertNotIn('fixture-secret', result.stdout+result.stderr+'\n'.join(commands))
            self.assertEqual(list(scratch.iterdir()), [], 'local secret staging leaked')
            self.assertIn('findmnt -n -o FSTYPE --target /var/tmp', commands[0])
            self.assertNotIn("'/tmp/", '\n'.join(commands))
            if failure in ['tmpfs', 'invalid_path']:
                self.assertFalse((root/'installed').exists())
                self.assertFalse((root/'cleaned').exists(), 'must not clean an untrusted path')
            elif failure != 'cleanup':
                stage = (root/'allocated').read_text()
                self.assertEqual((root/'cleaned').read_text(), "rm -rf -- '"+stage+"'")
            if failure == 'cleanup':
                self.assertIn('cleanup failed; retained at', result.stderr)
            self.assertEqual(result.returncode == 0, not failure, result.stderr)

    def test_success_and_failure_cleanup(self):
        for failure in ['', 'upload', 'secrets', 'install', 'health', 'cleanup', 'tmpfs', 'invalid_path', 'interrupt', 'terminate']:
            with self.subTest(failure=failure): self.run_case(failure)


if __name__ == '__main__': unittest.main()
