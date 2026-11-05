# -*- coding: utf-8 -*-
"""从外网 8083 链路实测 POST /api/schedule/event-config，验证 nginx 是否放行 POST"""
import json
import subprocess
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


cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(_ENV['SPORT_SSH_HOST'], 22, _ENV['SPORT_SSH_USER'], _ENV['SPORT_SSH_PASSWORD'], timeout=15)


def run(cmd, t=120):
    _, o, e = cli.exec_command(cmd, timeout=t, env=_ENV)
    return o.read().decode('utf-8', 'replace').strip() or e.read().decode('utf-8', 'replace').strip()


tok = run("""cd /home/single/sport-compete/server && set -a && . ./.env && set +a && node -e "
const j=require('jsonwebtoken');
console.log(j.sign({id:1,username:'admin',role:1,real_name:'管理员'}, process.env.JWT_SECRET, {expiresIn:'2h'}));
" """)
TOKEN = tok.strip().split('\n')[-1]

EID = 16
body = json.dumps({'event_item_id': EID, 'home_away': 1})

# 1) 外网链路 GET
p = subprocess.run(
    ['curl', '-s', '-m', '20', '-H', f'Authorization: Bearer {TOKEN}',
     f'http://150.158.39.237:8083/api/schedule/event-config?event_item_id={EID}'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print('外网 GET :', p.stdout[:200] or p.stderr[:200])

# 2) 外网链路 POST
p = subprocess.run(
    ['curl', '-s', '-m', '20', '-X', 'POST',
     '-H', f'Authorization: Bearer {TOKEN}', '-H', 'Content-Type: application/json',
     '-d', body, 'http://150.158.39.237:8083/api/schedule/event-config'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print('外网 POST:', p.stdout[:300] or p.stderr[:300])

# 3) 回读
def mq(s):
    return run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -N -e "{s}" 2>&1 | grep -v Warning""").replace('\t', '|')

print('DB 后   :', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))

# 还原
p = subprocess.run(
    ['curl', '-s', '-m', '20', '-X', 'POST',
     '-H', f'Authorization: Bearer {TOKEN}', '-H', 'Content-Type: application/json',
     '-d', json.dumps({'event_item_id': EID, 'home_away': 0}),
     'http://150.158.39.237:8083/api/schedule/event-config'],
    capture_output=True, text=True, encoding='utf-8', errors='replace')
print('外网还原:', p.stdout[:200] or p.stderr[:200])
print('DB 还原 :', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))
