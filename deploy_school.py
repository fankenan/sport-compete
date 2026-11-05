# -*- coding: utf-8 -*-
"""部署：后端 school.js → 10.128.1.45，前端 dist → 腾讯云 /var/www/sport-compete"""
import os
import paramiko, subprocess, os

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


HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
BASE = '/home/single/sport-compete/server'
ROOT = r'C:/Users/fanke/WorkBuddy/2026-10-16-14-13-47/sport-compete'

# ---------- 1. 后端 ----------
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, USER, PWD, timeout=15)


def _env(name, fallback=None):
    """读环境变量；未设置时返回 fallback（可为 None 表示必须显式配置）"""
    return os.environ.get(name, fallback)


def _require_env(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit(
            '[安全] 缺少环境变量 %s。\n'
            '  本脚本会连接真实服务器/数据库，凭据不再写在代码里。\n'
            '  请先设置环境变量后重试。' % name
        )
    return v

def run(cmd, timeout=60):
    _, out, err = cli.exec_command(cmd, timeout=timeout, env=_ENV)
    return out.read().decode('utf-8', 'replace').strip(), err.read().decode('utf-8', 'replace').strip()

sftp = cli.open_sftp()
sftp.put(os.path.join(ROOT, 'server/routes/school.js'), f'{BASE}/routes/school.js')
print('uploaded: school.js')
sftp.close()

o, e = run(f'node --check {BASE}/routes/school.js && echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

# 检查新路由是否注册成功（能命中 401/参数错误而不是 404 说明路由存在）
script = f'''
cd {BASE}
set -a; . ./.env; set +a
TOKEN=$(node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({{id:1,username:'admin',role:1,school_id:null,real_name:'t'}},process.env.JWT_SECRET,{{expiresIn:'10m'}}))")
echo "--- PUT /school/user/9999 (不存在应返回业务错误而非 404) ---"
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{{"username":"zzz"}}' http://127.0.0.1:4100/api/school/user/9999
echo
echo "--- DELETE /school/user/9999 ---"
curl -s -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:4100/api/school/user/9999
echo
'''
o, e = run(script, timeout=60)
print(o)
if e: print('STDERR:', e[:500])
cli.close()

# ---------- 2. 前端 ----------
subprocess.run('tar czf /tmp/dist.tgz .', cwd=os.path.join(ROOT, 'frontend/dist'), shell=True)
subprocess.run('scp -q /tmp/dist.tgz tencent:/tmp/', shell=True)
r = subprocess.run(
    'ssh tencent "rm -rf /var/www/sport-compete/* && tar xzf /tmp/dist.tgz -C /var/www/sport-compete/ && rm /tmp/dist.tgz && ls /var/www/sport-compete/assets/ | grep -i Schools"',
    shell=True, capture_output=True, text=True)
print('frontend:', r.stdout.strip() or r.stderr.strip())
print('DEPLOY DONE')
