# -*- coding: utf-8 -*-
"""部署：主客场按项目 + 双循环 + 相互战绩 + 大屏公开接口"""
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


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HOST = _ENV['SPORT_SSH_HOST']
USER = _ENV['SPORT_SSH_USER']
PWD  = _ENV['SPORT_SSH_PASSWORD']
REMOTE = '/home/single/sport-compete/server'

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

def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip(), e.read().decode('utf-8', 'replace').strip()


files = [
    ('server/index.js', f'{REMOTE}/index.js'),
    ('server/routes/screen.js', f'{REMOTE}/routes/screen.js'),
    ('server/routes/schedule.js', f'{REMOTE}/routes/schedule.js'),
    ('server/routes/group.js', f'{REMOTE}/routes/group.js'),
    ('server/services/scheduler.js', f'{REMOTE}/services/scheduler.js'),
    ('server/services/schedule-algorithms.js', f'{REMOTE}/services/schedule-algorithms.js'),
]
sftp = cli.open_sftp()
for local, remote in files:
    sftp.put(os.path.join(BASE_DIR, local), remote)
    print('uploaded:', remote)
sftp.close()

o, e = run(f'for f in index.js routes/screen.js routes/schedule.js routes/group.js services/scheduler.js services/schedule-algorithms.js; do node --check {REMOTE}/$f || echo "FAIL $f"; done; echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

script = r'''cd /home/single/sport-compete/server
echo "=== 大屏公开接口（不带 token，应可读）==="
curl -s "http://127.0.0.1:4100/api/screen/board?competition_id=6" | head -c 400
echo
echo "=== 项目赛制接口 ==="
curl -s "http://127.0.0.1:4100/api/schedule/event-config?event_item_id=11" -H "Authorization: Bearer $(set -a; . ./.env; set +a; node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:1,username:'admin',role:1,school_id:null,real_name:'t'},process.env.JWT_SECRET,{expiresIn:'10m'}))")"
echo
echo "=== 规模预估 ==="
curl -s "http://127.0.0.1:4100/api/schedule/estimate?competition_id=6&event_item_id=11" -H "Authorization: Bearer $(set -a; . ./.env; set +a; node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({id:1,username:'admin',role:1,school_id:null,real_name:'t'},process.env.JWT_SECRET,{expiresIn:'10m'}))")"
echo
'''
o, e = run(script, t=90)
print(o or e)
cli.close()
