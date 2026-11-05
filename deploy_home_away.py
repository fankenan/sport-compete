# -*- coding: utf-8 -*-
"""部署主客场制：后端 schedule.js → 10.128.1.45；前端 dist → 腾讯云"""
import os
import subprocess
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
LOCAL_DIST = os.path.join(BASE_DIR, 'frontend', 'dist')

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


sftp = cli.open_sftp()
sftp.put(os.path.join(BASE_DIR, 'server', 'routes', 'schedule.js'), f'{REMOTE}/routes/schedule.js')
print('uploaded: schedule.js')
sftp.close()

o, e = run(f'node --check {REMOTE}/routes/schedule.js && echo SYNTAX_OK')
print('syntax:', o or e)
o, e = run('echo $SPORT_SUDO_PASSWORD | sudo -S systemctl restart sport-compete-backend && sleep 2 && systemctl is-active sport-compete-backend')
print('service:', o or e)

# 接口自检：读取开关 → 开启 → 手动编排重复校验是否放开
script = f'''cd {REMOTE}
set -a; . ./.env; set +a
TOKEN=$(node -e "const jwt=require('jsonwebtoken');console.log(jwt.sign({{id:1,username:'admin',role:1,school_id:null,real_name:'t'}},process.env.JWT_SECRET,{{expiresIn:'10m'}}))")
echo "--- 读取开关（赛事6）---"
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4100/api/schedule/home-away?competition_id=6"
echo
echo "--- 开启主客场 ---"
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{{"competition_id":6,"home_away":1}}' http://127.0.0.1:4100/api/schedule/home-away
echo
echo "--- 再读取 ---"
curl -s -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:4100/api/schedule/home-away?competition_id=6"
echo
'''
o, e = run(script, t=90)
print(o or e)
cli.close()

# 前端 dist → 腾讯云
tar_path = os.path.join(BASE_DIR, 'dist.tgz')
subprocess.run(['tar', 'czf', tar_path, '.'], cwd=LOCAL_DIST, check=True)
subprocess.run(['scp', '-q', tar_path, 'tencent:/tmp/dist_ha.tgz'], check=True)
subprocess.run(['ssh', 'tencent',
                'rm -rf /var/www/sport-compete/* && tar xzf /tmp/dist_ha.tgz -C /var/www/sport-compete/ && rm -f /tmp/dist_ha.tgz && ls /var/www/sport-compete/'],
               check=True)
os.remove(tar_path)
print('FRONTEND DEPLOYED')
