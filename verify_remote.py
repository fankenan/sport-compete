# -*- coding: utf-8 -*-
"""核对：内网机 10.128.1.45 上正在运行的代码 vs 本地迁入的源码"""
import hashlib
import os
import paramiko

# ---- 凭据从环境变量读取（不要写死在代码里）----
# 必填：SPORT_SSH_PASSWORD
# 选填：SPORT_SSH_HOST / SPORT_SSH_USER / SPORT_SUDO_PASSWORD / SPORT_DB_PASSWORD
_ENV = os.environ.copy()
_ENV['SPORT_SSH_HOST'] = os.environ.get('SPORT_SSH_HOST', '10.128.1.45')
_ENV['SPORT_SSH_USER'] = os.environ.get('SPORT_SSH_USER', 'single')
_ENV['SPORT_SSH_PASSWORD'] = os.environ.get('SPORT_SSH_PASSWORD', '')
_ENV['SPORT_SUDO_PASSWORD'] = os.environ.get('SPORT_SUDO_PASSWORD', '')
_ENV['SPORT_DB_PASSWORD'] = os.environ.get('SPORT_DB_PASSWORD', '')

if not _ENV['SPORT_SSH_PASSWORD']:
    raise SystemExit(
        '[安全] 缺少环境变量 SPORT_SSH_PASSWORD。\n'
        '  本脚本会连接真实服务器，凭据不再写在代码里。\n'
        '  请先 export SPORT_SSH_PASSWORD=... 后重试。'
    )


LOCAL_ROOT = r'C:\Users\fanke\WorkBuddy\校园体育竞赛管理系统\sport-compete'
REMOTE_ROOT = '/home/single/sport-compete'


def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    return h.hexdigest()


cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


# 服务器端：后端 js + sql 的 md5（排除 node_modules）
remote_raw = run(
    f"cd {REMOTE_ROOT} && find server sql -type f \\( -name '*.js' -o -name '*.sql' -o -name '*.json' \\) "
    "-not -path '*node_modules*' -exec md5sum {} \\;"
)
remote = {}
for line in remote_raw.splitlines():
    if not line.strip():
        continue
    parts = line.split(None, 1)
    if len(parts) == 2:
        remote[parts[1].strip().lstrip('./')] = parts[0]

# 服务器端：前端源码
remote_fe_raw = run(
    f"cd {REMOTE_ROOT}/frontend && find src -type f \\( -name '*.vue' -o -name '*.js' -o -name '*.css' \\) "
    "-exec md5sum {} \\;"
)
for line in remote_fe_raw.splitlines():
    if not line.strip():
        continue
    parts = line.split(None, 1)
    if len(parts) == 2:
        remote['frontend/' + parts[1].strip().lstrip('./')] = parts[0]

same, diff, missing = [], [], []
for rel, r_md5 in remote.items():
    lp = os.path.join(LOCAL_ROOT, rel.replace('/', os.sep))
    if not os.path.isfile(lp):
        missing.append(rel)
        continue
    if md5(lp) == r_md5:
        same.append(rel)
    else:
        diff.append(rel)

print(f'服务器文件总数 {len(remote)}')
print(f'  与本地一致 : {len(same)}')
print(f'  内容不一致 : {len(diff)}')
for d in diff[:15]:
    print('    -', d)
print(f'  本地缺失   : {len(missing)}')
for m in missing[:10]:
    print('    -', m)

# 服务器环境信息
print('\n--- 服务器环境 ---')
print('服务状态:', run('systemctl is-active sport-compete-backend'))
print('后端版本目录:', run(f'cd {REMOTE_ROOT} && git log -1 --format="%h %s" 2>/dev/null || echo "非 git 仓库"'))
print('node -v:', run('node -v'))
print('mysql 库版本确认:', run("""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='sport_compete'" 2>/dev/null"""), '张表')
print('上线 dist 文件数:', run(f'ls {REMOTE_ROOT}/frontend/dist/assets 2>/dev/null | wc -l'))
