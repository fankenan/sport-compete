# -*- coding: utf-8 -*-
"""
把 sport-compete 推到 GitHub（走 dulwich 直连，不需要内网机、不需要 git CLI）

用法（推荐，不要把 token 写进命令行历史）：
    # Windows PowerShell
    $env:GH_PAT = 'ghp_xxxxxxxxxxxxxxxxxxxx'
    python push_to_github.py

    # Linux / macOS
    export GH_PAT='ghp_xxxxxxxxxxxxxxxxxxxx'
    python push_to_github.py

PAT 权限：
    classic token 勾选 `repo`（含私有仓库读写）
    或 fine-grained token：只授权 sport-compete 这一个仓库 + Contents: Read and write

推送完成后建议到
    https://github.com/settings/tokens
吊销该 token（用完即弃）。
"""
import io
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = 'sport-compete'
OWNER = 'fankenan'
REMOTE_URL = 'https://github.com/%s/%s.git' % (OWNER, REPO)
API_BASE = 'https://api.github.com'


def die(msg, code=1):
    sys.stderr.write('\n[失败] %s\n' % msg)
    sys.exit(code)


def mask(s):
    if not s:
        return s
    if len(s) <= 8:
        return '***'
    return s[:4] + '***' + s[-4:]


def api(method, path, token, payload=None, timeout=60):
    url = path if path.startswith('http') else API_BASE + path
    data = None
    headers = {
        'Authorization': 'Bearer %s' % token,
        'User-Agent': 'sport-compete-push',
        'Accept': 'application/vnd.github+json',
    }
    if payload is not None:
        data = json_dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode('utf-8', 'replace')
            return r.status, body
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'replace')
    except Exception as e:
        die('请求 GitHub 失败：%s' % e)


def json_dumps(obj):
    import json
    return json.dumps(obj, ensure_ascii=False)


# ------------------------------------------------------------
# 1) 取 token
# ------------------------------------------------------------
TOKEN = os.environ.get('GH_PAT') or os.environ.get('GITHUB_TOKEN')
if not TOKEN and len(sys.argv) > 1:
    TOKEN = sys.argv[1]
if not TOKEN:
    die(
        '缺少 GitHub token。\n'
        '  请先设置环境变量再运行：\n'
        '    PowerShell : $env:GH_PAT = "ghp_xxx..."\n'
        '    bash      : export GH_PAT="ghp_..."\n'
        '  或直接传参：python push_to_github.py <token>\n'
        '\n'
        '  token 权限：classic 勾选 repo；或 fine-grained 授权本仓库 + Contents: Read and write'
    )

print('token: %s' % mask(TOKEN))

# ------------------------------------------------------------
# 2) 校验 token
# ------------------------------------------------------------
print('\n① 校验 token')
st, body = api('GET', '/user', TOKEN)
if st != 200:
    die('token 无效或权限不足（HTTP %d）：%s' % (st, body[:200]))
import json
user = json.loads(body)
print('  身份：%s' % user.get('login'))

# ------------------------------------------------------------
# 3) 仓库存在？不存在则创建；已存在但为 private 则改为 public
# ------------------------------------------------------------
print('\n② 检查仓库')
st, body = api('GET', '/repos/%s/%s' % (OWNER, REPO), TOKEN)
created = False
if st == 200:
    repo = json.loads(body)
    print('  已存在（private=%s）' % repo.get('private'))
    if repo.get('private'):
        print('  按要求改为 public…')
        st2, body2 = api('PATCH', '/repos/%s/%s' % (OWNER, REPO), TOKEN, {'private': False})
        if st2 != 200:
            die('改为 public 失败（HTTP %d）：%s' % (st2, body2[:300]))
        print('  已改为 public')
    if repo.get('default_branch') and repo['default_branch'] != 'main':
        print('  注意：远端默认分支是 %s，本次推送 main' % repo['default_branch'])
elif st == 404:
    print('  不存在，创建中（public）…')
    st, body = api('POST', '/user/repos', TOKEN, {
        'name': REPO,
        'private': False,
        'description': '校园体育竞赛管理系统 —— 赛程编排 / 成绩录入 / 赛程展示',
        'auto_init': False,
    })
    if st not in (201, 200):
        die('创建仓库失败（HTTP %d）：%s' % (st, body[:300]))
    created = True
    print('  已创建（public）')
else:
    die('查询仓库失败（HTTP %d）：%s' % (st, body[:200]))

# ------------------------------------------------------------
# 4) 推送
# ------------------------------------------------------------
print('\n③ 推送 main 分支')
try:
    from dulwich import porcelain
    from dulwich.repo import Repo
except ImportError:
    die('缺少 dulwich，请先：pip install dulwich')

repo = Repo(ROOT)
porcelain.add(repo, paths=[b'.gitignore'])
porcelain.commit(repo,
                 message=b'sync: update .gitignore',
                 author=b'fankenan <fankenan@users.noreply.github.com>',
                 committer=b'fankenan <fankenan@users.noreply.github.com>')

# 本地分支可能是 master（dulwich 默认），统一推到远端 main
local_ref = None
for name in repo.get_refs():
    if name in (b'refs/heads/main', b'refs/heads/master'):
        local_ref = name
        break
if not local_ref:
    die('本地没有 main/master 分支')
print('  本地分支：%s' % local_ref.decode())

# 设置远端
config = repo.get_config()
config.set((b'remote', b'origin'), b'url', REMOTE_URL.encode('utf-8'))
config.set((b'branch', b'main'), b'remote', b'origin')
config.set((b'branch', b'main'), b'merge', b'refs/heads/main')
config.write_to_path()

print('  推送中（首次推送含 30MB+ 字体文件，可能需要几分钟）…')
t0 = time.time()
remote_with_auth = 'https://%s:%s@github.com/%s/%s.git' % (OWNER, TOKEN, OWNER, REPO)
refspec = local_ref + b':refs/heads/main'
print('  refspec：%s' % refspec.decode())
try:
    result = porcelain.push(
        repo,
        remote_with_auth,                      # 第 2 位参数是 remote_location
        refspecs=[refspec],
        outstream=sys.stdout.buffer,
        errstream=sys.stderr.buffer,
    )
    print('  推送结果：%s' % (result,))
except Exception as e:
    msg = str(e).replace(TOKEN, '***')
    die('推送失败：%s' % msg)
print('  用时 %.0f 秒' % (time.time() - t0))

# ------------------------------------------------------------
# 5) 验证
# ------------------------------------------------------------
print('\n④ 验证')
st, body = api('GET', '/repos/%s/%s/commits?per_page=1' % (OWNER, REPO), TOKEN)
if st == 200:
    commits = json.loads(body)
    if commits:
        c = commits[0]
        print('  远端最新提交：%s' % c['sha'][:10])
        print('  提交信息：%s' % c['commit']['message'].split('\n')[0][:70])
else:
    print('  验证失败（HTTP %d）' % st)

print('\n完成。')
if created:
    print('仓库地址：https://github.com/%s/%s' % (OWNER, REPO))
print('⚠️ 请到 https://github.com/settings/tokens 吊销本次使用的 token。')
