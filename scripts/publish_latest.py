#!/usr/bin/env python3
"""把构建产物写进 latest.json（Release 之后的后置步骤）。

用法：publish_latest.py <version> <exe> <sig> <apk>
环境：GH_TOKEN / GITHUB_REPOSITORY（Actions 里都有）

为什么放在仓库里而不是写进 workflow：这段逻辑要能本地跑、能单测（见 scripts/README 与 CI），
并且必须和 `src-tauri/src/commands/update.rs` 的字段语义保持一致：
- 桌面端：installer_url + signature + sha256 + size 四个字段齐全才会静默下载；
- 安卓端：只要 installer_url + sha256 + size（系统按签名一致性把关）。
"""

import base64
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request


def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def api(path: str, token: str, method: str = 'GET', body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        'https://api.github.com' + path,
        method=method,
        data=data,
        headers={
            'Authorization': 'Bearer ' + token,
            'Accept': 'application/vnd.github+json',
            **({'Content-Type': 'application/json'} if data else {}),
        },
    )
    with urllib.request.urlopen(req) as r:
        return r.status, json.loads(r.read().decode() or '{}')


def build_doc(version: str, repo: str, exe: str, sig: str, apk: str) -> dict:
    tag = f'v{version}'
    base = f'https://github.com/{repo}/releases/download/{tag}'
    return {
        'version': version,
        'release_url': f'https://github.com/{repo}/releases/tag/{tag}',
        'installer_url': f'{base}/{os.path.basename(exe)}',
        'signature': open(sig, encoding='utf-8').read().strip(),
        'sha256': sha256_file(exe),
        'size': os.path.getsize(exe),
        'android': {
            'version': version,
            'release_url': f'https://github.com/{repo}/releases/tag/{tag}',
            'installer_url': f'{base}/{os.path.basename(apk)}',
            'sha256': sha256_file(apk),
            'size': os.path.getsize(apk),
        },
    }


def main() -> int:
    version, exe, sig, apk = sys.argv[1:5]
    repo = os.environ['GITHUB_REPOSITORY']
    token = os.environ['GH_TOKEN']
    for path in (exe, sig, apk):
        if not os.path.isfile(path):
            raise SystemExit(f'缺少产物: {path}')
    doc = build_doc(version, repo, exe, sig, apk)
    content = json.dumps(doc, ensure_ascii=False, indent=4) + '\n'
    status, current = api('/repos/%s/contents/latest.json?ref=main' % repo, token)
    payload = {
        'message': f'release: latest.json -> v{version}',
        'branch': 'main',
        'content': base64.b64encode(content.encode()).decode(),
    }
    if status == 200:
        payload['sha'] = current['sha']
    api('/repos/%s/contents/latest.json' % repo, token, 'PUT', payload)
    print(json.dumps(doc, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
