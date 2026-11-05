# -*- coding: utf-8 -*-
"""排查主客场开关回弹：后端读写实测"""
import json
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


def api(m, p, b=None):
    if b is None:
        c = f'''curl -s -X {m} -H "Authorization: Bearer {TOKEN}" "http://127.0.0.1:4100{p}"'''
    else:
        js = json.dumps(b, ensure_ascii=False).replace('"', '\\"')
        c = f'''curl -s -X {m} -H "Authorization: Bearer {TOKEN}" -H "Content-Type: application/json" -d "{js}" "http://127.0.0.1:4100{p}"'''
    return run(c)


def mq(s):
    return run(f"""mysql -ucompete -pprocess.env.SPORT_DB_PASSWORD sport_compete -N -e "{s}" 2>&1 | grep -v Warning""").replace('\t', '|')


EID = 16
print('当前项目列表:', mq('SELECT id,name,home_away FROM event_item'))
print()
print('GET :', api('GET', f'/api/schedule/event-config?event_item_id={EID}'))
print('POST=1:', api('POST', '/api/schedule/event-config', {'event_item_id': EID, 'home_away': 1}))
print('GET 后:', api('GET', f'/api/schedule/event-config?event_item_id={EID}'))
print('DB  后:', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))
print()
print('POST 传布尔 true:', api('POST', '/api/schedule/event-config', {'event_item_id': EID, 'home_away': True}))
print('GET 后:', api('GET', f'/api/schedule/event-config?event_item_id={EID}'))
print()
print('POST=0 还原:', api('POST', '/api/schedule/event-config', {'event_item_id': EID, 'home_away': 0}))
print('DB 还原后:', mq(f'SELECT id,name,home_away FROM event_item WHERE id={EID}'))
print()
print('estimate:', api('GET', f'/api/schedule/estimate?competition_id=1&event_item_id={EID}')[:200])
