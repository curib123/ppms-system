#!/usr/bin/env python3
"""Create a local administrator without putting a password in shell history."""
import argparse
import getpass
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--php', default='php')
args = parser.parse_args()
account = {'username': input('Username: ').strip(), 'email': input('Email: ').strip(),
           'displayName': input('Display name: ').strip(), 'role': 'ADMIN'}
password = getpass.getpass('Password (12–72 bytes): ')
if password != getpass.getpass('Confirm password: '):
    sys.exit('Passwords did not match.')
account['password'] = password
result = subprocess.run([args.php, 'index.php', 'accounts', 'create'], cwd=Path(__file__).resolve().parents[1],
                        input=json.dumps(account), text=True, capture_output=True)
print(result.stdout if result.returncode == 0 else result.stderr, end='')
raise SystemExit(result.returncode)
